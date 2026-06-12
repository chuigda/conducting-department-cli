/**
 * Store barrel — re-exports all public store API for backward compatibility.
 *
 * External modules import from '../store' (or './store') as before.
 */

// ── State, signals, and basic actions ──
export {
    // Types
    type EditTarget,
    type EditorState,
    type AddonEntry,
    type SessionContext,
    type QuestionState,

    // Session context
    initSessionContext,
    getSimulatorPath,
    getSessionContext,

    // App config
    getAppConfig,
    initStore,

    // Signals (read)
    messages,
    streamingContent,
    toolCallLog,
    workStatus,
    isSending,
    inputText,
    editorState,
    questionState,
    addons,

    // Signals (write)
    setMessages,
    setStreamingContent,
    setToolCallLog,
    setWorkStatus,
    setIsSending,
    setInputText,
    setEditorState,
    setQuestionState,
    setAddons,

    // Derived state
    getCoarseMemory,
    getPreciseMemoryEntries,
    getActiveAddons,

    // Basic message actions
    addPlayerMessage,
    addSimulatorMessage,
    addErrorMessage,
    addInfoMessage,
    clearErrors,
    deleteMessage,

    // Question actions
    showQuestion,
    answerQuestion,
    skipQuestion,

    // Abort
    cancelGeneration,
    setAbortController,
    getAbortController,

    // Status text
    getStatusText,
} from './state'

// ── Async pipeline actions ──
export { sendInstruction, regenStatusBar } from './actions'

// ── Editor overlay ──
export { openEditor, saveEditor, cancelEditor, setEditorDraft } from './editor'

// ── Slash commands ──
export { parseCommand, HELP_TEXT, type CommandResult } from './commands'
