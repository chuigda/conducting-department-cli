/**
 * Slash command parsing and execution.
 */

import { resolve } from 'path'
import { writeFileSync } from 'node:fs'
import type { AppConfig } from '../config'
import type { SimulatorMessage } from '../chat_message'
import { buildSessionFile } from '../session'
import {
    messages, setMessages,
    isSending,
    addons, setAddons,
    addErrorMessage, addInfoMessage,
    clearErrors, deleteMessage,
    getAppConfig, getSessionCtxMut,
} from './state'
import { openEditor } from './editor'
import { sendInstruction, regenStatusBar } from './actions'

export type CommandResult =
    | { $k: 'ok' }
    | { $k: 'error'; message: string }
    | { $k: 'info'; message: string }

/**
 * Parse and execute a slash command.
 * /edit N uses reverse indexing over non-error messages: 0 = latest, 1 = second latest, etc.
 */
export function parseCommand(input: string): CommandResult {
    const parts = input.trim().split(/\s+/)
    const cmd = parts[0]!

    switch (cmd) {
        case '/edit':
            return wrapError(handleEditCommand(parts))
        case '/resend':
            return wrapError(handleResendCommand())
        case '/status':
            return handleStatusCommand(parts)
        case '/del':
            return handleDelCommand(parts)
        case '/save':
            return handleSaveCommand(parts)
        case '/discard':
            return handleDiscardCommand()
        case '/clear':
            clearErrors()
            return { $k: 'ok' }
        case '/addon':
            return handleAddonCommand(parts)
        case '/model':
            return handleModelCommand(parts)
        case '/help':
            return { $k: 'info', message: HELP_TEXT }
        default:
            return { $k: 'error', message: `未知命令 "${cmd}"。输入 /help 查看可用命令` }
    }
}

/** Convert old null/string return to CommandResult */
function wrapError(result: string | null): CommandResult {
    return result ? { $k: 'error', message: result } : { $k: 'ok' }
}

/**
 * Get non-error messages (used for /edit indexing).
 */
function getEditableMessages() {
    return messages
        .map((m, i) => ({ msg: m, realIndex: i }))
        .filter(({ msg }) => msg.$k !== 'error' && msg.$k !== 'info')
}

function handleEditCommand(parts: string[]): string | null {
    const sub = parts[1]

    // /edit with no args = /edit 0
    if (!sub) {
        const editable = getEditableMessages()
        if (editable.length === 0) return '没有可编辑的消息'
        const last = editable[editable.length - 1]!
        return openEditor({ $k: 'message-content', index: last.realIndex }) ? null : '无法打开编辑器'
    }

    // /edit status
    if (sub === 'status') {
        return openEditor({ $k: 'status-bar' }) ? null : '没有状态栏可编辑 (尚无模拟器消息)'
    }

    // /edit coarse
    if (sub === 'coarse') {
        return openEditor({ $k: 'coarse-memory' }) ? null : '没有总结记忆可编辑 (尚无模拟器消息)'
    }

    // /edit N [summary] — N is reverse index over non-error messages
    const n = parseInt(sub, 10)
    if (isNaN(n) || n < 0) {
        return '未知命令。可用: /edit [N], /edit N summary, /edit status, /edit coarse'
    }

    const editable = getEditableMessages()
    const reverseIdx = editable.length - 1 - n
    if (reverseIdx < 0) {
        return `消息 #${n} 不存在 (共 ${editable.length} 条可编辑消息, 0=最新)`
    }

    const { msg, realIndex } = editable[reverseIdx]!

    const modifier = parts[2]
    if (modifier === 'summary') {
        if (msg.$k !== 'simulator') {
            return `消息 #${n} 不是模拟器消息，没有摘要字段`
        }
        return openEditor({ $k: 'message-summary', index: realIndex }) ? null : '无法打开编辑器'
    }

    if (modifier) {
        return `未知修饰符 "${modifier}"。可用: summary`
    }

    return openEditor({ $k: 'message-content', index: realIndex }) ? null : '无法打开编辑器'
}

