import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Message, SimulatorMessage, WorkStatus } from './chat_message'
import type { AppConfig } from './config'
import type { AdditionalCHR } from './llm/chr_file'
import { executePipeline } from './llm/pipeline'

// ── Edit target types ──

export type EditTarget =
    | { $k: 'message-content'; index: number }
    | { $k: 'message-summary'; index: number }
    | { $k: 'status-bar' }
    | { $k: 'coarse-memory' }

export interface EditorState {
    active: boolean
    target: EditTarget | null
    draft: string
    label: string  // display label for the overlay header
}

// ── Addon entry (runtime state) ──

export interface AddonEntry {
    chr: AdditionalCHR
    enabled: boolean
}

// ── App Config (set once at startup) ──
let appConfig: AppConfig | null = null

export function initStore(config: AppConfig) {
    appConfig = config

    // Initialize addons from config
    setAddons(config.additionalCHRs.map(chr => ({ chr, enabled: true })))

    // If the simulator CHR has a prologue, seed it as the first message
    if (config.simulatorCHR.prologue) {
        setMessages([{
            $k: 'simulator',
            content: config.simulatorCHR.prologue,
            summarize: '',
            statusBar: '',
            coarseMemory: '',
            activePreciseMemory: 0,
            promptTokens: 0,
            completionTokens: 0,
        }])
    }
}

// ── Message list ──
const [messages, setMessages] = createStore<Message[]>([])

// ── Streaming state ──
const [streamingContent, setStreamingContent] = createSignal('')

// ── Work status ──
const [workStatus, setWorkStatus] = createSignal<WorkStatus>({ $k: 'idle' })

// ── Whether currently sending ──
const [isSending, setIsSending] = createSignal(false)

// ── Input text ──
const [inputText, setInputText] = createSignal('')

// ── Editor state ──
const [editorState, setEditorState] = createSignal<EditorState>({
    active: false,
    target: null,
    draft: '',
    label: '',
})

// ── Addon state ──
const [addons, setAddons] = createSignal<AddonEntry[]>([])

export {
    messages, setMessages,
    streamingContent, setStreamingContent,
    workStatus, setWorkStatus,
    isSending, setIsSending,
    inputText, setInputText,
    editorState, setEditorState,
    addons, setAddons,
}

// ── Derived state ──

export function getCoarseMemory(): string {
    const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    return last?.coarseMemory ?? ''
}

export function getPreciseMemoryEntries(): { text: string; active: boolean }[] {
    const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    if (!last) return []

    const allSummarize = messages
        .filter(m => m.$k === 'simulator' && (m as SimulatorMessage).summarize)
        .map(m => (m as SimulatorMessage).summarize)

    const activeCount = last.activePreciseMemory
    const inactiveCount = allSummarize.length - activeCount

    return allSummarize.map((text, i) => ({
        text,
        active: i >= inactiveCount,
    }))
}

// ── Actions ──

export function addPlayerMessage(content: string) {
    setMessages([...messages, { $k: 'player', content }])
}

export function addSimulatorMessage(msg: Omit<SimulatorMessage, '$k'>) {
    setMessages([...messages, { $k: 'simulator', ...msg }])
}

export function addErrorMessage(content: string) {
    // Error messages don't stack — replace any existing error/info
    const filtered = messages.filter(m => m.$k !== 'error' && m.$k !== 'info')
    setMessages([...filtered, { $k: 'error', content }])
}

export function addInfoMessage(content: string) {
    // Info messages don't stack — replace any existing error/info
    const filtered = messages.filter(m => m.$k !== 'error' && m.$k !== 'info')
    setMessages([...filtered, { $k: 'info', content }])
}

export function clearErrors() {
    setMessages(messages.filter(m => m.$k !== 'error' && m.$k !== 'info'))
}

export function deleteMessage(index: number) {
    setMessages(messages.filter((_, i) => i !== index))
}

/**
 * The main send action. Orchestrates the full pipeline.
 */
export async function sendInstruction(instruction: string) {
    if (!appConfig) return
    if (isSending()) return

    const text = instruction.trim()
    if (!text) return

    // Clear previous errors
    clearErrors()

    setIsSending(true)
    setStreamingContent('')
    setInputText('')

    // Add the user message immediately
    addPlayerMessage(text)

    try {
        const result = await executePipeline(
            appConfig,
            messages.slice(), // snapshot
            text,
            {
                onStreamingDelta(accumulated) {
                    setStreamingContent(accumulated)
                },
                onWorkStatus(status) {
                    setWorkStatus(status)
                },
                onError(stage, error) {
                    addErrorMessage(`[${stage}] ${error.message}`)
                },
            }
        )

        if (result) {
            addSimulatorMessage(result.simulatorMessage)
        }
    } finally {
        setStreamingContent('')
        setIsSending(false)
        if (workStatus().$k !== 'error-main'
            && workStatus().$k !== 'error-status-bar'
            && workStatus().$k !== 'error-compress') {
            setWorkStatus({ $k: 'idle' })
        }
    }
}

// ── Status text for UI ──

