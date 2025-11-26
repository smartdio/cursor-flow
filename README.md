# Cursor Flow

Cursor Agent 任务执行和流程控制工具集。

## 安装

### 方式一：通过 npx 直接使用（推荐）

如果包已发布到 npm，可以直接使用：

```bash
# 使用 cursor-agent-task 命令
npx @n8flow/cursor-flow cursor-agent-task -h

# 使用 cursor-tasks 命令
npx @n8flow/cursor-flow cursor-tasks --help

# 使用 call-llm 命令
npx @n8flow/cursor-flow call-llm --help
```

或者本地开发时，从当前目录使用：

```bash
# 在 cursor-flow 目录下
npx . cursor-agent-task -h
npx . cursor-tasks --help
npx . call-llm --help
```

### 方式二：全局安装

```bash
npm install -g @n8flow/cursor-flow

# 然后可以直接使用命令
cursor-agent-task -h
cursor-tasks --help
call-llm --help
```

### 方式三：本地安装到项目

```bash
npm install @n8flow/cursor-flow

# 在 package.json 的 scripts 中使用
# 或通过 npx 调用
npx cursor-agent-task -h
npx cursor-tasks --help
npx call-llm --help
```

## 命令说明

### cursor-agent-task

调用 cursor-agent 执行任务的包装脚本。

**用法：**
```bash
cursor-agent-task [-s "系统提示词"] [-p "提示词" | -f 提示词文件(可多次)] [-- 其他参数]
```

**参数：**
- `-s, --system` 系统提示词（可选）
- `-p, --prompt` 普通提示词（可选，可与 -f 同时使用）
- `-f, --file` 从文件读取提示词（可多次；可与 -p 同时使用；传 - 表示从 stdin 读取）
- `-m, --model` 指定 cursor-agent 模型名称（默认: auto）
- `--judge-model <model>` 语义判定模型（必需，用于判断任务是否完成）
- `--retry <num>` 最大重试次数（默认: 3）
- `--timeout <minutes>` 每次执行的超时时间，分钟（默认: 60）
- `-h, --help` 显示帮助

**示例：**
```bash
# 显示帮助信息
cursor-agent-task -h
cursor-agent-task --help

# 使用提示词文件
cursor-agent-task -f .flow/prompts/system-prompt.md -f .flow/spec/task.md --judge-model gpt-4

# 使用直接提示词
cursor-agent-task -p "请帮我实现一个功能" --judge-model gpt-4

# 使用系统提示词和规格文件
cursor-agent-task -s "你是一个专业的开发者" -f .flow/spec/task.md --judge-model gpt-4
```

### cursor-tasks

任务流程控制和编排工具。

**用法：**
```bash
cursor-tasks [选项]
```

**选项：**
- `-t, --task-file <path>` 任务文件路径（默认: .flow/task.json）
- `-m, --model <model>` 模型名称（默认: composer-1）
- `--judge-model <model>` 语义判定模型（必需，或设置 CURSOR_TASKS_JUDGE_MODEL 环境变量）
- `--retry <num>` 重试次数（默认: 3）
- `--timeout <minutes>` 超时时间（分钟，默认: 30）
- `--reset` 重置所有任务状态为 pending
- `-h, --help` 显示帮助信息

**环境变量：**
- `CURSOR_TASKS_JUDGE_MODEL` 语义判定模型（如果未通过 --judge-model 提供）

**环境变量文件：**
- 如果当前执行目录下存在 `.flow/.env` 文件，程序会自动加载其中的环境变量
- `.flow/.env` 文件格式：`KEY=value`，支持注释（以 `#` 开头）和空行
- 已存在的环境变量不会被 `.flow/.env` 文件覆盖（优先使用系统环境变量）
- 运行 `cursor-tasks init` 会创建 `.flow/.env.example` 文件作为配置示例

