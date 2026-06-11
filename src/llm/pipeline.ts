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

import { resolve, relative } from 'path'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import type { AppConfig } from '../config'
import { resolveApi } from '../config'
import type { SimulatorMessage, Message, ToolInteraction } from '../chat_message'
import type { ChatMessage, ToolCall, ToolDefinition } from './client'
import { streamCompletion, completion } from './client'
import {
    buildSimulationRequest,
    buildStatusBarUpdateRequest,
    buildMemoryCompressRequest,
    splitSimulatorOutput,
} from './context'
import { computePreciseMemoryInUse } from './prompt_builder'
import { getActiveAddons, showQuestion, setToolCallLog } from '../store'

// ── Tool definitions ──

const ASK_QUESTION_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'ask_question',
        description: 'Ask the Conducting Department (user) a question for clarification before generating story content.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The question to ask the user.',
                },
                options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional list of suggested answers for the user to choose from.',
                },
            },
            required: ['prompt'],
        },
    },
}

const READ_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'read',
        description: 'Read the contents of a file or list the entries of a directory. The path must be within the current working directory.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Relative or absolute path to the file or directory to read.',
                },
            },
            required: ['path'],
        },
    },
}

const GLOB_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'glob',
        description: 'Find files matching a glob pattern within the current working directory. Returns a list of matching file paths.',
        parameters: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Glob pattern to match files (e.g. "**/*.ts", "src/**/*.md").',
                },
            },
            required: ['pattern'],
        },
    },
}

const TOOLS: ToolDefinition[] = [ASK_QUESTION_TOOL, READ_TOOL, GLOB_TOOL]

/**
 * Execute the read tool. Returns the file content or directory listing.
 * Rejects paths outside process.cwd().
 */
function executeRead(path: string): { success: boolean; result: string } {
    const cwd = process.cwd()
    const resolved = resolve(cwd, path)
    const rel = relative(cwd, resolved)

    // Reject paths that escape cwd
    if (rel.startsWith('..') || resolve(resolved) !== resolved && rel.startsWith('..')) {
        return { success: false, result: `Error: path "${path}" is outside the working directory.` }
    }
    // Extra check: resolved must start with cwd
    if (!resolved.startsWith(cwd)) {
        return { success: false, result: `Error: path "${path}" is outside the working directory.` }
    }

    try {
        const stat = statSync(resolved)
        if (stat.isDirectory()) {
            const entries = readdirSync(resolved)
            return { success: true, result: entries.join('\n') }
        } else {
            const content = readFileSync(resolved, 'utf-8')
            return { success: true, result: content }
        }
    } catch (err) {
        return { success: false, result: `Error: ${(err as Error).message}` }
    }
}

/**
 * Execute the glob tool. Returns matching file paths within cwd.
 */
function executeGlob(pattern: string): { success: boolean; result: string } {
    const cwd = process.cwd()
    try {
        const glob = new Bun.Glob(pattern)
        const matches: string[] = []
        for (const path of glob.scanSync({ cwd, dot: false })) {
            matches.push(path)
        }
        if (matches.length === 0) {
            return { success: true, result: '(no matches)' }
        }
        return { success: true, result: matches.join('\n') }
    } catch (err) {
        return { success: false, result: `Error: ${(err as Error).message}` }
    }
}

/**
 * Extract the most important argument from a tool interaction for display purposes.
 */
export function extractKeyArgument(interaction: ToolInteraction): string {
    switch (interaction.$k) {
        case 'ask_question': return interaction.prompt
        case 'read': return interaction.path
        case 'glob': return interaction.pattern
    }
}

export interface PipelineCallbacks {
    onStreamingDelta: (accumulated: string) => void
    onWorkStatus: (status: import('../chat_message').WorkStatus) => void
    onError: (stage: string, error: Error) => void
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

    // Use active addons (respecting enable/disable and order)
    const effectiveConfig: AppConfig = { ...config, additionalCHRs: getActiveAddons() }

