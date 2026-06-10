import { ChatPanel } from './ChatPanel'
import { StatusPanel } from './StatusPanel'

export function App() {
    return (
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
    )
}