function handleResendCommand(): string | null {
    if (isSending()) return '正在生成中，无法重发'

    // Find last player message
    const lastPlayer = messages.findLast(m => m.$k === 'player')
    if (!lastPlayer) return '没有可重发的用户消息'

    // Remove last player message and any simulator message after it
    const lastPlayerIdx = messages.lastIndexOf(lastPlayer)
    const kept = messages.slice(0, lastPlayerIdx)
    setMessages(kept)

    // Re-send
    sendInstruction(lastPlayer.content)
    return null
}

function handleStatusCommand(parts: string[]): CommandResult {
    const action = parts[1]
    if (action === 'regen') {
        if (isSending()) return { $k: 'error', message: '正在生成中，无法重新生成状态栏' }
        const hasSim = messages.some(m => m.$k === 'simulator')
        if (!hasSim) return { $k: 'error', message: '没有模拟器消息，无法生成状态栏' }
        regenStatusBar()
        return { $k: 'ok' }
    }
    return { $k: 'error', message: '用法: /status regen' }
}

function handleDelCommand(parts: string[]): CommandResult {
    const nStr = parts[1]
    if (!nStr) return { $k: 'error', message: '用法: /del <N> (N=倒序索引, 0=最新)' }

    const n = parseInt(nStr, 10)
    if (isNaN(n) || n < 0) return { $k: 'error', message: 'N 必须为非负整数' }

    const editable = getEditableMessages()
    const reverseIdx = editable.length - 1 - n
    if (reverseIdx < 0) {
        return { $k: 'error', message: `消息 #${n} 不存在 (共 ${editable.length} 条消息, 0=最新)` }
    }

    const { realIndex } = editable[reverseIdx]!
    deleteMessage(realIndex)
    return { $k: 'info', message: `已删除消息 #${n}` }
}

function handleAddonCommand(parts: string[]): CommandResult {
    const action = parts[1]

    // /addon with no args — list addons
    if (!action) {
        const list = addons()
        if (list.length === 0) return { $k: 'info', message: '没有加载任何附加模块' }
        const lines = list.map((entry, i) => {
            const status = entry.enabled ? '启用' : '禁用'
            return `  ${i + 1}. [${status}] ${entry.chr.id}${entry.chr.name ? ` (${entry.chr.name})` : ''}`
        })
        return { $k: 'info', message: lines.join('\n') }
    }

    // /addon enable <id>
    if (action === 'enable') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon enable <id>' }
        const list = addons()
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        if (list[idx]!.enabled) return { $k: 'info', message: `附加模块 "${id}" 已经是启用状态` }
        setAddons(list.map((e, i) => i === idx ? { ...e, enabled: true } : e))
        return { $k: 'ok' }
    }

    // /addon disable <id>
    if (action === 'disable') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon disable <id>' }
        const list = addons()
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        if (!list[idx]!.enabled) return { $k: 'info', message: `附加模块 "${id}" 已经是禁用状态` }
        setAddons(list.map((e, i) => i === idx ? { ...e, enabled: false } : e))
        return { $k: 'ok' }
    }

    // /addon up <id> [n]
    if (action === 'up') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon up <id> [n]' }
        const n = parseInt(parts[3] ?? '1', 10)
        if (isNaN(n) || n < 1) return { $k: 'error', message: '移动步数必须为正整数' }
        const list = [...addons()]
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        const target = Math.max(0, idx - n)
        if (target === idx) return { $k: 'info', message: `附加模块 "${id}" 已在顶部` }
        const [item] = list.splice(idx, 1)
        list.splice(target, 0, item!)
        setAddons(list)
        return { $k: 'ok' }
    }

    // /addon down <id> [n]
    if (action === 'down') {
        const id = parts[2]
        if (!id) return { $k: 'error', message: '用法: /addon down <id> [n]' }
        const n = parseInt(parts[3] ?? '1', 10)
        if (isNaN(n) || n < 1) return { $k: 'error', message: '移动步数必须为正整数' }
        const list = [...addons()]
        const idx = list.findIndex(e => e.chr.id === id)
        if (idx < 0) return { $k: 'error', message: `附加模块 "${id}" 不存在` }
        const target = Math.min(list.length - 1, idx + n)
        if (target === idx) return { $k: 'info', message: `附加模块 "${id}" 已在底部` }
        const [item] = list.splice(idx, 1)
        list.splice(target, 0, item!)
        setAddons(list)
        return { $k: 'ok' }
    }

    return { $k: 'error', message: '用法: /addon, /addon enable/disable <id>, /addon up/down <id> [n]' }
}

