/**
 * Pipeline orchestration — the core send flow.
 *
 * 1. User sends instruction
 * 2. Stream simulator response (with tool call loop)
 *    - If LLM issues tool_calls (ask_question), show question UI
 *    - Collect answer, append tool result, re-request
 *    - Repeat until LLM produces final content without tool_calls
 * 3. Update status bar (non-streaming)
 * 4. Compress memory if needed (non-streaming)
 * 5. Push final SimulatorMessage to store
 */

import type { AppConfig } from '../config'
import { resolveApi } from '../config'
import type { SimulatorMessage, Message, ToolInteraction } from '../chat_message'
import type { ChatMessage, ToolCall } from './client'
import { streamCompletion, completion } from './client'
import {
    buildSimulationRequest,
    buildStatusBarUpdateRequest,
    buildMemoryCompressRequest,
} from './context'
import { computePreciseMemoryInUse } from './prompt_builder'
import { TOOLS, executeRead, executeGlob, extractKeyArgument } from './tools'
import type { AdditionalCHR } from './chr_file'

// ── Split utility ──

/**
 * Split raw simulator output on the SPLIT marker.
 */
function splitSimulatorOutput(raw: string): { content: string; summarize: string } {
    const parts = raw.split('------SPLIT------')
    if (parts.length >= 2) {
        return { content: parts[0]!.trim(), summarize: parts.slice(1).join('').trim() }
    }
    return { content: raw.trim(), summarize: '' }
}

// ── Pipeline callbacks & types ──

export interface PipelineCallbacks {
    onStreamingDelta: (accumulated: string) => void
    onWorkStatus: (status: import('../chat_message').WorkStatus) => void
    onError: (stage: string, error: Error) => void
    /** Called when the LLM invokes ask_question and needs user input. */
    onRequestUserInput: (prompt: string, options: string[]) => Promise<string>
    /** Called to append a tool call log entry for UI display. */
    onToolCallLog: (entry: string) => void
}

interface DispatchResult {
    interaction: ToolInteraction | null
    content: string
}

/**
 * Dispatch a single tool call to the appropriate executor.
 * Returns the ToolInteraction (for recording) and the content to send back as tool result.
 */
async function dispatchToolCall(
    toolCall: ToolCall,
    callbacks: PipelineCallbacks
): Promise<DispatchResult> {
    function parseArgs<T>(fallback: T): T {
        try {
            return JSON.parse(toolCall.function.arguments)
        } catch {
            return fallback
        }
    }

    switch (toolCall.function.name) {
        case 'ask_question': {
            const args = parseArgs<{ prompt: string; options?: string[] }>({ prompt: toolCall.function.arguments })
            const options = args.options ?? []
            const answer = await callbacks.onRequestUserInput(args.prompt, options)
            const interaction: ToolInteraction = { $k: 'ask_question', success: true, prompt: args.prompt, options, answer }
            return { interaction, content: answer }
        }
        case 'read': {
            const args = parseArgs<{ path: string }>({ path: toolCall.function.arguments })
            const { success, result } = executeRead(args.path)
            const interaction: ToolInteraction = { $k: 'read', success, path: args.path, result }
            return { interaction, content: result }
        }
        case 'glob': {
            const args = parseArgs<{ pattern: string }>({ pattern: toolCall.function.arguments })
            const { success, result } = executeGlob(args.pattern)
            const interaction: ToolInteraction = { $k: 'glob', success, pattern: args.pattern, result }
            return { interaction, content: result }
        }
        default:
            return { interaction: null, content: `Error: unknown tool "${toolCall.function.name}"` }
    }
}

export interface PipelineResult {
    simulatorMessage: SimulatorMessage
}

/**
 * Execute the full send pipeline.
 * Returns the completed SimulatorMessage or null on fatal error.
 */
