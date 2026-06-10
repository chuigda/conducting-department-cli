import { TextAttributes, SyntaxStyle, RGBA } from '@opentui/core'
import { For, Show, createMemo } from 'solid-js'
import { messages, getCoarseMemory, getPreciseMemoryEntries } from '../store'
import type { SimulatorMessage } from '../chat_message'

const fg = '#000000'
const dimmed = '#888888'
const panelBg = '#e8e8e8'

const mdStyle = SyntaxStyle.fromStyles({
    'markup.heading.1': { fg: RGBA.fromHex('#1a1a1a'), bold: true },
    'markup.heading.2': { fg: RGBA.fromHex('#1a1a1a'), bold: true },
    'markup.heading.3': { fg: RGBA.fromHex('#1a1a1a'), bold: true },
    'markup.heading': { fg: RGBA.fromHex('#1a1a1a'), bold: true },
    'markup.bold': { fg: RGBA.fromHex('#000000'), bold: true },
    'markup.italic': { fg: RGBA.fromHex('#000000'), italic: true },
    'markup.list': { fg: RGBA.fromHex('#333333') },
    'markup.raw': { fg: RGBA.fromHex('#5c2d91') },
    'markup.link': { fg: RGBA.fromHex('#0055aa') },
    'default': { fg: RGBA.fromHex('#000000') },
})

export function StatusPanel() {
    const latestStatusBar = createMemo(() => {
        const sims = messages.filter(m => m.$k === 'simulator') as SimulatorMessage[]
        if (sims.length === 0) return ''
        return sims[sims.length - 1]!.statusBar
    })

    const entries = createMemo(() => getPreciseMemoryEntries())
    const activeEntries = createMemo(() => entries().filter(e => e.active))
    const inactiveEntries = createMemo(() => entries().filter(e => !e.active))

    return (
        <box flexDirection="column" width="100%" height="100%">
            {/* Status Bar Section */}
            <box flexDirection="column" backgroundColor={panelBg} paddingX={1} paddingY={1}>
                <text content="状态栏" fg={fg} attributes={TextAttributes.BOLD} />
                <Show when={latestStatusBar()} fallback={<text content="暂无状态" fg={dimmed} />}>
                    <markdown
                        content={latestStatusBar()}
                        syntaxStyle={mdStyle}
                        fg={fg}
                        bg={panelBg}
                        width="100%"
                    />
                </Show>
            </box>

            {/* Coarse Memory Section */}
            <box flexDirection="column" backgroundColor={panelBg} paddingX={1} paddingY={1} marginTop={1}>
                <text content="总结记忆" fg={fg} attributes={TextAttributes.BOLD} />
                <Show when={getCoarseMemory()} fallback={<text content="暂无总结" fg={dimmed} />}>
                    <text wrapMode="word" fg={fg} content={getCoarseMemory()} />
                </Show>
            </box>

            {/* Precise Memory Section */}
            <box flexDirection="column" backgroundColor={panelBg} paddingX={1} paddingY={1} marginTop={1} flexGrow={1}>
                <text content={`精细记忆 (${entries().length})`} fg={fg} attributes={TextAttributes.BOLD} />
                <Show when={entries().length > 0} fallback={<text content="暂无条目" fg={dimmed} />}>
                    <scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom">
                        <box flexDirection="column" gap={1} width="100%">
                            <Show when={inactiveEntries().length > 0}>
                                <text fg={dimmed} content={`--- 非活动 (${inactiveEntries().length}) ---`} />
                                <For each={inactiveEntries()}>
                                    {(entry) => <text wrapMode="word" fg={dimmed} content={entry.text} />}
                                </For>
                            </Show>

                            <Show when={activeEntries().length > 0}>
                                <text fg={fg} content={`--- 活动 (${activeEntries().length}) ---`} />
                                <For each={activeEntries()}>
                                    {(entry) => <text wrapMode="word" fg={fg} content={entry.text} />}
                                </For>
                            </Show>
                        </box>
                    </scrollbox>
                </Show>
            </box>
        </box>
    )
}
