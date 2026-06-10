import { TextAttributes, SyntaxStyle, RGBA, type KeyEvent, type TextareaRenderable } from '@opentui/core'
import { For, Show } from 'solid-js'
import { ChatBubble } from './ChatBubble'
import {
    messages,
    streamingContent,
    workStatus,
    isSending,
    inputText, setInputText,
    sendInstruction,
    getStatusText,
} from '../store'

const dimmed = '#888888'
const errorFg = '#cc0000'
const streamFg = '#996600'
const activeFg = '#0066cc'
const bubbleBg = '#e8e8e8'

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

export function ChatPanel() {
    let textareaRef: TextareaRenderable | undefined

    const statusColor = () => {
        const s = workStatus()
        if (s.$k.startsWith('error')) return errorFg
        if (s.$k === 'streaming') return streamFg
        if (s.$k === 'idle') return dimmed
        return activeFg
    }

    function handleSubmit() {
        // Read directly from the textarea renderable
        const text = (textareaRef?.plainText ?? inputText()).trim()
        if (!text || isSending()) return
        sendInstruction(text)
        // Clear the textarea
        if (textareaRef) {
            textareaRef.selectAll()
            textareaRef.deleteSelection()
        }
        setInputText('')
    }

    function handleKeyDown(event: KeyEvent) {
        if (event.name === 'return' && !event.ctrl && !event.shift && !event.meta) {
            handleSubmit()
        }
    }

    return (
        <box flexDirection="column" width="100%" height="100%">
            {/* Message list */}
            <scrollbox
                flexGrow={1}
                flexDirection="column"
                stickyScroll
                stickyStart="bottom"
                scrollY
            >
                <box flexDirection="column" gap={1} width="100%">
                    <Show when={messages.length === 0 && !streamingContent()}>
                        <text fg={dimmed} content="发送消息以开始对话..." />
                    </Show>

                    <For each={messages}>
                        {(msg) => <ChatBubble message={msg} />}
                    </For>

                    {/* Streaming bubble */}
                    <Show when={streamingContent()}>
                        <box
                            width="100%"
                            backgroundColor={bubbleBg}
                            flexDirection="column"
                            paddingX={1}
                            paddingY={1}
                        >
                            <text fg={streamFg} content="模拟器 (生成中...)" attributes={TextAttributes.BOLD} />
                            <markdown
                                content={streamingContent()}
                                syntaxStyle={mdStyle}
                                fg="#000000"
                                bg={bubbleBg}
                                streaming={true}
                                width="100%"
                            />
                        </box>
                    </Show>
                </box>
            </scrollbox>

            {/* Input area */}
            <box flexDirection="column" marginTop={1} backgroundColor={bubbleBg} padding={1}>
                <textarea
                    ref={textareaRef}
                    height={5}
                    width="100%"
                    placeholder="输入指令... (Enter 发送)"
                    backgroundColor={bubbleBg}
                    textColor="#000000"
                    focusedBackgroundColor={bubbleBg}
                    focusedTextColor="#000000"
                    placeholderColor={dimmed}
                    keyBindings={[
                        { name: "return", action: "submit" },
                    ]}
                    focused
                    onKeyDown={handleKeyDown}
                    onContentChange={(val: any) => setInputText(typeof val === 'string' ? val : val.content ?? '')}
                />
            </box>

            {/* Status bar */}
            <box marginTop={1}>
                <text fg={statusColor()} content={getStatusText()} />
            </box>
        </box>
    )
}
