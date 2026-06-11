import { render } from "@opentui/solid"
import { resolve } from 'path'
import { writeFileSync } from 'node:fs'
import { App } from "./src/ui/App"
import { parseCliArgs, loadConfig } from "./src/config"
import type { AppConfig } from "./src/config"
import { initStore, messages, addons, initSessionContext, getSessionContext } from "./src/store"
import { ensureTemplates } from "./src/llm/prompt_builder"
import { loadSessionFile, buildSessionFile } from "./src/session"
import type { AdditionalCHR } from "./src/llm/chr_file"
import { parse as parseToml } from 'smol-toml'

async function readTomlFile(filePath: string): Promise<Record<string, any>> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
        throw new Error(`File not found: ${filePath}`)
    }
    return parseToml(await file.text()) as Record<string, any>
}

async function main() {
    // Parse CLI args (skip first two: bun executable + script path)
    const args = parseCliArgs(process.argv.slice(2))

    let config: AppConfig
    let simulatorPath: string
    let addonPaths: string[]

    if (args.loadPath) {
        // ── Load from session file ──
        const session = await loadSessionFile(args.loadPath)

        simulatorPath = session.simulatorPath
        addonPaths = session.addons.map(a => a.path)

        // Load simulator CHR from saved path
        const simulatorCHR = await readTomlFile(session.simulatorPath) as unknown as import('./src/llm/chr_file').SimulatorCHR

        // Load addon CHRs from saved paths
        const additionalCHRs: AdditionalCHR[] = []
        for (const addon of session.addons) {
            const chr = await readTomlFile(addon.path) as unknown as AdditionalCHR
            if (!chr.id) {
                const basename = addon.path.replace(/\\/g, '/').split('/').pop() ?? addon.path
                chr.id = basename.replace(/\.chr\.toml$|\.toml$/, '')
            }
            additionalCHRs.push(chr)
        }

        // Reconstruct AppConfig from session
        config = {
            ...session.config,
            simulatorCHR,
            additionalCHRs,
        }

        // Apply --config override if specified
        if (args.configPath !== 'config.toml' || await Bun.file(args.configPath).exists()) {
            const overrideConfig = await loadConfig({
                configPath: args.configPath,
                simulatorPath: session.simulatorPath,
                addonPaths: [],
            })
            // Override API/LLM config from config.toml but keep CHRs from session
            config.api = overrideConfig.api
            if (overrideConfig.statusBarApi) config.statusBarApi = overrideConfig.statusBarApi
            if (overrideConfig.memoryApi) config.memoryApi = overrideConfig.memoryApi
            config.chatConfig = overrideConfig.chatConfig
            config.statusBarConfig = overrideConfig.statusBarConfig
            config.memoryConfig = overrideConfig.memoryConfig
            config.outputBudget = overrideConfig.outputBudget
            config.inlineMessageLimit = overrideConfig.inlineMessageLimit
            config.preciseMemoryLimit = overrideConfig.preciseMemoryLimit
            config.compressPerTime = overrideConfig.compressPerTime
        }

        // Apply -a overrides: append additional addons
        for (const path of args.addonPaths) {
            const chr = await readTomlFile(path) as unknown as AdditionalCHR
            if (!chr.id) {
                const basename = path.replace(/\\/g, '/').split('/').pop() ?? path
                chr.id = basename.replace(/\.chr\.toml$|\.toml$/, '')
            }
            config.additionalCHRs.push(chr)
            addonPaths.push(resolve(path))
        }

        // Load prompt templates
        await ensureTemplates()

        // Initialize store with config
        initStore(config)

        // Restore messages from session
        const { setMessages, setAddons } = await import('./src/store')
        setMessages(session.messages)

        // Restore addon enabled state (match by index since order is preserved)
        setAddons(config.additionalCHRs.map((chr, i) => ({
            chr,
            enabled: session.addons[i]?.enabled ?? true,
        })))

    } else {
        // ── Normal startup ──
        simulatorPath = args.simulatorPath
        addonPaths = args.addonPaths

        config = await loadConfig(args)
        await ensureTemplates()
        initStore(config)
    }

    // Determine save path
    const savePath = args.loadPath
        ? resolve(args.loadPath)
        : resolve(`session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

    // Initialize session context so /save and /discard can access it
    initSessionContext({ savePath, simulatorPath, addonPaths })

    // ── Render UI ──
    // Use onDestroy to save session synchronously before the process exits.
    // Ctrl+D triggers renderer.destroy() via useKeyboard in App.tsx.
    // Ctrl+C is repurposed for copy-selection.
    render(() => <App />, {
        exitOnCtrlC: false,
        useMouse: true,
        screenMode: "alternate-screen",
        onDestroy: () => {
            const ctx = getSessionContext()
            if (!ctx || ctx.discarded) return
            try {
                const session = buildSessionFile({
                    config,
                    messages: messages.slice(),
                    addons: addons(),
                    simulatorPath: ctx.simulatorPath,
                    addonPaths: ctx.addonPaths,
                })
                writeFileSync(ctx.savePath, JSON.stringify(session, null, 2))

                const relPath = ctx.savePath.replace(/\\/g, '/')
                const resumeArgs = [`--load "${relPath}"`]
                console.log(`\nSession saved to ${relPath}`)
                console.log(`Resume with: bun run index.tsx ${resumeArgs.join(' ')}`)
            } catch (_) {
                // Best effort — don't crash on save failure
            }
        },
    })
}

main().catch(err => {
    console.error('Fatal error:', err.message)
    process.exit(1)
})
