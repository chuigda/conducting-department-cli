/**
 * Request assembly — builds ChatCompletionRequests for each pipeline stage.
 */

import type { AppConfig } from '../config'
import type { Message, SimulatorMessage } from '../chat_message'
import type { ChatCompletionRequest, ChatMessage } from './client'
import { buildRequest } from './client'
import {
    buildSimulatorSystemPrompt,
    buildSimulatorUserPrompt,
    buildStatusBarUpdaterSystemPrompt,
    buildStatusBarUpdaterUserPrompt,
    buildMemorySummarizerSystemPrompt,
    buildMemorySummarizerUserPrompt,
    computePreciseMemoryInUse,
    sliceInlineMessages,
} from './prompt_builder'

/**
 * Build the main simulator request (streaming).
 */
export function buildSimulationRequest(
    config: AppConfig,
    messages: Message[],
    userInstruction: string
): ChatCompletionRequest {
    // ~1.5 tokens per Chinese char + 1536 thinking budget
    const maxTokens = Math.ceil(config.outputBudget * 1.5 + 1536)

    const systemPrompt = buildSimulatorSystemPrompt(
        config.simulatorCHR,
        config.additionalCHRs,
        config.outputBudget
    )

    const lastSim = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    const statusBar = lastSim?.statusBar ?? ''
    const coarseMemory = lastSim?.coarseMemory ?? ''
    const preciseMemory = computePreciseMemoryInUse(messages).join('\n')
    const inlineMessages = sliceInlineMessages(messages, config.inlineMessageLimit)

    const userPrompt = buildSimulatorUserPrompt(
        config.simulatorCHR,
        coarseMemory,
        preciseMemory,
        inlineMessages,
        statusBar,
        userInstruction
    )

    return buildRequest(config.chatConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ], { stream: true, maxTokens })
}

/**
 * Build the status bar update request (non-streaming).
 */
export function buildStatusBarUpdateRequest(
    config: AppConfig,
    messages: Message[],
    userInstruction: string,
    simulatorOutput: string
): ChatCompletionRequest {
    const systemPrompt = buildStatusBarUpdaterSystemPrompt(
        config.simulatorCHR,
        config.additionalCHRs
    )

    const lastSim = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    const prevStatusBar = lastSim?.statusBar ?? ''
    const lastSimulatorOutput = lastSim?.content ?? ''
    const coarseMemory = lastSim?.coarseMemory ?? ''
    const preciseMemory = computePreciseMemoryInUse(messages).join('\n')

    const userPrompt = buildStatusBarUpdaterUserPrompt(
        coarseMemory,
        preciseMemory,
        lastSimulatorOutput,
        prevStatusBar,
        userInstruction,
        simulatorOutput
    )

    return buildRequest(config.statusBarConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ], { stream: false, maxTokens: 4096 })
}

/**
 * Build the memory compression request (non-streaming).
 */
export function buildMemoryCompressRequest(
    config: AppConfig,
    messages: Message[],
    compressCount: number
): ChatCompletionRequest {
    const systemPrompt = buildMemorySummarizerSystemPrompt(
        config.simulatorCHR,
        config.additionalCHRs
    )

    const lastSim = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    const coarseMemory = lastSim?.coarseMemory ?? ''
    const preciseMemory = computePreciseMemoryInUse(messages).slice(0, compressCount).join('\n')

    const userPrompt = buildMemorySummarizerUserPrompt(coarseMemory, preciseMemory)

    return buildRequest(config.memoryConfig, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ], { stream: false, maxTokens: 4096 })
}

/**
 * Split raw simulator output on the SPLIT marker.
 */
export function splitSimulatorOutput(raw: string): { content: string; summarize: string } {
    const parts = raw.split('------SPLIT------')
    if (parts.length >= 2) {
        return { content: parts[0]!.trim(), summarize: parts.slice(1).join('').trim() }
    }
    return { content: raw.trim(), summarize: '' }
}