    const simRequest = buildSimulationRequest(effectiveConfig, messages, userInstruction)
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
    setToolCallLog([])

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
            if (toolCall.function.name === 'ask_question') {
                let args: { prompt: string; options?: string[] }
                try {
                    args = JSON.parse(toolCall.function.arguments)
                } catch {
                    args = { prompt: toolCall.function.arguments }
                }

                const options = args.options ?? []
                const answer = await showQuestion(args.prompt, options)

                const interaction: ToolInteraction = { $k: 'ask_question', success: true, prompt: args.prompt, options, answer }
                toolInteractions.push(interaction)

                // Log tool call in streaming bubble
                const keyArg = extractKeyArgument(interaction)
                setToolCallLog(prev => [...prev, `⚙ tool call: tool=ask_question, arguments="${keyArg}", result=success`])

                // Append tool result message
                turnMessages = [...turnMessages, {
                    role: 'tool',
                    content: answer,
                    tool_call_id: toolCall.id,
                }]
            } else if (toolCall.function.name === 'read') {
                let args: { path: string }
                try {
                    args = JSON.parse(toolCall.function.arguments)
                } catch {
                    args = { path: toolCall.function.arguments }
                }

                const { success, result } = executeRead(args.path)

                const interaction: ToolInteraction = { $k: 'read', success, path: args.path, result }
                toolInteractions.push(interaction)

                const keyArg = extractKeyArgument(interaction)
                setToolCallLog(prev => [...prev, `⚙ tool call: tool=read, arguments="${keyArg}", result=${success ? 'success' : 'fail'}`])

                turnMessages = [...turnMessages, {
                    role: 'tool',
                    content: result,
                    tool_call_id: toolCall.id,
                }]
            } else if (toolCall.function.name === 'glob') {
                let args: { pattern: string }
                try {
                    args = JSON.parse(toolCall.function.arguments)
                } catch {
                    args = { pattern: toolCall.function.arguments }
                }

                const { success, result } = executeGlob(args.pattern)

                const interaction: ToolInteraction = { $k: 'glob', success, pattern: args.pattern, result }
                toolInteractions.push(interaction)

                const keyArg = extractKeyArgument(interaction)
                setToolCallLog(prev => [...prev, `⚙ tool call: tool=glob, arguments="${keyArg}", result=${success ? 'success' : 'fail'}`])

                turnMessages = [...turnMessages, {
                    role: 'tool',
                    content: result,
                    tool_call_id: toolCall.id,
                }]
            } else {
                // Unknown tool — return error
                setToolCallLog(prev => [...prev, `⚙ tool call: tool=${toolCall.function.name}, arguments="${toolCall.function.arguments}", result=fail`])
                turnMessages = [...turnMessages, {
                    role: 'tool',
                    content: `Error: unknown tool "${toolCall.function.name}"`,
                    tool_call_id: toolCall.id,
                }]
            }
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

    const statusBarRequest = buildStatusBarUpdateRequest(effectiveConfig, messages, userInstruction, simulatorContent, toolInteractions.length > 0 ? toolInteractions : undefined)
    const statusBarApi = resolveApi(config, 'statusBar')

    let statusBar = (messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined)?.statusBar ?? ''
    try {
        const statusResult = await completion(statusBarApi, statusBarRequest, signal)
        statusBar = statusResult.content
    } catch (err) {
        if ((err as Error).name === 'AbortError') throw err
        callbacks.onError('status-bar', err as Error)
        callbacks.onWorkStatus({ $k: 'error-status-bar' })
        // Non-fatal: continue with previous status bar
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
    // Check after adding the new message
    const messagesWithNew = [...messages, { $k: 'player' as const, content: userInstruction }, simMsg]
    const activeLines = computePreciseMemoryInUse(messagesWithNew)

    if (activeLines.length > config.preciseMemoryLimit) {
        callbacks.onWorkStatus({ $k: 'compressing' })

        const compressRequest = buildMemoryCompressRequest(effectiveConfig, messagesWithNew, config.compressPerTime)
        const memoryApi = resolveApi(config, 'memory')

        try {
            const compressResult = await completion(memoryApi, compressRequest, signal)
            simMsg.coarseMemory = compressResult.content
            simMsg.activePreciseMemory = Math.max(0, simMsg.activePreciseMemory - config.compressPerTime)
        } catch (err) {
            if ((err as Error).name === 'AbortError') throw err
            callbacks.onError('compress', err as Error)
            callbacks.onWorkStatus({ $k: 'error-compress' })
            // Non-fatal: continue without compression
        }
    }

    callbacks.onWorkStatus({ $k: 'idle' })
    return { simulatorMessage: simMsg }
}