**示例：**
```bash
# 显示帮助信息
cursor-tasks -h
cursor-tasks --help

# 执行任务（指定判定模型）
cursor-tasks -t .flow/task.json -m composer-1 --judge-model gpt-4

# 使用环境变量指定判定模型
export CURSOR_TASKS_JUDGE_MODEL=gpt-4
cursor-tasks -t .flow/task.json -m composer-1

# 使用 .cursor.env 文件（推荐）
# 在当前目录创建 .cursor.env 文件，内容：
# CURSOR_TASKS_JUDGE_MODEL=gpt-4
# OPENAI_API_KEY=sk-xxx
cursor-tasks -t .flow/task.json -m composer-1

# 重置任务状态
cursor-tasks -t .flow/task.json --reset
cursor-tasks --task-file .flow/task.json --reset
```

**说明：**
- `cursor-tasks` 使用 `call-llm` 进行语义判定，判断任务是否完成
- 首次执行使用 `cursor-agent-task`，后续继续执行使用 `cursor-agent resume` 命令
- 语义判定结果有三种状态：
  - `done`: 任务已完成，继续下一个任务
  - `resume`: 需要继续执行，回复"请继续"
  - `auto`: 包含建议，回复"按你的建议执行"

### call-llm

调用兼容 OpenAI API 的 LLM 模型工具。

**用法：**
```bash
call-llm [选项]
```

**选项：**
- `-p, --prompt <text>` 系统提示词（可选）
- `-c, --content <text>` 用户内容（必需）
- `-f, --format <json|text>` 返回格式（默认: text）
  - `json`: 提取并格式化 `message.content` 中的 JSON 内容（支持 markdown 代码块格式）
  - `text`: 直接输出 `message.content` 的原始文本
- `-m, --model <model>` 模型名称（必需）
- `-k, --api-key <key>` API Key（或使用环境变量 OPENAI_API_KEY）
- `-b, --baseurl <url>` API 基础 URL（或使用环境变量 OPENAI_API_BASE，默认: https://api.openai.com/v1）
- `-h, --help` 显示帮助信息

**环境变量：**
- `OPENAI_API_KEY` API Key（如果未通过 --api-key 提供）
- `OPENAI_API_BASE` API 基础 URL（如果未通过 --baseurl 提供）

**示例：**
```bash
# 显示帮助信息
call-llm --help
call-llm -h

# 基本调用（使用短选项）
call-llm -m gpt-4 -c "请解释什么是 RESTful API"

# 基本调用（使用完整选项）
call-llm --model gpt-4 --content "请解释什么是 RESTful API"

# 使用系统提示词
call-llm -m gpt-4 -p "你是一个专业的代码审查助手" -c "请审查这段代码"
call-llm --model gpt-4 --prompt "你是一个专业的代码审查助手" --content "请审查这段代码"

# 返回 JSON 格式
call-llm -m gpt-3.5-turbo -c "什么是 AI" -f json
call-llm --model gpt-3.5-turbo --content "什么是 AI" --format json

# 使用自定义 API 端点
call-llm -b http://localhost:8080/v1 -k sk-xxx -m local-model -c "Hello"
call-llm --baseurl http://localhost:8080/v1 --api-key sk-xxx --model local-model --content "Hello"

# 使用环境变量
export OPENAI_API_KEY="sk-xxx"
call-llm -m gpt-4 -c "Hello"
call-llm --model gpt-4 --content "Hello"
```

## 开发

### 本地链接（用于开发测试）

```bash
cd cursor-flow
npm link

# 现在可以在任何地方使用命令
cursor-agent-task -h
cursor-tasks --help
call-llm --help
```

### 卸载本地链接

```bash
npm unlink -g @n8flow/cursor-flow
```

## task.json 配置文件

`cursor-tasks` 命令使用 `task.json` 文件来定义要执行的任务列表。示例文件位于 `.flow/task.json.example`。

详细的格式说明请参考 [.flow/README.md](.flow/README.md)。

### task.json 格式要求

**重要更新**：为了支持 TaskEcho 集成，`task.json` 中的每个任务对象**必须**包含 `id` 字段：

