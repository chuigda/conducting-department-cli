/**
 * Configuration loaded at startup.
 *
 * Usage:
 *   bun run index.tsx --config config.toml --simulator world.chr.toml [--addon addon1.chr.toml ...]
 *
 * - config.toml: API endpoints, model configs, pipeline parameters
 * - simulator CHR: TOML file with world/character/rules (same format as mangekyou-web)
 * - addon CHR(s): optional TOML overlays (same format as mangekyou-web additional CHRs)
 */

import type { SimulatorCHR, AdditionalCHR } from './llm/chr_file'
import { readTomlFile } from './utils'

export interface LLMConfig {
    model: string
    temperature?: number
    topP?: number
    presencePenalty: number
    frequencyPenalty: number
}

export interface ApiEndpoint {
    url: string
    key: string
}

export interface AppConfig {
    /** Primary API endpoint (for simulator) */
    api: ApiEndpoint
    /** Optional override for status bar calls (falls back to primary) */
    statusBarApi?: ApiEndpoint
    /** Optional override for memory compression calls (falls back to primary) */
    memoryApi?: ApiEndpoint

    /** LLM config for the main simulator (streaming) */
    chatConfig: LLMConfig
    /** LLM config for status bar updater (non-streaming, lightweight) */
    statusBarConfig: LLMConfig
    /** LLM config for memory compressor (non-streaming, lightweight) */
    memoryConfig: LLMConfig

    /** Output budget in language units (e.g. 1024 Chinese chars) */
    outputBudget: number
    /** How many recent simulator turns to include inline in the user prompt */
    inlineMessageLimit: number
    /** Max active precise memory entries before triggering compression */
    preciseMemoryLimit: number
    /** How many entries to compress per compression cycle */
    compressPerTime: number

    /** Simulator CHR (world/character/rules) */
    simulatorCHR: SimulatorCHR
    /** Additional CHR overlays */
    additionalCHRs: AdditionalCHR[]
}

function defaultLLMConfig(): LLMConfig {
    return {
        model: 'claude-sonnet-4-20250514',
        presencePenalty: 0,
        frequencyPenalty: 0,
    }
}

function defaultLightweightLLMConfig(): LLMConfig {
    return {
        model: 'gemini-2.5-flash',
        presencePenalty: 0,
        frequencyPenalty: 0,
    }
}

// ── TOML config file structure ──

interface RawConfigToml {
    api?: { url?: string; key?: string }
    statusBarApi?: { url?: string; key?: string }
    memoryApi?: { url?: string; key?: string }
    chat?: Partial<LLMConfig>
    statusBar?: Partial<LLMConfig>
    memory?: Partial<LLMConfig>
    pipeline?: {
        outputBudget?: number
        inlineMessageLimit?: number
        preciseMemoryLimit?: number
        compressPerTime?: number
    }
}

// ── CLI Argument Parsing ──

export interface CliArgs {
    configPath: string
    simulatorPath: string
    addonPaths: string[]
    loadPath?: string
}

export function parseCliArgs(argv: string[]): CliArgs {
    let configPath = 'config.toml'
    let simulatorPath = ''
    let loadPath: string | undefined
    const addonPaths: string[] = []

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!
        switch (arg) {
            case '--config':
            case '-c':
                configPath = argv[++i] ?? configPath
                break
            case '--simulator':
            case '-s':
                simulatorPath = argv[++i] ?? ''
                break
            case '--addon':
            case '-a':
                addonPaths.push(argv[++i] ?? '')
                break
            case '--load':
            case '-l':
                loadPath = argv[++i] ?? ''
                break
        }
    }

    if (!loadPath && !simulatorPath) {
        throw new Error('Missing required argument: --simulator <path.chr.toml> or --load <session.json>')
    }

    return { configPath, simulatorPath, addonPaths: addonPaths.filter(Boolean), loadPath: loadPath || undefined }
}

// ── File Loading ──

/**
 * Load the full AppConfig from CLI-specified files.
 */
export async function loadConfig(args: CliArgs): Promise<AppConfig> {
    // 1. Load config TOML (may not exist — use defaults)
    let rawConfig: RawConfigToml = {}
    const configFile = Bun.file(args.configPath)
    if (await configFile.exists()) {
        rawConfig = await readTomlFile(args.configPath) as RawConfigToml
    }

    // 2. Load simulator CHR
    const simulatorCHR = await readTomlFile(args.simulatorPath) as unknown as SimulatorCHR
    if (!simulatorCHR.universeName || !simulatorCHR.literalWorkName || !simulatorCHR.language || !simulatorCHR.statusBar) {
        throw new Error('Simulator CHR must include: universeName, literalWorkName, language, statusBar')
    }

    // 3. Load additional CHRs
    const additionalCHRs: AdditionalCHR[] = []
    for (const path of args.addonPaths) {
        const addon = await readTomlFile(path) as unknown as AdditionalCHR
        // Derive id from filename if not set in the file
        if (!addon.id) {
            const basename = path.replace(/\\/g, '/').split('/').pop() ?? path
            addon.id = basename.replace(/\.chr\.toml$|\.toml$/, '')
        }
        additionalCHRs.push(addon)
    }

    // 4. Merge config with defaults
    const defaultChat = defaultLLMConfig()
    const defaultLight = defaultLightweightLLMConfig()

    const config: AppConfig = {
        api: {
            url: rawConfig.api?.url ?? 'https://api.openai.com/v1/chat/completions',
            key: rawConfig.api?.key ?? '',
        },
        statusBarApi: rawConfig.statusBarApi ? {
            url: rawConfig.statusBarApi.url ?? rawConfig.api?.url ?? '',
            key: rawConfig.statusBarApi.key ?? rawConfig.api?.key ?? '',
        } : undefined,
        memoryApi: rawConfig.memoryApi ? {
            url: rawConfig.memoryApi.url ?? rawConfig.api?.url ?? '',
            key: rawConfig.memoryApi.key ?? rawConfig.api?.key ?? '',
        } : undefined,

        chatConfig: { ...defaultChat, ...rawConfig.chat },
        statusBarConfig: { ...defaultLight, ...rawConfig.statusBar },
        memoryConfig: { ...defaultLight, ...rawConfig.memory },

        outputBudget: rawConfig.pipeline?.outputBudget ?? 1024,
        inlineMessageLimit: rawConfig.pipeline?.inlineMessageLimit ?? 5,
        preciseMemoryLimit: rawConfig.pipeline?.preciseMemoryLimit ?? 20,
        compressPerTime: rawConfig.pipeline?.compressPerTime ?? 5,

        simulatorCHR,
        additionalCHRs,
    }

    return config
}

/**
 * Resolve which API endpoint to use for a given task.
 */
export function resolveApi(config: AppConfig, task: 'chat' | 'statusBar' | 'memory'): ApiEndpoint {
    switch (task) {
        case 'chat':
            return config.api
        case 'statusBar':
            return config.statusBarApi ?? config.api
        case 'memory':
            return config.memoryApi ?? config.api
    }
}
