export interface MessageBase<K extends string> {
    $k: K
}

export interface SimulatorMessage extends MessageBase<'simulator'> {
    content: string
    summarize: string
    statusBar: string
    coarseMemory: string
    activePreciseMemory: number
    promptTokens: number
    completionTokens: number
}

export interface PlayerMessage extends MessageBase<'player'> {
    content: string
}

export interface ErrorMessage extends MessageBase<'error'> {
    content: string
}

export interface InfoMessage extends MessageBase<'info'> {
    content: string
}

export type Message = SimulatorMessage | PlayerMessage | ErrorMessage | InfoMessage

export type WorkStatus =
    | { $k: 'idle' }
    | { $k: 'waiting' }
    | { $k: 'streaming'; chars: number; ttft: number; tps: number }
    | { $k: 'status-bar' }
    | { $k: 'compressing' }
    | { $k: 'error-main' }
    | { $k: 'error-status-bar' }
    | { $k: 'error-compress' }
