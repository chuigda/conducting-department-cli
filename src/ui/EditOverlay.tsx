import { TextAttributes, type KeyEvent, type TextareaRenderable } from '@opentui/core'
import { createEffect, createSignal } from 'solid-js'
import {
    editorState,
    saveEditor,
    cancelEditor,
    setEditorDraft,
} from '../store'

const overlayBg = '#f0f0f0'
const headerFg = '#000000'
const hintFg = '#666666'

export function EditOverlay() {
    let initialized = false
    const [ref, setRef] = createSignal<TextareaRenderable | undefined>()

    // When the ref becomes available, insert the draft and focus
    createEffect(() => {
        const textarea = ref()
        if (textarea && !initialized) {
            initialized = true
            const draft = editorState().draft
            if (draft) {
                textarea.insertText(draft)
            }
            textarea.focus()
        }
    })

    const handleKeyDown = (e: KeyEvent) => {
        // Ctrl+S or Ctrl+Enter to save
        if ((e.name === 's' || e.name === 'return') && e.ctrl && !e.shift && !e.meta) {
            e.preventDefault?.()
            const textarea = ref()
            if (textarea) setEditorDraft(textarea.plainText)
            saveEditor()
            return
        }
        // Escape to cancel
        if (e.name === 'escape' && !e.ctrl && !e.shift && !e.meta) {
            e.preventDefault?.()
            cancelEditor()
            return
        }
    }

    return (
        <box
            width="100%"
            height="100%"
            backgroundColor={overlayBg}
            flexDirection="column"
            padding={1}
        >
            {/* Header */}
            <box flexDirection="row" width="100%" marginBottom={1}>
                <text
                    fg={headerFg}
                    content={editorState().label}
                    attributes={TextAttributes.BOLD}
                    flexGrow={1}
                />
                <text fg={hintFg} content="Ctrl+S / Ctrl+Enter 保存 | Escape 取消" />
            </box>

            {/* Textarea */}
            <textarea
                ref={setRef}
                width="100%"
                flexGrow={1}
                backgroundColor="#ffffff"
                textColor="#000000"
                focusedBackgroundColor="#ffffff"
                focusedTextColor="#000000"
                onContentChange={() => {
                    const textarea = ref()
                    if (textarea) setEditorDraft(textarea.plainText)
                }}
                onKeyDown={handleKeyDown}
                focused={true}
                placeholder="输入内容..."
            />
        </box>
    )
}