```json
{
  "prompts": [".flow/skills/global.md"],
  "tasks": [
    {
      "id": "1",  // 必填：任务ID（在队列内唯一）
      "name": "任务名称",
      "prompt": "任务提示文本",
      "status": "pending"
    }
  ]
}
```

- `id` 字段是**必填的**，必须从 task.json 文件中读取
- `id` 必须在队列内唯一，不能重复
- `id` 格式要求：字符串，长度 1-255 字符，不能为空字符串
- 如果任务缺少 `id` 字段，验证时会抛出错误，任务执行会被中断

## TaskEcho 集成

`cursor-tasks` 支持与 TaskEcho 服务集成，可以将任务队列、执行消息、状态更新和日志推送到 TaskEcho 服务器。

### 配置 TaskEcho

在 `.flow/.env` 文件中配置以下环境变量：

```bash
# TaskEcho 服务配置（可选）
TASKECHO_API_URL=http://localhost:3000        # TaskEcho API 服务地址
TASKECHO_API_KEY=sk-xxxxxxxxxxxxxxxx          # TaskEcho API Key
TASKECHO_ENABLED=true                         # 是否启用 TaskEcho 集成（true/false）
```

**参数说明：**

| 参数名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `TASKECHO_API_URL` | 否 | `http://localhost:3000` | TaskEcho 服务的 API 地址 |
| `TASKECHO_API_KEY` | 是（启用时） | 空字符串 | TaskEcho 服务的 API Key，用于认证 |
| `TASKECHO_ENABLED` | 否 | `false` | 是否启用 TaskEcho 集成，设置为 `true` 时才会推送数据 |

**注意事项：**
- 如果不启用 TaskEcho，可以不配置这些参数，或设置 `TASKECHO_ENABLED=false`
- 启用时，`TASKECHO_API_KEY` 必须配置，否则不会推送数据
- 运行 `cursor-tasks init` 会创建 `.flow/.env.example` 文件，包含这些配置的示例

### TaskEcho 功能

启用 TaskEcho 后，`cursor-tasks` 会自动执行以下操作：

1. **队列推送**：在开始执行任务列表时，推送项目信息和整个任务队列到服务器
2. **用户消息推送**：任务开始执行时，推送用户消息（任务的 prompt）
3. **AI 回复推送**：cursor-agent-task 执行完成后，推送 AI 回复消息
4. **状态更新推送**：任务状态变化时，推送状态更新消息
5. **日志推送**：在关键日志点（任务开始、完成、失败）推送日志信息
6. **重置操作推送**：执行 `reset` 或 `reset-error` 指令时，推送更新后的队列状态

**项目 UUID 管理：**
- 首次推送时会自动生成项目 UUID，并保存到 `.flow/.taskecho_project_id` 文件
- 后续推送会复用相同的 UUID，确保项目标识的一致性
- 该文件已添加到 `.gitignore`，不会提交到版本控制

详细的集成方案请参考 [.flow/spec/taskecho-integration.md](.flow/spec/taskecho-integration.md)。

## 注意事项

- 确保已安装 `cursor-agent` 命令并在 PATH 中
- `cursor-tasks` 依赖于 `cursor-agent-task` 和 `call-llm`，这些脚本需要在同一目录中
- 通过 npx 使用时，文件会被临时提取，但脚本之间的相互引用仍然可以正常工作
- 任务配置文件 `task.json` 必须包含 `tasks` 数组，每个任务必须包含 `name`、`id` 字段，以及 `prompt` 或 `spec_file` 字段之一
- 执行任务时必须指定 `--judge-model` 参数或设置 `CURSOR_TASKS_JUDGE_MODEL` 环境变量
- `cursor-tasks` 会使用 `call-llm` 进行语义判定，需要确保已配置 `OPENAI_API_KEY` 或通过 `--api-key` 提供
- 支持 `.flow/.env` 文件自动加载环境变量，文件应放在 `.flow` 目录下，格式为 `KEY=value`（每行一个）
- `.flow/.env` 文件中的环境变量不会覆盖已存在的系统环境变量（优先使用系统环境变量）

