/**
 * OpenAI-compatible LLM client using Bun's native fetch.
 * Supports both streaming (SSE) and non-streaming requests.
 * Supports tool calls (function calling).
 */

import type { ApiEndpoint, LLMConfig } from '../config'

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_calls?: ToolCall[]
    tool_call_id?: string
}

export interface ToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export interface ToolDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, any>
    }
}

export interface ChatCompletionRequest {
    model: string
    messages: ChatMessage[]
    temperature?: number
    top_p?: number
    presence_penalty: number
    frequency_penalty: number
    max_completion_tokens: number
    stream: boolean
    stop: string[]
    tools?: ToolDefinition[]
}

export interface StreamCallbacks {
    onDelta: (delta: string) => void
    onToolCallDelta?: (toolCalls: ToolCall[]) => void
}

export interface CompletionResult {
    content: string
    toolCalls: ToolCall[]
    promptTokens: number
    completionTokens: number
}

/**
 * Send a streaming chat completion request.
 * Calls onDelta for each content chunk; returns the accumulated result.
 * Also accumulates tool_calls from delta chunks.
 */
export async function streamCompletion(
    endpoint: ApiEndpoint,
    request: ChatCompletionRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
): Promise<CompletionResult> {
    const body: Record<string, any> = { ...request, stream: true }
    // Only include tools if defined
    if (!request.tools?.length) delete body.tools

    const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${endpoint.key}`,
        },
        body: JSON.stringify(body),
        signal,
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

    // Accumulate tool calls by index
    const toolCallMap: Map<number, { id: string; name: string; arguments: string }> = new Map()

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
                const delta = chunk.choices?.[0]?.delta

                // Extract content delta
                if (delta?.content) {
                    accumulated += delta.content
                    callbacks.onDelta(delta.content)
                }

                // Extract tool_calls delta
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0
                        if (!toolCallMap.has(idx)) {
                            toolCallMap.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' })
                        }
                        const entry = toolCallMap.get(idx)!
                        if (tc.id) entry.id = tc.id
                        if (tc.function?.name) entry.name = tc.function.name
                        if (tc.function?.arguments) entry.arguments += tc.function.arguments
                    }
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

    // Build final tool calls array
    const toolCalls: ToolCall[] = [...toolCallMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([_, entry]) => ({
            id: entry.id,
            type: 'function' as const,
            function: { name: entry.name, arguments: entry.arguments },
        }))

    if (toolCalls.length > 0) {
        callbacks.onToolCallDelta?.(toolCalls)
    }

    return { content: accumulated, toolCalls, promptTokens, completionTokens }
}

/**
 * Send a non-streaming chat completion request.
 */
export async function completion(
    endpoint: ApiEndpoint,
    request: ChatCompletionRequest,
    signal?: AbortSignal
): Promise<CompletionResult> {
    const body: Record<string, any> = { ...request, stream: false }
    if (!request.tools?.length) delete body.tools

    const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${endpoint.key}`,
        },
        body: JSON.stringify(body),
        signal,
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`LLM API error ${response.status}: ${errorText}`)
    }

    const result: any = await response.json()

    const message = result.choices?.[0]?.message
    const content = message?.content ?? ''
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
    }))
    const promptTokens = result.usage?.prompt_tokens ?? 0
    const completionTokens = result.usage?.completion_tokens ?? 0

    return { content, toolCalls, promptTokens, completionTokens }
}

/**
 * Build a ChatCompletionRequest from LLM config and messages.
 */
export function buildRequest(
    llmConfig: LLMConfig,
    messages: ChatMessage[],
    options: { stream: boolean; maxTokens: number; tools?: ToolDefinition[] }
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
        tools: options.tools,
    }
}
