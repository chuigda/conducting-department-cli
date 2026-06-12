/**
 * Session persistence — save/load full session state to/from JSON files.
 *
 * Save file contains:
 * - Full LLM/pipeline config (including API keys — local file only)
 * - Simulator CHR absolute path
 * - Addon absolute paths with enabled state (array order = effect order)
 * - All messages
 */

import { resolve, relative } from 'path'
import type { Message } from './chat_message'
import type { AppConfig, ApiEndpoint, LLMConfig } from './config'
import type { AdditionalCHR } from './llm/chr_file'

// ── Save file schema ──

export interface SessionFile {
    version: 1
    savedAt: string
    simulatorPath: string
    addons: SessionAddon[]
    config: SessionConfig
    messages: Message[]
}

export interface SessionAddon {
    path: string
    enabled: boolean
}

export interface SessionConfig {
    api: ApiEndpoint
    statusBarApi?: ApiEndpoint
    memoryApi?: ApiEndpoint
    chatConfig: LLMConfig
    statusBarConfig: LLMConfig
    memoryConfig: LLMConfig
    outputBudget: number
    inlineMessageLimit: number
    preciseMemoryLimit: number
    compressPerTime: number
}

// ── Save ──

export interface AddonSaveEntry {
    chr: AdditionalCHR
    path: string
    enabled: boolean
}

export interface SaveInput {
    config: AppConfig
    messages: Message[]
    addons: AddonSaveEntry[]
    simulatorPath: string
}

export function buildSessionFile(input: SaveInput): SessionFile {
    const relSimulatorPath = relative(process.cwd(), resolve(input.simulatorPath))

    const addons: SessionAddon[] = input.addons.map(entry => ({
        path: relative(process.cwd(), resolve(entry.path)),
        enabled: entry.enabled,
    }))

    return {
        version: 1,
        savedAt: new Date().toISOString(),
        simulatorPath: relSimulatorPath,
        addons,
        config: {
            api: input.config.api,
            statusBarApi: input.config.statusBarApi,
            memoryApi: input.config.memoryApi,
            chatConfig: input.config.chatConfig,
            statusBarConfig: input.config.statusBarConfig,
            memoryConfig: input.config.memoryConfig,
            outputBudget: input.config.outputBudget,
            inlineMessageLimit: input.config.inlineMessageLimit,
            preciseMemoryLimit: input.config.preciseMemoryLimit,
            compressPerTime: input.config.compressPerTime,
        },
        messages: input.messages,
    }
}

export async function saveSession(filePath: string, input: SaveInput): Promise<void> {
    const session = buildSessionFile(input)
    await Bun.write(filePath, JSON.stringify(session, null, 2))
}

// ── Load ──

export async function loadSessionFile(filePath: string): Promise<SessionFile> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
        throw new Error(`Session file not found: ${filePath}`)
    }
    const json = await file.json()
    if (json.version !== 1) {
        throw new Error(`Unsupported session file version: ${json.version}`)
    }
    return json as SessionFile
}