export async function executePipeline(
    config: AppConfig,
    messages: Message[],
    userInstruction: string,
    callbacks: PipelineCallbacks,
    signal?: AbortSignal
): Promise<PipelineResult | null> {
    // ── Stage 1: Simulator streaming with tool call loop ──
    callbacks.onWorkStatus({ $k: 'waiting' })

    const simRequest = buildSimulationRequest(config, messages, userInstruction)
    // Attach tools to the request
    simRequest.tools = TOOLS

    const simApi = resolveApi(config, 'chat')

    let accumulated = ''
    const streamStart = Date.now()
    let firstTokenTime = 0
    let chunkCount = 0

    // Track tool interactions for the final message
    const toolInteractions: ToolInteraction[] = []

    // Clear tool call log at start
    callbacks.onToolCallLog('')  // Signal start (empty = clear if needed by caller)

    // Multi-turn messages for tool call loop (starts with the original request messages)
    let turnMessages: ChatMessage[] = [...simRequest.messages]

    let simResult: { content: string; toolCalls: ToolCall[]; promptTokens: number; completionTokens: number }
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    // Tool call loop
    const MAX_TOOL_ROUNDS = 10
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        try {
            const request = { ...simRequest, messages: turnMessages }
            simResult = await streamCompletion(simApi, request, {
                onDelta(delta) {
                    chunkCount++
                    if (chunkCount === 1) firstTokenTime = Date.now()
                    accumulated += delta
                    callbacks.onStreamingDelta(accumulated)

                    const ttft = firstTokenTime ? firstTokenTime - streamStart : 0
                    const elapsed = (Date.now() - firstTokenTime) / 1000
                    const tps = elapsed > 0 ? (chunkCount - 1) / elapsed : 0
                    callbacks.onWorkStatus({ $k: 'streaming', chars: accumulated.length, ttft, tps })
                }
            }, signal)
        } catch (err) {
            if ((err as Error).name === 'AbortError') throw err
            callbacks.onError('main', err as Error)
            callbacks.onWorkStatus({ $k: 'error-main' })
            return null
        }

        totalPromptTokens += simResult.promptTokens
        totalCompletionTokens += simResult.completionTokens

        // If no tool calls, we're done
        if (simResult.toolCalls.length === 0) break

        // Process tool calls sequentially
        callbacks.onWorkStatus({ $k: 'asking' })

        // Append assistant message with tool_calls to turn history
        turnMessages = [...turnMessages, {
            role: 'assistant',
            content: simResult.content || null,
            tool_calls: simResult.toolCalls,
        }]

        for (const toolCall of simResult.toolCalls) {
            const { interaction, content } = await dispatchToolCall(toolCall, callbacks)
            if (interaction) {
                toolInteractions.push(interaction)
                const keyArg = extractKeyArgument(interaction)
                callbacks.onToolCallLog(`⚙ tool call: tool=${interaction.$k}, arguments="${keyArg}", result=${interaction.success ? 'success' : 'fail'}`)
            } else {
                callbacks.onToolCallLog(`⚙ tool call: tool=${toolCall.function.name}, arguments="${toolCall.function.arguments}", result=fail`)
            }

            turnMessages = [...turnMessages, {
                role: 'tool',
                content,
                tool_call_id: toolCall.id,
            }]
        }

        // Reset streaming state for next round
        accumulated = ''
        chunkCount = 0
        callbacks.onStreamingDelta('')
        callbacks.onWorkStatus({ $k: 'waiting' })
    }

    const { content: simulatorContent, summarize } = splitSimulatorOutput(simResult!.content)

    // ── Stage 2: Status bar update ──
    callbacks.onWorkStatus({ $k: 'status-bar' })

    const statusBarRequest = buildStatusBarUpdateRequest(config, messages, userInstruction, simulatorContent, toolInteractions.length > 0 ? toolInteractions : undefined)
    const statusBarApi = resolveApi(config, 'statusBar')

    let statusBar = (messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined)?.statusBar ?? ''
    let skipPostProcessing = false

    try {
        const statusResult = await completion(statusBarApi, statusBarRequest, signal)
        statusBar = statusResult.content
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            // User cancelled — keep previous status bar, skip compression, but content is still valid
            skipPostProcessing = true
        } else {
            callbacks.onError('status-bar', err as Error)
            callbacks.onWorkStatus({ $k: 'error-status-bar' })
            // Non-fatal: continue with previous status bar
        }
    }

    // ── Assemble SimulatorMessage ──
    const lastSim = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    const prevActivePrecise = lastSim?.activePreciseMemory ?? 0
    const coarseMemory = lastSim?.coarseMemory ?? ''

    const simMsg: SimulatorMessage = {
        $k: 'simulator',
        content: simulatorContent,
        summarize,
        statusBar,
        coarseMemory,
        activePreciseMemory: prevActivePrecise + (summarize ? 1 : 0),
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        toolInteractions: toolInteractions.length > 0 ? toolInteractions : undefined,
    }

    // ── Stage 3: Memory compression (if needed) ──
    if (!skipPostProcessing) {
        const messagesWithNew = [...messages, { $k: 'player' as const, content: userInstruction }, simMsg]
        const activeLines = computePreciseMemoryInUse(messagesWithNew)

        if (activeLines.length > config.preciseMemoryLimit) {
            callbacks.onWorkStatus({ $k: 'compressing' })

            const compressRequest = buildMemoryCompressRequest(config, messagesWithNew, config.compressPerTime)
            const memoryApi = resolveApi(config, 'memory')

            try {
                const compressResult = await completion(memoryApi, compressRequest, signal)
                simMsg.coarseMemory = compressResult.content
                simMsg.activePreciseMemory = Math.max(0, simMsg.activePreciseMemory - config.compressPerTime)
            } catch (err) {
                if ((err as Error).name === 'AbortError') {
                    // User cancelled compression — message content still valid
                } else {
                    callbacks.onError('compress', err as Error)
                    callbacks.onWorkStatus({ $k: 'error-compress' })
                }
                // Non-fatal: continue without compression
            }
        }
    }

    callbacks.onWorkStatus({ $k: 'idle' })
    return { simulatorMessage: simMsg }
}
