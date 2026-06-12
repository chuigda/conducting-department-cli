/**
 * Tool definitions and executors for the LLM pipeline.
 *
 * These are tools that the LLM can invoke during generation:
 * - ask_question: ask the Conducting Department for clarification
 * - read: read a file or list a directory
 * - glob: find files matching a pattern
 */

import { resolve, relative } from 'path'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import type { ToolDefinition } from './client'
import type { ToolInteraction } from '../chat_message'

// ── Tool definitions ──

export const ASK_QUESTION_TOOL: ToolDefinition = {
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

export const READ_TOOL: ToolDefinition = {
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

export const GLOB_TOOL: ToolDefinition = {
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

export const TOOLS: ToolDefinition[] = [ASK_QUESTION_TOOL, READ_TOOL, GLOB_TOOL]

// ── Tool executors ──

/**
 * Execute the read tool. Returns the file content or directory listing.
 * Rejects paths outside process.cwd().
 */
export function executeRead(path: string): { success: boolean; result: string } {
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
export function executeGlob(pattern: string): { success: boolean; result: string } {
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

// ── Tool interaction utilities ──

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

/**
 * Extract the result text from a tool interaction for display in prompts.
 */
export function extractKeyResult(interaction: ToolInteraction): string {
    switch (interaction.$k) {
        case 'ask_question': return interaction.answer
        case 'read': return interaction.success ? interaction.result : `Error: ${interaction.result}`
        case 'glob': return interaction.success ? interaction.result : `Error: ${interaction.result}`
    }
}
