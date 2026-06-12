# AGENTS.md

## Runtime & toolchain

- **Bun** is the sole runtime. No Node, no bundler, no build step.
- Run the app: `bun run index.tsx --simulator <simulator.chr.toml> [-a addon.chr.toml ...] [-c config.toml]`
- Resume session: `bun run index.tsx --load session-*.json`
- Export narration: `bun run export-narration.ts [input.json] [output.xml]`
- Install deps: `bun install`
- No test suite, no linter, no formatter, no CI configured.

## TypeScript strictness

- `strict: true` with `noUncheckedIndexedAccess` — every indexed access is `T | undefined`.
- `verbatimModuleSyntax` — use `import type { ... }` for type-only imports or tsc will error.
- JSX uses `@opentui/solid` (not React). The preload is in `bunfig.toml`.
- `"module": "Preserve"` + `"moduleResolution": "bundler"` — use `.ts`/`.tsx` extensions in imports.

## Architecture

```
index.tsx              — CLI entrypoint: arg parsing, config load, render
src/config.ts          — TOML config parsing, CLI arg types, AppConfig
src/store.ts           — SolidJS reactive global state (messages, addons)
src/session.ts         — session save/load serialization
src/chat_message.ts    — message type definitions
src/llm/
  client.ts            — OpenAI-compatible streaming/non-streaming HTTP client
  pipeline.ts          — core send flow: stream response → status bar → memory compress
  context.ts           — builds request payloads for simulator, status bar, memory
  prompt_builder.ts    — renders XML prompt templates from prompts/
  chr_file.ts          — CHR TOML type definitions
src/ui/                — OpenTUI + SolidJS terminal UI components
prompts/               — XML prompt templates (system + user messages)
simulators/            — CHR world definition files (*.simulator.chr.toml, *.addon.chr.toml)
```

## Key conventions

- Config file `config.toml` is **gitignored** (contains API keys). Copy from `config.example.toml`.
- Session files (`session-*.json`) are also gitignored.
- CHR files use the naming pattern `<name>.simulator.chr.toml` or `<name>.addon.chr.toml`.
- The LLM client speaks **OpenAI chat completions** format (`/v1/chat/completions`) — not Anthropic native.
- Three separate model configs exist: `chat` (strong, streaming), `statusBar` (lightweight), `memory` (lightweight). Each can point to a different API endpoint.
- The pipeline has tool-call support: `ask_question`, `read`, `glob` — these are tools the LLM calls during generation, not dev tools.

## Agent rules

- Do NOT use the fxcking Explore subagent in this repo
- Also NOT using the General subagent to do explore task

## Gotchas

- There is no typecheck CI gate but `strict` is on. Run `bunx tsc --noEmit` to verify.
- `stock/` directory exists at root but is not referenced in code — likely asset storage.
- The app runs in alternate-screen terminal mode; Ctrl+C is repurposed for copy (not exit). Exit is Ctrl+D.
