# Conducting Department CLI — 导演部

这天，从 OpenCode 归来的 Chuigda Whitegive，带来了比 mangekyou-web 更富有威力的 conducting-department-cli。

Conducting Department CLI 是一个运行在终端中的 LLM 驱动世界模拟器。用户扮演**导演部**——一个超越时空的上帝视角观察者与导演，操控世界事件、人物与局势，由 LLM 忠实地模拟世界对导演指令的响应。

## 我们的优势

### 纯终端 TUI，开箱即用

基于 [OpenTUI](https://github.com/anthropics/opentui) + SolidJS 构建的终端用户界面：

- 左右分栏布局：60% 聊天面板 + 40% 状态面板
- 支持鼠标选择、右键复制、Ctrl+C 复制选区
- 全屏 alternate-screen 模式，退出后终端干净如初
- 内置多行文本编辑器，告别单行输入的痛苦

### 导演部模式：不扮演角色，只操控世界

与 mangekyou-web 的玩家角色模式不同，conducting-department-cli 取消了 PlayerCHR 的概念：

- 用户是**导演部**，以上帝视角发出指令
- LLM 扮演所有角色、控制所有事件
- 适合大型持续世界的剧情推演、战争模拟、多线叙事

### 可叠加的 CHR 扩展系统

CHR 文件分为两类：`simulator`（世界本体）和 `addon`（扩展包），使用 TOML 编写。

- **Simulator CHR**：定义世界观、模拟器规则、状态栏格式、NPC 与场景数据库
- **Addon CHR**：扩展包，可叠加多个，用于追加魔法体系、势力、剧情补丁等

优势：

- **多 addon 同时加载**：可以把"魔法体系""势力补丁""新角色卡"拆成独立的 addon，按需组合
- **运行时启用/禁用**：addon 可在会话中动态开关，无需重启
- **非破坏性叠加**：addon 仅追加内容，不会污染主世界 CHR，便于分享与复用
- **社区友好**：每个 addon 是单一 TOML 文件，复制粘贴即可分发

示例文件：

- 空白模板：[simulators/example.simulator.chr.toml](simulators/example.simulator.chr.toml)、[simulators/example.addon.chr.toml](simulators/example.addon.chr.toml)
- 完整世界示例：
  * [simulators/harry-potter/](simulators/harry-potter/)
  * [simulators/type-moon/](simulators/type-moon/)

### 四层记忆结构

为了在有限上下文里塞下尽可能丰富的世界状态，记忆被拆分为四个层次：

| 层次 | 作用 | 更新方式 |
| --- | --- | --- |
| 消息内联（Inline） | 最近若干轮原始对话 | 自动滚动 |
| 状态栏（Status Bar） | 当前场景、角色状态、关键变量 | 每轮由小模型刷新 |
| 短期记忆（Precise） | 近期事件摘要 | 每轮自动生成 |
| 长期记忆（Coarse） | 跨章节的关键事实 | 由短期记忆进一步压缩沉淀 |

### 大小模型混合，省钱省时延

- 主聊天模型使用 Claude Opus 等强模型保证叙事质量
- 状态栏刷新、记忆压缩使用 Gemini Flash / Haiku / GPT-4o-mini 等小模型
- 三类模型的 URL、API Key、参数完全独立，可分别接入不同提供商

### Tool Call 交互

LLM 在生成过程中可以主动向导演部提问确认：

- **ask_question**：当 LLM 对指令有歧义时，弹出问答 UI 让用户确认
- **read / glob**：LLM 可以读取工作目录中的文件获取额外信息

### 会话持久化

- 退出时（Ctrl+D）自动保存会话到 JSON 文件
- 下次启动时通过 `--load` 恢复完整状态（消息历史、记忆、addon 配置）

## 技术栈

- **运行时**：[Bun](https://bun.sh)
- **UI 框架**：[OpenTUI](https://github.com/anthropics/opentui) + SolidJS
- **配置解析**：smol-toml
- **语言**：TypeScript

## 快速开始

### 安装依赖

```bash
bun install
```

### 配置

复制示例配置并填入你的 API 信息：

```bash
cp config.example.toml config.toml
```

编辑 `config.toml`：

```toml
[api]
url = "https://your-api-endpoint/v1/chat/completions"
key = "sk-your-api-key-here"

[chat]
model = "claude-opus-4-6"
temperature = 0.5

[statusBar]
model = "gemini-3-flash-preview"
temperature = 0.05

[memory]
model = "gemini-3-flash-preview"
temperature = 0.05

[pipeline]
outputBudget = 1512
inlineMessageLimit = 5
preciseMemoryLimit = 20
compressPerTime = 5
```

### 运行

```bash
# 指定世界模拟器启动
bun run index.tsx simulators/harry-potter/harry-potter.simulator.chr.toml

# 加载 addon 扩展包
bun run index.tsx simulators/harry-potter/harry-potter.simulator.chr.toml \
  -a simulators/harry-potter/magic.addon.chr.toml \
  -a simulators/harry-potter/spells.addon.chr.toml

# 从保存的会话恢复
bun run index.tsx --load session-2025-01-01T00-00-00-000Z.json

# 指定配置文件
bun run index.tsx -c my-config.toml simulators/harry-potter/harry-potter.simulator.chr.toml
```

### 操作

- **输入指令**：在聊天面板底部输入导演指令，回车发送
- **复制文本**：鼠标选择文本后右键自动复制，或 Ctrl+C 复制选区
- **退出**：Ctrl+D 退出并自动保存会话

## 项目结构

```
conducting-department-cli/
├── index.tsx                 # 入口：CLI 参数解析、配置加载、UI 渲染
├── config.toml               # 运行时配置（API、模型参数）
├── config.example.toml       # 配置模板
├── prompts/                  # XML 提示词模板
│   ├── simulator.xml         # 主模拟器系统提示词
│   ├── simulator-user*.xml   # 用户消息模板
│   ├── status-bar*.xml       # 状态栏更新提示词
│   └── memory*.xml           # 记忆压缩提示词
├── simulators/               # CHR 世界定义文件
│   ├── example.simulator.chr.toml
│   ├── example.addon.chr.toml
│   ├── harry-potter/         # 哈利波特世界
│   └── type-moon/            # 型月世界
└── src/
    ├── config.ts             # 配置解析与 CLI 参数处理
    ├── store.ts              # 全局状态管理
    ├── session.ts            # 会话序列化/反序列化
    ├── chat_message.ts       # 消息类型定义
    ├── llm/
    │   ├── client.ts         # LLM API 客户端（流式/非流式）
    │   ├── chr_file.ts       # CHR 文件类型定义
    │   ├── context.ts        # 请求构建（模拟器/状态栏/记忆）
    │   ├── pipeline.ts       # 核心发送流水线
    │   └── prompt_builder.ts # 提示词模板渲染
    └── ui/
        ├── App.tsx           # 主布局
        ├── ChatPanel.tsx     # 聊天面板
        ├── ChatBubble.tsx    # 消息气泡
        ├── StatusPanel.tsx   # 状态栏面板
        ├── EditOverlay.tsx   # 多行编辑器
        └── QuestionOverlay.tsx # LLM 提问弹窗
```

