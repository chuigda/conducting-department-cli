/**
 * Async pipeline actions — sendInstruction, regenStatusBar.
 */

import type { AppConfig } from '../config'
import { resolveApi } from '../config'
import type { SimulatorMessage } from '../chat_message'
import { executePipeline } from '../llm/pipeline'
import { completion } from '../llm/client'
import { buildStatusBarUpdateRequest } from '../llm/context'
import {
    messages, setMessages,
    setStreamingContent, setToolCallLog,
    workStatus, setWorkStatus,
    isSending, setIsSending,
    setInputText,
    setAbortController,
    getAppConfig, getActiveAddons,
    addPlayerMessage, addSimulatorMessage,
    addErrorMessage, addInfoMessage,
    clearErrors,
    showQuestion,
} from './state'

/**
 * The main send action. Orchestrates the full pipeline.
 */
export async function sendInstruction(instruction: string) {
    const appConfig = getAppConfig()
    if (!appConfig) return
    if (isSending()) return

    const text = instruction.trim()
    if (!text) return

    // Clear previous errors
    clearErrors()

    setIsSending(true)
    setStreamingContent('')
    setToolCallLog([])
    setInputText('')

    // Create abort controller for this generation
    const controller = new AbortController()
    setAbortController(controller)
    const signal = controller.signal

    // Snapshot messages BEFORE adding the player message to avoid duplicating
    // the user instruction in the LLM prompt (it's passed separately as userInstruction)
    const snapshot = messages.slice()

    // Add the user message immediately (for UI display)
    addPlayerMessage(text)

    try {
        const result = await executePipeline(
            appConfig,
            snapshot,
            text,
            {
                onStreamingDelta(accumulated) {
                    setStreamingContent(accumulated)
                },
                onWorkStatus(status) {
                    setWorkStatus(status)
                },
                onError(stage, error) {
                    if (error.name === 'AbortError') return
                    addErrorMessage(`[${stage}] ${error.message}`)
                },
                onRequestUserInput: showQuestion,
                onToolCallLog(entry) {
                    if (entry === '') {
                        setToolCallLog([])
                    } else {
                        setToolCallLog(prev => [...prev, entry])
                    }
                },
            },
            signal
        )

        if (result) {
            addSimulatorMessage(result.simulatorMessage)
        }
    } catch (err: any) {
        if (err.name === 'AbortError') {
            addInfoMessage('生成已取消')
        } else {
            throw err
        }
    } finally {
        setAbortController(null)
        setStreamingContent('')
        setIsSending(false)
        if (workStatus().$k !== 'error-main'
            && workStatus().$k !== 'error-status-bar'
            && workStatus().$k !== 'error-compress') {
            setWorkStatus({ $k: 'idle' })
        }
    }
}

/**
 * Re-generate the status bar using the latest simulator message.
 */
export async function regenStatusBar() {
    const appConfig = getAppConfig()
    if (!appConfig) return
    if (isSending()) return

    const lastSimIdx = messages.findLastIndex(m => m.$k === 'simulator')
    if (lastSimIdx < 0) return

    const lastSim = messages[lastSimIdx] as SimulatorMessage

    // Find the player message just before this simulator message
    let userInstruction = ''
    for (let i = lastSimIdx - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg && msg.$k === 'player') {
            userInstruction = msg.content
            break
        }
    }

    setIsSending(true)
    const controller = new AbortController()
    setAbortController(controller)
    const signal = controller.signal

    setWorkStatus({ $k: 'status-bar' })

    try {
        const effectiveConfig: AppConfig = { ...appConfig, additionalCHRs: getActiveAddons() }
        const statusBarRequest = buildStatusBarUpdateRequest(effectiveConfig, messages.slice(), userInstruction, lastSim.content)
        const statusBarApi = resolveApi(appConfig, 'statusBar')

        const statusResult = await completion(statusBarApi, statusBarRequest, signal)
        setMessages(lastSimIdx, 'statusBar' as any, statusResult.content)
    } catch (err: any) {
        if (err.name === 'AbortError') {
            addInfoMessage('状态栏生成已取消')
        } else {
            addErrorMessage(`[status-bar] ${(err as Error).message}`)
            setWorkStatus({ $k: 'error-status-bar' })
        }
    } finally {
        setAbortController(null)
        setIsSending(false)
        if (workStatus().$k !== 'error-status-bar') {
            setWorkStatus({ $k: 'idle' })
        }
    }
}
