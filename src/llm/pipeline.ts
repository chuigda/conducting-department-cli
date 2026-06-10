/**
 * Pipeline orchestration — the core send flow.
 *
 * 1. User sends instruction
 * 2. Stream simulator response
 * 3. Update status bar (non-streaming)
 * 4. Compress memory if needed (non-streaming)
 * 5. Push final SimulatorMessage to store
 */

import type { AppConfig } from '../config'
import { resolveApi } from '../config'
import type { SimulatorMessage, Message } from '../chat_message'
import { streamCompletion, completion } from './client'
import {
    buildSimulationRequest,
    buildStatusBarUpdateRequest,
    buildMemoryCompressRequest,
    splitSimulatorOutput,
} from './context'
import { computePreciseMemoryInUse } from './prompt_builder'

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
    callbacks: PipelineCallbacks
): Promise<PipelineResult | null> {
    // ── Stage 1: Simulator streaming ──
    callbacks.onWorkStatus({ $k: 'waiting' })

    const simRequest = buildSimulationRequest(config, messages, userInstruction)
    const simApi = resolveApi(config, 'chat')

    let accumulated = ''
    const streamStart = Date.now()
    let firstTokenTime = 0
    let chunkCount = 0

    let simResult: { content: string; promptTokens: number; completionTokens: number }
    try {
        simResult = await streamCompletion(simApi, simRequest, {
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
        })
    } catch (err) {
        callbacks.onError('main', err as Error)
        callbacks.onWorkStatus({ $k: 'error-main' })
        return null
    }

    const { content: simulatorContent, summarize } = splitSimulatorOutput(simResult.content)

    // ── Stage 2: Status bar update ──
    callbacks.onWorkStatus({ $k: 'status-bar' })

    const statusBarRequest = buildStatusBarUpdateRequest(config, messages, userInstruction, simulatorContent)
    const statusBarApi = resolveApi(config, 'statusBar')

    let statusBar = (messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined)?.statusBar ?? ''
    try {
        const statusResult = await completion(statusBarApi, statusBarRequest)
        statusBar = statusResult.content
    } catch (err) {
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
        promptTokens: simResult.promptTokens,
        completionTokens: simResult.completionTokens,
    }

    // ── Stage 3: Memory compression (if needed) ──
    // Check after adding the new message
    const messagesWithNew = [...messages, { $k: 'player' as const, content: userInstruction }, simMsg]
    const activeLines = computePreciseMemoryInUse(messagesWithNew)

    if (activeLines.length > config.preciseMemoryLimit) {
        callbacks.onWorkStatus({ $k: 'compressing' })

        const compressRequest = buildMemoryCompressRequest(config, messagesWithNew, config.compressPerTime)
        const memoryApi = resolveApi(config, 'memory')

        try {
            const compressResult = await completion(memoryApi, compressRequest)
            simMsg.coarseMemory = compressResult.content
            simMsg.activePreciseMemory = Math.max(0, simMsg.activePreciseMemory - config.compressPerTime)
        } catch (err) {
            callbacks.onError('compress', err as Error)
            callbacks.onWorkStatus({ $k: 'error-compress' })
            // Non-fatal: continue without compression
        }
    }

    callbacks.onWorkStatus({ $k: 'idle' })
    return { simulatorMessage: simMsg }
}
