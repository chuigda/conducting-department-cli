/**
 * Core reactive state — signal/store definitions and basic getters.
 */

import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Message, SimulatorMessage, WorkStatus } from '../chat_message'
import type { AppConfig } from '../config'
import type { AdditionalCHR } from '../llm/chr_file'

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
    label: string
}

// ── Addon entry (runtime state) ──

export interface AddonEntry {
    chr: AdditionalCHR
    path: string
    enabled: boolean
}

// ── Session context (set once at startup, mutated by /save as) ──

export interface SessionContext {
    savePath: string
    simulatorPath: string
    discarded: boolean
}

let sessionCtx: SessionContext | null = null

export function initSessionContext(ctx: Omit<SessionContext, 'discarded'>) {
    sessionCtx = { ...ctx, discarded: false }
}

export function getSimulatorPath(): string | null {
    return sessionCtx?.simulatorPath ?? null
}

export function getSessionContext(): SessionContext | null {
    return sessionCtx
}

/** Mutable reference — commands.ts uses this to update savePath/discarded */
export function getSessionCtxMut(): SessionContext | null {
    return sessionCtx
}

// ── App Config (set once at startup) ──
let appConfig: AppConfig | null = null

export function getAppConfig(): AppConfig | null {
    return appConfig
}

export function initStore(config: AppConfig) {
    appConfig = config

    // Initialize addons from config (paths will be patched by caller)
    setAddons(config.additionalCHRs.map(chr => ({ chr, path: '', enabled: true })))

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

// ── Tool call log (displayed in streaming bubble) ──
const [toolCallLog, setToolCallLog] = createSignal<string[]>([])

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

// ── Question state (for LLM ask_question tool) ──

export interface QuestionState {
    active: boolean
    prompt: string
    options: string[]
    resolve: ((answer: string) => void) | null
}

const [questionState, setQuestionState] = createSignal<QuestionState>({
    active: false,
    prompt: '',
    options: [],
    resolve: null,
})

// ── Addon state ──
const [addons, setAddons] = createSignal<AddonEntry[]>([])

// ── Abort controller for cancelling generation ──
let currentAbortController: AbortController | null = null

export function setAbortController(ctrl: AbortController | null) {
    currentAbortController = ctrl
}

export function getAbortController(): AbortController | null {
    return currentAbortController
}

export {
    messages, setMessages,
    streamingContent, setStreamingContent,
    toolCallLog, setToolCallLog,
    workStatus, setWorkStatus,
    isSending, setIsSending,
    inputText, setInputText,
    editorState, setEditorState,
    questionState, setQuestionState,
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

/**
 * Get the currently active (enabled) additional CHRs in order.
 */
export function getActiveAddons(): AdditionalCHR[] {
    return addons().filter(e => e.enabled).map(e => e.chr)
}

// ── Basic message actions ──

export function addPlayerMessage(content: string) {
    setMessages([...messages, { $k: 'player', content }])
}

export function addSimulatorMessage(msg: Omit<SimulatorMessage, '$k'>) {
    setMessages([...messages, { $k: 'simulator', ...msg }])
}

export function addErrorMessage(content: string) {
    const filtered = messages.filter(m => m.$k !== 'error' && m.$k !== 'info')
    setMessages([...filtered, { $k: 'error', content }])
}

export function addInfoMessage(content: string) {
    const filtered = messages.filter(m => m.$k !== 'error' && m.$k !== 'info')
    setMessages([...filtered, { $k: 'info', content }])
}

export function clearErrors() {
    setMessages(messages.filter(m => m.$k !== 'error' && m.$k !== 'info'))
}

export function deleteMessage(index: number) {
    setMessages(messages.filter((_, i) => i !== index))
}

// ── Question actions ──

/**
 * Show a question overlay and wait for the user's answer.
 */
export function showQuestion(prompt: string, options: string[]): Promise<string> {
    return new Promise<string>((resolve) => {
        setQuestionState({ active: true, prompt, options, resolve })
    })
}

/**
 * Submit an answer to the current question (called by QuestionOverlay).
 */
export function answerQuestion(answer: string) {
    const state = questionState()
    if (state.resolve) {
        state.resolve(answer)
    }
    setQuestionState({ active: false, prompt: '', options: [], resolve: null })
}

/**
 * Skip the current question (Escape).
 */
export function skipQuestion() {
    answerQuestion('[用户跳过了这个问题]')
}

// ── Cancel generation ──

export function cancelGeneration() {
    if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
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
        case 'asking': return '模拟器正在提问，等待回答'
        case 'status-bar': return '正在更新状态栏'
        case 'compressing': return '正在压缩记忆'
        case 'error-main': return '主要内容生成失败'
        case 'error-status-bar': return '状态栏更新遇到错误'
        case 'error-compress': return '记忆压缩遇到错误'
        default: return ''
    }
}
