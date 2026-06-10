/**
 * CHR (Character/Config) file type definitions.
 * In conducting mode, there's no PlayerCHR — the user is the "Conducting Department",
 * a god-view director who doesn't play a specific character.
 */

export type LanguageSelector = 'zh_CN' | 'en_US'

export interface LanguageConfig {
    name: string
    wordUnit: string
}

export const LanguageConfigs: Record<LanguageSelector, LanguageConfig> = {
    zh_CN: { name: '简体中文', wordUnit: '汉字' },
    en_US: { name: 'English', wordUnit: 'words' },
}

export interface SimulatorCHR {
    universeName: string
    literalWorkName: string
    prologue?: string
    language: LanguageSelector

    statusBar: StatusBarConfig
    simulator?: SimulatorConfig
    memory?: MemorySummarizerConfig
}

export interface AdditionalCHR {
    name?: string
    statusBar?: StatusBarConfig
    simulator?: SimulatorConfig
    memory?: MemorySummarizerConfig
}

export interface StatusBarConfig {
    format: string
    rule?: string
    sections?: string
}

export interface SimulatorConfig {
    tasks?: string
    commands?: string
    world?: string
    characters?: string
    database?: string
    behaviors?: string
    prohibitions?: string
    sections?: string
}

export interface MemorySummarizerConfig {
    rules?: string
    sections?: string
}
