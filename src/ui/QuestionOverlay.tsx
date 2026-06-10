import { TextAttributes, type KeyEvent } from '@opentui/core'
import { createSignal, Show, For } from 'solid-js'
import { useKeyboard } from '@opentui/solid'
import {
    questionState,
    answerQuestion,
    skipQuestion,
} from '../store'

const overlayBg = '#f0f0f0'
const headerFg = '#000000'
const hintFg = '#666666'
const optionBg = '#e0e0e0'
const selectedOptionBg = '#c0c0ff'
const optionFg = '#000000'
const inputBg = '#ffffff'

export function QuestionOverlay() {
    const [selectedIndex, setSelectedIndex] = createSignal(0)
    const [freeInput, setFreeInput] = createSignal('')
    const [mode, setMode] = createSignal<'select' | 'input'>(
        questionState().options.length > 0 ? 'select' : 'input'
    )

    const state = () => questionState()

    useKeyboard((key) => {
        if (!state().active) return

        // Escape → skip
        if (key.name === 'escape') {
            skipQuestion()
            return
        }

        // Tab → toggle between select and free input (only if options exist)
        if (key.name === 'tab' && state().options.length > 0) {
            setMode(m => m === 'select' ? 'input' : 'select')
            return
        }

        if (mode() === 'select') {
            const opts = state().options
            if (key.name === 'up' || key.name === 'k') {
                setSelectedIndex(i => Math.max(0, i - 1))
            } else if (key.name === 'down' || key.name === 'j') {
                setSelectedIndex(i => Math.min(opts.length - 1, i + 1))
            } else if (key.name === 'return' && !key.ctrl) {
                const answer = opts[selectedIndex()]
                if (answer) answerQuestion(answer)
            }
        } else {
            // Input mode: Ctrl+Enter or Ctrl+S to submit, Enter to newline
            if ((key.name === 'return' && key.ctrl) || (key.name === 's' && key.ctrl)) {
                if (freeInput().trim()) {
                    answerQuestion(freeInput().trim())
                }
            } else if (key.name === 'return' && !key.ctrl) {
                setFreeInput(s => s + '\n')
            } else if (key.name === 'backspace') {
                setFreeInput(s => s.slice(0, -1))
            } else if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
                setFreeInput(s => s + key.sequence)
            }
        }
    })

    return (
        <box
            width="100%"
            height="100%"
            backgroundColor={overlayBg}
            flexDirection="column"
            padding={2}
        >
            {/* Header */}
            <text
                fg={headerFg}
                content="🤔 模拟器提问"
                attributes={TextAttributes.BOLD}
                marginBottom={1}
            />

            {/* Question prompt */}
            <box marginBottom={1} width="100%">
                <text fg="#000000" content={state().prompt} />
            </box>

            {/* Options list (if any) */}
            <Show when={state().options.length > 0}>
                <box flexDirection="column" marginBottom={1} width="100%">
                    <text fg={hintFg} content="选项 (↑↓ 选择, Enter 确认):" marginBottom={1} />
                    <For each={state().options}>
                        {(option, index) => (
                            <box
                                width="100%"
                                backgroundColor={mode() === 'select' && index() === selectedIndex() ? selectedOptionBg : optionBg}
                                paddingLeft={1}
                                paddingRight={1}
                                marginBottom={0}
                            >
                                <text
                                    fg={optionFg}
                                    content={`${mode() === 'select' && index() === selectedIndex() ? '▸ ' : '  '}${option}`}
                                />
                            </box>
                        )}
                    </For>
                </box>
            </Show>

            {/* Free input area */}
            <box flexDirection="column" width="100%" marginTop={1}>
                <text
                    fg={hintFg}
                    content={state().options.length > 0 ? "自由输入 (Tab 切换):" : "输入回答:"}
                    marginBottom={0}
                />
                <box
                    width="100%"
                    backgroundColor={mode() === 'input' ? selectedOptionBg : inputBg}
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={optionFg}
                        content={freeInput() || (mode() === 'input' ? '▍' : '')}
                    />
                </box>
            </box>

            {/* Hints */}
            <box marginTop={2} width="100%">
                <text fg={hintFg} content="Ctrl+Enter / Ctrl+S 提交 | Escape 跳过 | Tab 切换模式" />
            </box>
        </box>
    )
}
