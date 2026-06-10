/**
 * Prompt builder for the conducting-department-cli.
 *
 * Reads XML templates from the prompts/ directory and interpolates them
 * with CHR data and runtime context.
 *
 * Key difference from mangekyou-web:
 * - No PlayerCHR — the user is the "Conducting Department" (god-view director)
 * - User messages use <conducting-department> tag instead of <player>
 */

import { join } from 'path'
import type { SimulatorCHR, AdditionalCHR, LanguageSelector } from './chr_file'
import { LanguageConfigs } from './chr_file'
import type { Message, SimulatorMessage, ToolInteraction } from '../chat_message'

// ── Template Loading ──

const PROMPTS_DIR = join(import.meta.dir, '../../prompts')

async function loadTemplate(filename: string): Promise<string> {
    const file = Bun.file(join(PROMPTS_DIR, filename))
    return await file.text()
}

// Cache templates on first load
let templates: {
    simulatorSystem: string
    simulatorUserInstruction: string
    statusBarSystem: string
    statusBarUser: string
    memorySystem: string
    memoryUser: string
} | null = null

export async function ensureTemplates() {
    if (templates) return templates
    templates = {
        simulatorSystem: await loadTemplate('simulator.xml'),
        simulatorUserInstruction: await loadTemplate('simulator-user-instruction.xml'),
        statusBarSystem: await loadTemplate('status-bar.xml'),
        statusBarUser: await loadTemplate('status-bar-user.xml'),
        memorySystem: await loadTemplate('memory.xml'),
        memoryUser: await loadTemplate('memory-user.xml'),
    }
    return templates
}

// ── Utility ──

function isDefined<T>(v: T | undefined | null): v is T {
    return v !== undefined && v !== null
}

function isBlank(s: string): boolean {
    return s.trim().length === 0
}

/** Concatenate two optional strings with a newline separator */
function concat(a?: string, b?: string): string | undefined {
    if (!isDefined(a) || a.length === 0) return b
    if (!isDefined(b) || b.length === 0) return a
    return `${a}\n${b}`
}

/** Ensure string ends with newline, or empty if blank */
function sanitize(s?: string): string {
    if (!isDefined(s) || isBlank(s)) return ''
    return s.endsWith('\n') ? s : `${s}\n`
}

/** Format a ToolInteraction as XML for inclusion in prompts */
function formatToolInteractionXml(ti: ToolInteraction): string {
    const keyArg = extractToolKeyArgument(ti)
    const keyResult = extractToolKeyResult(ti)
    return `  <tool-call tool="${ti.$k}">\n    <arguments>${keyArg}</arguments>\n    <result>${keyResult}</result>\n  </tool-call>\n`
}

function extractToolKeyArgument(ti: ToolInteraction): string {
    switch (ti.$k) {
        case 'ask_question': return ti.prompt
        case 'read': return ti.path
    }
}

function extractToolKeyResult(ti: ToolInteraction): string {
    switch (ti.$k) {
        case 'ask_question': return ti.answer
        case 'read': return ti.success ? ti.result : `Error: ${ti.result}`
    }
}

/** Ensure string has leading and trailing newline for inline numbered lists */
function sanitize2(s?: string): string {
    if (!isDefined(s) || isBlank(s)) return ''
    return (s.startsWith('\n') ? '' : '\n') + s + (s.endsWith('\n') ? '' : '\n')
}

// ── Simulator System Prompt ──

