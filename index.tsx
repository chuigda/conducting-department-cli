import { render } from "@opentui/solid"
import { App } from "./src/ui/App"
import { parseCliArgs, loadConfig } from "./src/config"
import { initStore } from "./src/store"
import { ensureTemplates } from "./src/llm/prompt_builder"

async function main() {
    // Parse CLI args (skip first two: bun executable + script path)
    const args = parseCliArgs(process.argv.slice(2))

    // Load configuration and CHR files
    const config = await loadConfig(args)

    // Load prompt templates
    await ensureTemplates()

    // Initialize store with config
    initStore(config)

    // Render UI
    render(() => <App />, {
        exitOnCtrlC: true,
        useMouse: true,
        screenMode: "alternate-screen",
    })
}

main().catch(err => {
    console.error('Fatal error:', err.message)
    process.exit(1)
})
