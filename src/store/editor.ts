/**
 * Editor overlay state machine.
 */

import type { SimulatorMessage } from '../chat_message'
import type { EditTarget } from './state'
import {
    messages, setMessages,
    editorState, setEditorState,
} from './state'

/**
 * Open the editor overlay for a given target.
 * Returns false if the target is invalid.
 */
export function openEditor(target: EditTarget): boolean {
    let draft = ''
    let label = ''

    switch (target.$k) {
        case 'message-content': {
            const msg = messages[target.index]
            if (!msg) return false
            draft = msg.content
            label = `编辑消息 #${target.index + 1} (${msg.$k === 'simulator' ? '模拟器' : msg.$k === 'player' ? '导演部' : '错误'})`
            break
        }
        case 'message-summary': {
            const msg = messages[target.index]
            if (!msg || msg.$k !== 'simulator') return false
            draft = (msg as SimulatorMessage).summarize
            label = `编辑摘要 #${target.index + 1}`
            break
        }
        case 'status-bar': {
            const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
            if (!last) return false
            draft = last.statusBar
            label = '编辑状态栏'
            break
        }
        case 'coarse-memory': {
            const last = messages.findLast(m => m.$k === 'simulator') as SimulatorMessage | undefined
            if (!last) return false
            draft = last.coarseMemory
            label = '编辑总结记忆'
            break
        }
    }

    setEditorState({ active: true, target, draft, label })
    return true
}

/**
 * Save the current editor draft back to the store.
 */
export function saveEditor() {
    const state = editorState()
    if (!state.active || !state.target) return

    const target = state.target
    const value = state.draft

    switch (target.$k) {
        case 'message-content': {
            setMessages(target.index, 'content', value)
            break
        }
        case 'message-summary': {
            setMessages(target.index, 'summarize' as any, value)
            break
        }
        case 'status-bar': {
            const idx = messages.findLastIndex(m => m.$k === 'simulator')
            if (idx >= 0) setMessages(idx, 'statusBar' as any, value)
            break
        }
        case 'coarse-memory': {
            const idx = messages.findLastIndex(m => m.$k === 'simulator')
            if (idx >= 0) setMessages(idx, 'coarseMemory' as any, value)
            break
        }
    }

    setEditorState({ active: false, target: null, draft: '', label: '' })
}

/**
 * Cancel editing and discard the draft.
 */
export function cancelEditor() {
    setEditorState({ active: false, target: null, draft: '', label: '' })
}

/**
 * Update the editor draft (called by the overlay textarea).
 */
export function setEditorDraft(value: string) {
    setEditorState(s => ({ ...s, draft: value }))
}