export function getStatusText(): string {
    const s = workStatus()
    switch (s.$k) {
        case 'idle': return '就绪'
        case 'waiting': return '消息已发出，等待远程端点响应'
        case 'streaming': {
            const parts = [`已生成 ${s.chars} 字符`]
            if (s.ttft > 0) parts.push(`TTFT ${(s.ttft / 1000).toFixed(2)}s`)
            if (s.tps > 0) parts.push(`TPS ${s.tps.toFixed(1)}`)
            return parts.join('  ')
        }
        case 'status-bar': return '正在更新状态栏'
        case 'compressing': return '正在压缩记忆'
        case 'error-main': return '主要内容生成失败'
        case 'error-status-bar': return '状态栏更新遇到错误'
        case 'error-compress': return '记忆压缩遇到错误'
    }
}

// ── Editor actions ──

/**
 * Open the editor overlay for a given target.
 * Returns false if the target is invalid (e.g., index out of range).
 */
export function openEditor(target: EditTarget): boolean {
    let draft = ''
    let label = ''

    switch (target.$k) {
        case 'message-content': {
            const msg = messages[target.index]
            if (!msg) return false
            draft = msg.content
            label = `编辑消息 #${target.index + 1} (${msg.$k === 'simulator' ? '模拟器' : msg.$k === 'player' ? '指挥部' : '错误'})`
            break
        }
        case 'message-summary': {
            const msg = messages[target.index]
            if (!msg || msg.$k !== 'simulator') return false
            draft = (msg as SimulatorMessage).summarize
            label = `编辑摘要 #${target.index + 1}`
            break
        }
        case 'status-bar': {
            const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
            if (!last) return false
            draft = last.statusBar
            label = '编辑状态栏'
            break
        }
        case 'coarse-memory': {
            const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
            if (!last) return false
            draft = last.coarseMemory
            label = '编辑总结记忆'
            break
        }
    }

    setEditorState({ active: true, target, draft, label })
    return true
}

/**
 * Save the current editor draft back to the store.
 */
export function saveEditor() {
    const state = editorState()
    if (!state.active || !state.target) return

    const target = state.target
    const value = state.draft

    switch (target.$k) {
        case 'message-content': {
            setMessages(target.index, 'content', value)
            break
        }
        case 'message-summary': {
            setMessages(target.index, 'summarize' as any, value)
            break
        }
        case 'status-bar': {
            const idx = messages.findLastIndex(m => m.$k === 'simulator')
            if (idx >= 0) setMessages(idx, 'statusBar' as any, value)
            break
        }
        case 'coarse-memory': {
            const idx = messages.findLastIndex(m => m.$k === 'simulator')
            if (idx >= 0) setMessages(idx, 'coarseMemory' as any, value)
            break
        }
    }

    setEditorState({ active: false, target: null, draft: '', label: '' })
}

/**
 * Cancel editing and discard the draft.
 */
export function cancelEditor() {
    setEditorState({ active: false, target: null, draft: '', label: '' })
}

/**
 * Update the editor draft (called by the overlay textarea).
 */
export function setEditorDraft(value: string) {
    setEditorState(s => ({ ...s, draft: value }))
}

/**
 * Get non-error messages (used for /edit indexing).
 */
function getEditableMessages() {
    return messages
        .map((m, i) => ({ msg: m, realIndex: i }))
        .filter(({ msg }) => msg.$k !== 'error' && msg.$k !== 'info')
}

export type CommandResult =
    | { $k: 'ok' }
    | { $k: 'error'; message: string }
    | { $k: 'info'; message: string }

/**
 * Parse and execute a slash command.
 * /edit N uses reverse indexing over non-error messages: 0 = latest, 1 = second latest, etc.
 */
export function parseCommand(input: string): CommandResult {
    const parts = input.trim().split(/\s+/)
    const cmd = parts[0]!

    switch (cmd) {
        case '/edit':
            return wrapError(handleEditCommand(parts))
        case '/resend':
            return wrapError(handleResendCommand())
        case '/clear':
            clearErrors()
            return { $k: 'ok' }
        case '/addon':
            return handleAddonCommand(parts)
        case '/help':
            return { $k: 'info', message: HELP_TEXT }
        default:
            return { $k: 'error', message: `未知命令 "${cmd}"。输入 /help 查看可用命令` }
    }
}

/** Convert old null/string return to CommandResult */
function wrapError(result: string | null): CommandResult {
    return result ? { $k: 'error', message: result } : { $k: 'ok' }
}

