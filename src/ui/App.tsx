import { Show } from 'solid-js'
import { ChatPanel } from './ChatPanel'
import { StatusPanel } from './StatusPanel'
import { EditOverlay } from './EditOverlay'
import { editorState } from '../store'

export function App() {
    return (
        <Show when={!editorState().active} fallback={<EditOverlay />}>
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
