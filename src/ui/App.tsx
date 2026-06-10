import { Show } from 'solid-js'
import { useKeyboard, useRenderer, useSelectionHandler } from '@opentui/solid'
import { ChatPanel } from './ChatPanel'
import { StatusPanel } from './StatusPanel'
import { EditOverlay } from './EditOverlay'
import { QuestionOverlay } from './QuestionOverlay'
import { editorState, questionState } from '../store'

export function App() {
    const renderer = useRenderer()

    // Ctrl+D → exit (replaces the old Ctrl+C exit)
    // Ctrl+C → copy current terminal selection to clipboard
    useKeyboard((key) => {
        if (key.ctrl && key.name === 'd') {
            renderer.destroy()
        }
        if (key.ctrl && key.name === 'c') {
            const sel = renderer.currentSelection?.()
            const text = sel?.getSelectedText?.()
            if (text) {
                renderer.copyToClipboardOSC52(text)
            }
        }
    })

    // Right-click selection area → auto-copy to clipboard
    useSelectionHandler((selection) => {
        const text = selection.getSelectedText?.()
        if (text) {
            renderer.copyToClipboardOSC52(text)
        }
    })

    return (
        <Show when={!editorState().active && !questionState().active}
            fallback={
                <Show when={questionState().active} fallback={<EditOverlay />}>
                    <QuestionOverlay />
                </Show>
            }
        >
            <box
                flexDirection="row"
                width="100%"
                height="100%"
                gap={2}
                padding={1}
            >
                {/* Left: Chat panel (60%) */}
                <box width="60%" height="100%">
                    <ChatPanel />
                </box>

                {/* Right: Status panel (40%) */}
                <box width="40%" height="100%">
                    <StatusPanel />
                </box>
            </box>
        </Show>
    )
}