function handleSaveCommand(parts: string[]): CommandResult {
    const sessionCtx = getSessionCtxMut()
    const appConfig = getAppConfig()
    if (!sessionCtx || !appConfig) return { $k: 'error', message: '会话上下文未初始化' }

    // /save as <filename>
    if (parts[1] === 'as') {
        const filename = parts.slice(2).join(' ').trim()
        if (!filename) return { $k: 'error', message: '用法: /save as <filename>' }
        sessionCtx.savePath = resolve(filename)
    } else if (parts[1]) {
        return { $k: 'error', message: '用法: /save 或 /save as <filename>' }
    }

    try {
        const session = buildSessionFile({
            config: appConfig,
            messages: messages.slice(),
            addons: addons(),
            simulatorPath: sessionCtx.simulatorPath,
        })
        writeFileSync(sessionCtx.savePath, JSON.stringify(session, null, 2))
        return { $k: 'info', message: `已保存到 ${sessionCtx.savePath}` }
    } catch (e: any) {
        return { $k: 'error', message: `保存失败: ${e?.message ?? e}` }
    }
}

function handleDiscardCommand(): CommandResult {
    const sessionCtx = getSessionCtxMut()
    if (!sessionCtx) return { $k: 'error', message: '会话上下文未初始化' }
    sessionCtx.discarded = true
    process.exit(0)
}

function handleModelCommand(parts: string[]): CommandResult {
    const appConfig = getAppConfig()
    if (!appConfig) return { $k: 'error', message: '配置未初始化' }

    // /model with no args — show current model config
    if (parts.length === 1) {
        const lines = [
            `当前模型配置:`,
            `  simulator: ${appConfig.chatConfig.model}`,
            `  status:    ${appConfig.statusBarConfig.model}`,
            `  memory:    ${appConfig.memoryConfig.model}`,
        ]
        return { $k: 'info', message: lines.join('\n') }
    }

    const target = parts[1]
    const modelId = parts.slice(2).join(' ')

    if (!modelId) {
        return { $k: 'error', message: '用法: /model simulator|status|memory <model-id>' }
    }

    switch (target) {
        case 'simulator':
            appConfig.chatConfig.model = modelId
            return { $k: 'info', message: `simulator 模型已设置为: ${modelId}` }
        case 'status':
            appConfig.statusBarConfig.model = modelId
            return { $k: 'info', message: `status 模型已设置为: ${modelId}` }
        case 'memory':
            appConfig.memoryConfig.model = modelId
            return { $k: 'info', message: `memory 模型已设置为: ${modelId}` }
        default:
            return { $k: 'error', message: `未知目标 "${target}"。可用: simulator, status, memory` }
    }
}

export const HELP_TEXT = `可用命令:
  /edit [N]         编辑消息 (N=倒序索引, 0=最新, 默认0)
  /edit N summary   编辑模拟器消息的摘要
  /edit status      编辑状态栏
  /edit coarse      编辑总结记忆
  /resend           重发上一条用户消息，重新生成
  /status regen     重新生成状态栏
  /del <N>          删除消息 (N=倒序索引, 0=最新)
  /save             保存会话
  /save as <file>   另存为指定文件，后续自动保存到该文件
  /discard          放弃保存并退出
  /addon            列出所有附加模块
  /addon enable <id>    启用附加模块
  /addon disable <id>   禁用附加模块
  /addon up <id> [n]    上移附加模块优先级
  /addon down <id> [n]  下移附加模块优先级
  /model            查看当前模型配置
  /model simulator|status|memory <model-id>  设置模型
  /clear            清除错误/提示消息
  /help             显示帮助`
