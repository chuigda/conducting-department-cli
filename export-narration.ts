/**
 * Narration Exporter
 * Exports session.json to XML format with conducting-department instructions,
 * simulator narration, and tool interactions.
 *
 * Usage: bun run export-narration.ts [input.json] [output.xml]
 */

import { basename } from 'path'
import type { SessionFile } from './src/session'
import type { ToolInteraction } from './src/chat_message'
import { extractKeyArgument, extractKeyResult } from './src/llm/tools'

function formatToolInteraction(tool: ToolInteraction): string {
    const args = extractKeyArgument(tool)
    const result = extractKeyResult(tool)
    return `  <tool tool-id="${tool.$k}">\n    <arguments>\n${args}\n    </arguments>\n    <result>\n${result}\n    </result>\n  </tool>`
}

function exportNarration(session: SessionFile): string {
    const lines: string[] = ['<session>']

    lines.push(`<simulator>${session.simulatorPath}</simulator>`)
    lines.push(`<narrator>${session.config.chatConfig.model}</narrator>`)

    // Addon list
    if (session.addons && session.addons.length > 0) {
        lines.push('<addons>')
        for (const addon of session.addons) {
            const name = basename(addon.path)
            lines.push(`  <addon enabled="${addon.enabled}">${name}</addon>`)
        }
        lines.push('</addons>')
    }

    for (const msg of session.messages) {
        switch (msg.$k) {
            case 'player': {
                lines.push(`<conducting-department>`)
                lines.push(msg.content)
                lines.push(`</conducting-department>`)
                break
            }
            case 'simulator': {
                lines.push(`<simulator>`)
                if (msg.toolInteractions && msg.toolInteractions.length > 0) {
                    for (const tool of msg.toolInteractions) {
                        lines.push(formatToolInteraction(tool))
                    }
                }
                lines.push(msg.content)
                lines.push(`</simulator>`)
                break
            }
            // skip error/info messages
        }
    }

    lines.push('</session>')
    return lines.join('\n')
}

// ── CLI ──

const inputPath = Bun.argv[2] ?? 'session.json'
const outputPath = Bun.argv[3] ?? inputPath.replace(/\.json$/, '.xml')

const file = Bun.file(inputPath)
if (!(await file.exists())) {
    console.error(`File not found: ${inputPath}`)
    process.exit(1)
}

const session: SessionFile = await file.json()
const xml = exportNarration(session)

await Bun.write(outputPath, xml)
console.log(`Exported to ${outputPath}`)