export function buildSimulatorSystemPrompt(
    simulatorCHR: SimulatorCHR,
    additionalCHRs: AdditionalCHR[],
    outputBudget: number
): string {
    const t = templates!
    const { name: languageName, wordUnit } = LanguageConfigs[simulatorCHR.language]
    const lengthIndicator = `${outputBudget} ${wordUnit}`

    let additionalTasks: string | undefined
    let worldSettings: string | undefined
    let characterDatabase: string | undefined
    let additionalDatabaseSections: string | undefined
    let additionalBehaviors: string | undefined
    let additionalProhibitions: string | undefined
    let additionalSections: string | undefined

    if (isDefined(simulatorCHR.simulator)) {
        additionalTasks = simulatorCHR.simulator.tasks
        worldSettings = simulatorCHR.simulator.world
        characterDatabase = simulatorCHR.simulator.characters
        additionalDatabaseSections = simulatorCHR.simulator.database
        additionalBehaviors = simulatorCHR.simulator.behaviors
        additionalProhibitions = simulatorCHR.simulator.prohibitions
        additionalSections = simulatorCHR.simulator.sections
    }

    for (const chr of additionalCHRs) {
        if (isDefined(chr.simulator)) {
            additionalTasks = concat(additionalTasks, chr.simulator.tasks)
            worldSettings = concat(worldSettings, chr.simulator.world)
            characterDatabase = concat(characterDatabase, chr.simulator.characters)
            additionalDatabaseSections = concat(additionalDatabaseSections, chr.simulator.database)
            additionalBehaviors = concat(additionalBehaviors, chr.simulator.behaviors)
            additionalProhibitions = concat(additionalProhibitions, chr.simulator.prohibitions)
            additionalSections = concat(additionalSections, chr.simulator.sections)
        }
    }

    return t.simulatorSystem
        .replaceAll('    ', '')
        .replaceAll('{$UNIVERSE_NAME}', simulatorCHR.universeName)
        .replaceAll('{$LANGUAGE_SELECTION}', languageName)
        .replaceAll('{$LENGTH_INDICATOR}', lengthIndicator)
        .replaceAll('{$LITERAL_WORK_NAME}', simulatorCHR.literalWorkName)
        .replaceAll('{$ADDITIONAL_TASKS}\n', sanitize2(additionalTasks))
        .replaceAll('{$WORLD_SETTINGS}\n', sanitize(worldSettings))
        .replaceAll('{$CHARACTER_DATABASE}\n', sanitize(characterDatabase))
        .replaceAll('{$ADDITIONAL_DATABASE_SECTIONS}\n', sanitize(additionalDatabaseSections))
        .replaceAll('{$ADDITIONAL_BEHAVIORS}\n', sanitize2(additionalBehaviors))
        .replaceAll('{$ADDITIONAL_PROHIBITIONS}\n', sanitize2(additionalProhibitions))
        .replaceAll('{$ADDITIONAL_SECTIONS}\n', sanitize(additionalSections))
}

// ── Simulator User Prompt ──

export function buildSimulatorUserPrompt(
    simulatorCHR: SimulatorCHR,
    coarseMemory: string,
    preciseMemory: string,
    inlineMessages: Message[],
    statusBar: string,
    userAction: string
): string {
    const t = templates!
    const { name: languageName } = LanguageConfigs[simulatorCHR.language]

    let r = '<input>\n'
    r += `<memory type="coarse" comment="Summary of previous events">\n${sanitize(coarseMemory)}</memory>\n`
    r += `<memory type="precise" comment="Summary of recent events">\n${sanitize(preciseMemory)}</memory>\n`
    r += '\n'

    for (const msg of inlineMessages) {
        if (msg.$k === 'player') {
            r += `<conducting-department>\n${sanitize(msg.content)}</conducting-department>\n`
        } else if (msg.$k === 'simulator') {
            r += '<simulator>\n'
            if (msg.toolInteractions?.length) {
                for (const ti of msg.toolInteractions) {
                    r += formatToolInteractionXml(ti)
                }
            }
            r += `${sanitize(msg.content)}</simulator>\n`
        }
    }
    if (inlineMessages.length > 0) {
        r += '\n'
    }

    r += `<status comment="Most up-to-date world state">\n${sanitize(statusBar)}</status>\n`
    r += '\n'

    r += `<conducting-department>\n${sanitize(userAction)}</conducting-department>\n`
    r += '\n'

    r += t.simulatorUserInstruction
        .replaceAll('    ', '')
        .replaceAll('{$LANGUAGE_SELECTOR}', languageName)

    r += '</input>'
    return r
}

// ── Status Bar Updater ──

export function buildStatusBarUpdaterSystemPrompt(
    simulatorCHR: SimulatorCHR,
    additionalCHRs: AdditionalCHR[]
): string {
    const t = templates!
    const { name: languageName } = LanguageConfigs[simulatorCHR.language]

    let statusBarFormat = simulatorCHR.statusBar.format
    let statusBarUpdatingRule = simulatorCHR.statusBar.rule
    let additionalSections = simulatorCHR.statusBar.sections

    let worldSettings: string | undefined
    let characterDatabase: string | undefined
    let additionalDatabaseSections: string | undefined

    if (isDefined(simulatorCHR.simulator)) {
        worldSettings = simulatorCHR.simulator.world
        characterDatabase = simulatorCHR.simulator.characters
        additionalDatabaseSections = simulatorCHR.simulator.database
    }

    for (const chr of additionalCHRs) {
        if (isDefined(chr.statusBar)) {
            if (chr.statusBar.format) {
                statusBarFormat = concat(statusBarFormat, chr.statusBar.format) ?? statusBarFormat
            }
            statusBarUpdatingRule = concat(statusBarUpdatingRule, chr.statusBar.rule)
            additionalSections = concat(additionalSections, chr.statusBar.sections)
        }
        if (isDefined(chr.simulator)) {
            worldSettings = concat(worldSettings, chr.simulator.world)
            characterDatabase = concat(characterDatabase, chr.simulator.characters)
            additionalDatabaseSections = concat(additionalDatabaseSections, chr.simulator.database)
        }
    }

    return t.statusBarSystem
        .replaceAll('    ', '')
        .replaceAll('{$UNIVERSE_NAME}', simulatorCHR.universeName)
        .replaceAll('{$LANGUAGE_SELECTION}', languageName)
        .replaceAll('{$WORLD_SETTINGS}\n', sanitize(worldSettings))
        .replaceAll('{$CHARACTER_DATABASE}\n', sanitize(characterDatabase))
        .replaceAll('{$ADDITIONAL_DATABASE_SECTIONS}\n', sanitize(additionalDatabaseSections))
        .replaceAll('{$STATUS_BAR_UPDATING_RULE}\n', sanitize2(statusBarUpdatingRule))
        .replaceAll('{$ADDITIONAL_SECTIONS}\n', sanitize(additionalSections))
        .replaceAll('{$STATUS_BAR_FORMAT}\n', sanitize(statusBarFormat))
}

