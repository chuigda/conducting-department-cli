import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Message, SimulatorMessage, WorkStatus } from './chat_message'
import type { AppConfig } from './config'
import { executePipeline } from './llm/pipeline'

// ── App Config (set once at startup) ──
let appConfig: AppConfig | null = null

export function initStore(config: AppConfig) {
    appConfig = config

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

export {
    messages, setMessages,
    streamingContent, setStreamingContent,
    workStatus, setWorkStatus,
    isSending, setIsSending,
    inputText, setInputText,
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
    setMessages([...messages, { $k: 'error', content }])
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
    setMessages(messages.filter(m => m.$k !== 'error'))

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
