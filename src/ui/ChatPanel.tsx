import { TextAttributes, SyntaxStyle, RGBA, type KeyEvent, type TextareaRenderable } from '@opentui/core'
import { createSignal, For, Show } from 'solid-js'
import { ChatBubble } from './ChatBubble'
import {
    messages,
    streamingContent,
    workStatus,
    isSending,
    inputText, setInputText,
    sendInstruction,
    getStatusText,
    parseCommand,
    addErrorMessage,
    addInfoMessage,
    clearErrors,
    cancelGeneration,
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
    let cancelTimer: ReturnType<typeof setTimeout> | null = null
    const [showCancelHint, setShowCancelHint] = createSignal(false)

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
        if (!text) return

        // Clear the textarea
        if (textareaRef) {
            textareaRef.selectAll()
            textareaRef.deleteSelection()
        }
        setInputText('')

        // Handle slash commands
        if (text.startsWith('/')) {
            clearErrors()
            const result = parseCommand(text)
            if (result.$k === 'error') addErrorMessage(result.message)
            else if (result.$k === 'info') addInfoMessage(result.message)
            return
        }

        if (isSending()) return
        sendInstruction(text)
    }

    function handleKeyDown(event: KeyEvent) {
        if (event.name === 'escape' && !event.ctrl && !event.shift && !event.meta) {
            if (!isSending()) return
            if (showCancelHint()) {
                // Second escape — cancel generation
                if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null }
                setShowCancelHint(false)
                cancelGeneration()
            } else {
                // First escape — show hint for 5 seconds
                setShowCancelHint(true)
                cancelTimer = setTimeout(() => {
                    setShowCancelHint(false)
                    cancelTimer = null
                }, 5000)
            }
            return
        }
        if (event.name === 'return' && !event.ctrl && !event.shift && !event.meta) {
            handleSubmit()
        }
    }

    return (
        <box flexDirection="column" width="100%" height="100%">
            {/* Message list */}
            <scrollbox
                flexGrow={1}
                stickyScroll
                stickyStart="bottom"
                scrollY
            >
                <box flexDirection="column" gap={1} width="100%">
                    <Show when={messages.length === 0 && !streamingContent()}>
                        <text fg={dimmed} content="发送消息以开始对话..." />
                    </Show>

                    <For each={messages}>
                        {(msg, i) => {
                            const reverseIndex = () => {
                                if (msg.$k === 'error' || msg.$k === 'info') return undefined
                                // Count non-error/info messages, compute reverse index
                                const editableCount = messages.filter(m => m.$k !== 'error' && m.$k !== 'info').length
                                const positionAmongEditable = messages.slice(0, i() + 1).filter(m => m.$k !== 'error' && m.$k !== 'info').length - 1
                                return editableCount - 1 - positionAmongEditable
                            }
                            return <ChatBubble message={msg} reverseIndex={reverseIndex()} />
                        }}
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
            <box flexDirection="column" flexShrink={0} marginTop={1} backgroundColor={bubbleBg} padding={1}>
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
            <box flexShrink={0} marginTop={1}>
                <Show when={showCancelHint()} fallback={
                    <text fg={statusColor()} content={getStatusText()} />
                }>
                    <text fg="#cc6600" content={`${getStatusText()} (再按一次 ESC 取消生成)`} />
                </Show>
            </box>
        </box>
    )
}