export function buildStatusBarUpdaterUserPrompt(
    coarseMemory: string,
    preciseMemory: string,
    simulatorOutputBefore: string,
    previousStatusBar: string,
    userInstruction: string,
    simulatorOutputAfter: string
): string {
    const t = templates!
    return t.statusBarUser
        .replaceAll('    ', '')
        .replaceAll('{$COARSE_MEMORY}\n', sanitize(coarseMemory))
        .replaceAll('{$PRECISE_MEMORY}\n', sanitize(preciseMemory))
        .replaceAll('{$SIMULATOR_OUTPUT_BEFORE_USER_INSTRUCTION}\n', sanitize(simulatorOutputBefore))
        .replaceAll('{$PREVIOUS_STATUS_BAR}\n', sanitize(previousStatusBar))
        .replaceAll('{$USER_INSTRUCTION}\n', sanitize(userInstruction))
        .replaceAll('{$SIMULATOR_OUTPUT_AFTER_USER_INSTRUCTION}\n', sanitize(simulatorOutputAfter))
}

// ── Memory Summarizer ──

export function buildMemorySummarizerSystemPrompt(
    simulatorCHR: SimulatorCHR,
    additionalCHRs: AdditionalCHR[]
): string {
    const t = templates!
    const { name: languageName } = LanguageConfigs[simulatorCHR.language]

    let memorySummarizingRules = simulatorCHR.memory?.rules
    let additionalSections = simulatorCHR.memory?.sections

    for (const chr of additionalCHRs) {
        if (isDefined(chr.memory)) {
            memorySummarizingRules = concat(memorySummarizingRules, chr.memory.rules)
            additionalSections = concat(additionalSections, chr.memory.sections)
        }
    }

    return t.memorySystem
        .replaceAll('    ', '')
        .replaceAll('{$UNIVERSE_NAME}', simulatorCHR.universeName)
        .replaceAll('{$LANGUAGE_SELECTION}', languageName)
        .replaceAll('{$MEMORY_SUMMARIZING_RULES}\n', sanitize2(memorySummarizingRules))
        .replaceAll('{$ADDITIONAL_SECTIONS}\n', sanitize(additionalSections))
}

export function buildMemorySummarizerUserPrompt(
    coarseMemory: string,
    preciseMemory: string
): string {
    const t = templates!
    return t.memoryUser
        .replaceAll('    ', '')
        .replaceAll('{$COARSE_MEMORY}\n', sanitize(coarseMemory))
        .replaceAll('{$PRECISE_MEMORY}\n', sanitize(preciseMemory))
}

// ── Message Windowing Utilities ──

/**
 * Compute the list of active precise memory strings from the message history.
 */
export function computePreciseMemoryInUse(messages: Message[]): string[] {
    const lastSim = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
    if (!lastSim) return []

    const result: string[] = []
    let restCount = lastSim.activePreciseMemory
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!
        if (msg.$k === 'simulator' && msg.summarize) {
            restCount -= 1
            result.push(msg.summarize)
            if (restCount <= 0) break
        }
    }

    return result.reverse()
}

/**
 * Slice the most recent N simulator turns (+ preceding conducting-department messages)
 * for inclusion as inline context in the user prompt.
 */
export function sliceInlineMessages(messages: Message[], limit: number): Message[] {
    if (limit <= 0) return []

    let simCount = 0
    let startIdx = 0
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.$k === 'simulator') {
            simCount += 1
            if (simCount >= limit) {
                startIdx = i
                if (i - 1 >= 0 && messages[i - 1]?.$k === 'player') {
                    startIdx = i - 1
                }
                break
            }
        }
    }

    return messages.slice(startIdx)
}
