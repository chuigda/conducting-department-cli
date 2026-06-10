import { TextAttributes, SyntaxStyle, RGBA } from '@opentui/core'
import type { Message } from '../chat_message'

const fg = '#000000'
const dimmed = '#888888'
const simulatorFg = '#0055aa'
const playerFg = '#007744'
const errorFg = '#cc0000'
const infoFg = '#555555'
const infoBorder = '#5599cc'
const bubbleBg = '#e8e8e8'

// Markdown syntax style for light theme
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

interface ChatBubbleProps {
    message: Message
}

export function ChatBubble(props: ChatBubbleProps) {
    const roleLabel = () => {
        switch (props.message.$k) {
            case 'simulator': return '模拟器'
            case 'player': return '指挥部'
            case 'error': return '错误'
            case 'info': return '提示'
        }
    }

    const roleFg = () => {
        switch (props.message.$k) {
            case 'simulator': return simulatorFg
            case 'player': return playerFg
            case 'error': return errorFg
            case 'info': return infoFg
        }
    }

    const tokenInfo = () => {
        if (props.message.$k === 'simulator') {
            return `↑${props.message.promptTokens} ↓${props.message.completionTokens} tokens`
        }
        return ''
    }

    if (props.message.$k === 'error') {
        return (
            <box
                width="100%"
                flexDirection="column"
                paddingX={1}
                paddingY={1}
                border={["left"]}
                borderColor={errorFg}
            >
                <text fg={errorFg} content={roleLabel()} attributes={TextAttributes.BOLD} />
                <text wrapMode="word" fg={errorFg} content={props.message.content} />
            </box>
        )
    }

    if (props.message.$k === 'info') {
        return (
            <box
                width="100%"
                flexDirection="column"
                paddingX={1}
                paddingY={1}
                border={["left"]}
                borderColor={infoBorder}
            >
                <text fg={infoFg} content={roleLabel()} attributes={TextAttributes.BOLD} />
                <text wrapMode="word" fg={infoFg} content={props.message.content} />
            </box>
        )
    }

    return (
        <box
            width="100%"
            backgroundColor={bubbleBg}
            flexDirection="column"
            paddingX={1}
            paddingY={1}
        >
            <text fg={roleFg()} content={roleLabel()} attributes={TextAttributes.BOLD} />
            <markdown
                content={props.message.content}
                syntaxStyle={mdStyle}
                fg={fg}
                bg={bubbleBg}
                width="100%"
            />

            {props.message.$k === 'simulator' && props.message.summarize && (
                <text fg={dimmed} content={`摘要: ${props.message.summarize}`} attributes={TextAttributes.ITALIC} />
            )}

            {props.message.$k === 'simulator' && (
                <text fg={dimmed} content={tokenInfo()} />
            )}
        </box>
    )
}
