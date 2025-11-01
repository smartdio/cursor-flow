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
```

或者本地开发时，从当前目录使用：

```bash
# 在 cursor-flow 目录下
npx . cursor-agent-task -h
npx . cursor-tasks --help
```

### 方式二：全局安装

```bash
npm install -g @n8flow/cursor-flow

# 然后可以直接使用命令
cursor-agent-task -h
cursor-tasks --help
```

### 方式三：本地安装到项目

```bash
npm install @n8flow/cursor-flow

# 在 package.json 的 scripts 中使用
# 或通过 npx 调用
npx cursor-agent-task -h
npx cursor-tasks --help
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
- `-p, --prompt` 普通提示词（与 -f 二选一）
- `-f, --file` 从文件读取提示词（可多次；与 -p 二选一；传 - 表示从 stdin 读取）
- `-m, --model` 指定 cursor-agent 模型名称（默认: auto）
- `-h, --help` 显示帮助

**示例：**
```bash
# 显示帮助信息
cursor-agent-task -h
cursor-agent-task --help

# 使用提示词文件
cursor-agent-task -f prompt.txt -f spec.md

# 使用直接提示词
cursor-agent-task -p "请帮我实现一个功能"

# 使用系统提示词和提示词文件
cursor-agent-task -s "你是一个专业的开发者" -f task.md
```

### cursor-tasks

任务流程控制和编排工具。

**用法：**
```bash
cursor-tasks [选项]
```

**选项：**
- `-t, --task-file <path>` 任务文件路径（默认: doc/task.json）
- `-m, --model <model>` 模型名称（默认: composer-1）
- `--retry <num>` 重试次数（默认: 3）
- `--timeout <minutes>` 超时时间（分钟，默认: 30）
- `--reset` 重置所有任务状态为 pending
- `-h, --help` 显示帮助信息

**示例：**
```bash
# 显示帮助信息
cursor-tasks -h
cursor-tasks --help

# 执行任务（使用缩写参数）
cursor-tasks -t doc/task.json -m composer-1

# 执行任务（使用完整参数）
cursor-tasks --task-file doc/task.json --model composer-1

# 重置任务状态
cursor-tasks -t doc/task.json --reset
cursor-tasks --task-file doc/task.json --reset
```

## 开发

### 本地链接（用于开发测试）

```bash
cd cursor-flow
npm link

# 现在可以在任何地方使用命令
cursor-agent-task -h
cursor-tasks --help
```

### 卸载本地链接

```bash
npm unlink -g @n8flow/cursor-flow
```

## task.json 配置文件

`cursor-tasks` 命令使用 `task.json` 文件来定义要执行的任务列表。示例文件位于 `doc/task.json.example`。

详细的格式说明请参考 [doc/README.md](doc/README.md)。

## 注意事项

- 确保已安装 `cursor-agent` 命令并在 PATH 中
- `cursor-tasks` 依赖于 `cursor-agent-task`，两个脚本需要在同一目录中
- 通过 npx 使用时，文件会被临时提取，但两个脚本的相互引用仍然可以正常工作
- 任务配置文件 `task.json` 必须包含 `tasks` 数组，每个任务必须包含 `name` 和 `spec_file` 字段

