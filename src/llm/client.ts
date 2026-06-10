/**
 * OpenAI-compatible LLM client using Bun's native fetch.
 * Supports both streaming (SSE) and non-streaming requests.
 */

import type { ApiEndpoint, LLMConfig } from '../config'

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface ChatCompletionRequest {
    model: string
    messages: ChatMessage[]
    temperature: number
    top_p: number
    presence_penalty: number
    frequency_penalty: number
    max_completion_tokens: number
    stream: boolean
    stop: string[]
}

export interface StreamCallbacks {
    onDelta: (delta: string) => void
}

export interface CompletionResult {
    content: string
    promptTokens: number
    completionTokens: number
}

/**
 * Send a streaming chat completion request.
 * Calls onDelta for each content chunk; returns the accumulated result.
 */
export async function streamCompletion(
    endpoint: ApiEndpoint,
    request: ChatCompletionRequest,
    callbacks: StreamCallbacks
): Promise<CompletionResult> {
    const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${endpoint.key}`,
        },
        body: JSON.stringify({ ...request, stream: true }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`LLM API error ${response.status}: ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
        throw new Error('No response body stream')
    }

    const decoder = new TextDecoder()
    let accumulated = ''
    let promptTokens = 0
    let completionTokens = 0
    let buffer = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue

            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue

            try {
                const chunk = JSON.parse(data)

                // Extract content delta
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                    accumulated += delta
                    callbacks.onDelta(delta)
                }

                // Extract usage from final chunk (some APIs include this)
                if (chunk.usage) {
                    promptTokens = chunk.usage.prompt_tokens ?? 0
                    completionTokens = chunk.usage.completion_tokens ?? 0
                }
            } catch {
                // Skip unparseable lines (comments, keepalives, etc.)
            }
        }
    }

    return { content: accumulated, promptTokens, completionTokens }
}

/**
 * Send a non-streaming chat completion request.
 */
export async function completion(
    endpoint: ApiEndpoint,
    request: ChatCompletionRequest
): Promise<CompletionResult> {
    const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${endpoint.key}`,
        },
        body: JSON.stringify({ ...request, stream: false }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`LLM API error ${response.status}: ${errorText}`)
    }

    const result: any = await response.json()

    const content = result.choices?.[0]?.message?.content ?? ''
    const promptTokens = result.usage?.prompt_tokens ?? 0
    const completionTokens = result.usage?.completion_tokens ?? 0

    return { content, promptTokens, completionTokens }
}

/**
 * Build a ChatCompletionRequest from LLM config and messages.
 */
export function buildRequest(
    llmConfig: LLMConfig,
    messages: ChatMessage[],
    options: { stream: boolean; maxTokens: number }
): ChatCompletionRequest {
    return {
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        top_p: llmConfig.topP,
        presence_penalty: llmConfig.presencePenalty,
        frequency_penalty: llmConfig.frequencyPenalty,
        max_completion_tokens: options.maxTokens,
        stream: options.stream,
        stop: [],
        messages,
    }
}