function handleEditCommand(parts: string[]): string | null {
    const sub = parts[1]

    // /edit with no args = /edit 0
    if (!sub) {
        const editable = getEditableMessages()
        if (editable.length === 0) return '没有可编辑的消息'
        const last = editable[editable.length - 1]!
        return openEditor({ $k: 'message-content', index: last.realIndex }) ? null : '无法打开编辑器'
    }

    // /edit status
    if (sub === 'status') {
        return openEditor({ $k: 'status-bar' }) ? null : '没有状态栏可编辑 (尚无模拟器消息)'
    }

    // /edit coarse
    if (sub === 'coarse') {
        return openEditor({ $k: 'coarse-memory' }) ? null : '没有总结记忆可编辑 (尚无模拟器消息)'
    }

    // /edit N [summary] — N is reverse index over non-error messages
    const n = parseInt(sub, 10)
    if (isNaN(n) || n < 0) {
        return '未知命令。可用: /edit [N], /edit N summary, /edit status, /edit coarse'
    }

    const editable = getEditableMessages()
    const reverseIdx = editable.length - 1 - n
    if (reverseIdx < 0) {
        return `消息 #${n} 不存在 (共 ${editable.length} 条可编辑消息, 0=最新)`
    }

    const { msg, realIndex } = editable[reverseIdx]!

    const modifier = parts[2]
    if (modifier === 'summary') {
        if (msg.$k !== 'simulator') {
            return `消息 #${n} 不是模拟器消息，没有摘要字段`
        }
        return openEditor({ $k: 'message-summary', index: realIndex }) ? null : '无法打开编辑器'
    }

    if (modifier) {
        return `未知修饰符 "${modifier}"。可用: summary`
    }

    return openEditor({ $k: 'message-content', index: realIndex }) ? null : '无法打开编辑器'
}

function handleResendCommand(): string | null {
    // Find last player message
    const lastPlayer = messages.findLast(m => m.$k === 'player')
    if (!lastPlayer) return '没有可重发的用户消息'

    // Remove last player message and any simulator message after it
    const lastPlayerIdx = messages.lastIndexOf(lastPlayer)
    // Remove from lastPlayerIdx onwards (player msg + any subsequent simulator response)
    const kept = messages.slice(0, lastPlayerIdx)
    setMessages(kept)

    // Re-send
    sendInstruction(lastPlayer.content)
    return null
}

function handleAddonCommand(parts: string[]): CommandResult {
    const action = parts[1]

    // /addon with no args — list addons
    if (!action) {
        const list = addons()
        if (list.length === 0) return { $k: 'info', message: '没有加载任何附加模块' }
        const lines = list.map((entry, i) => {
            const status = entry.enabled ? '启用' : '禁用'
            return `  ${i + 1}. [${status}] ${entry.chr.id}${entry.chr.name ? ` (${entry.chr.name})` : ''}`
        })
        return { $k: 'info', message: lines.join('\n') }
    }

    // /addon enable <id>
    if (action === 'enable') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon enable <id>' }
        const list = addons()
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        if (list[idx]!.enabled) return { $k: 'info', message: `附加模块 "${id}" 已经是启用状态` }
        setAddons(list.map((e, i) => i === idx ? { ...e, enabled: true } : e))
        return { $k: 'ok' }
    }

    // /addon disable <id>
    if (action === 'disable') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon disable <id>' }
        const list = addons()
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        if (!list[idx]!.enabled) return { $k: 'info', message: `附加模块 "${id}" 已经是禁用状态` }
        setAddons(list.map((e, i) => i === idx ? { ...e, enabled: false } : e))
        return { $k: 'ok' }
    }

    // /addon up <id> [n]
    if (action === 'up') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon up <id> [n]' }
        const n = parseInt(parts[3] ?? '1', 10)
        if (isNaN(n) || n < 1) return { $k: 'error', message: '移动步数必须为正整数' }
        const list = [...addons()]
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        const target = Math.max(0, idx - n)
        if (target === idx) return { $k: 'info', message: `附加模块 "${id}" 已在顶部` }
        const [item] = list.splice(idx, 1)
        list.splice(target, 0, item!)
        setAddons(list)
        return { $k: 'ok' }
    }

    // /addon down <id> [n]
    if (action === 'down') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon down <id> [n]' }
        const n = parseInt(parts[3] ?? '1', 10)
        if (isNaN(n) || n < 1) return { $k: 'error', message: '移动步数必须为正整数' }
        const list = [...addons()]
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        const target = Math.min(list.length - 1, idx + n)
        if (target === idx) return { $k: 'info', message: `附加模块 "${id}" 已在底部` }
        const [item] = list.splice(idx, 1)
        list.splice(target, 0, item!)
        setAddons(list)
        return { $k: 'ok' }
    }

    return { $k: 'error', message: '用法: /addon, /addon enable/disable <id>, /addon up/down <id> [n]' }
}

/**
 * Get the currently active (enabled) additional CHRs in order.
 */
export function getActiveAddons(): AdditionalCHR[] {
    return addons().filter(e => e.enabled).map(e => e.chr)
}

export const HELP_TEXT = `可用命令:
  /edit [N]         编辑消息 (N=倒序索引, 0=最新, 默认0)
  /edit N summary   编辑模拟器消息的摘要
  /edit status      编辑状态栏
  /edit coarse      编辑总结记忆
  /resend           重发上一条用户消息，重新生成
  /addon            列出所有附加模块
  /addon enable <id>    启用附加模块
  /addon disable <id>   禁用附加模块
  /addon up <id> [n]    上移附加模块优先级
  /addon down <id> [n]  下移附加模块优先级
  /clear            清除错误/提示消息
  /help             显示帮助`
