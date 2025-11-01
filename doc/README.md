# task.json 格式说明

`task.json` 是 `cursor-tasks` 命令使用的任务配置文件。

## 文件结构

```json
{
  "prompts": [
    "提示词文件路径1",
    "提示词文件路径2"
  ],
  "tasks": [
    {
      "name": "任务名称",
      "description": "任务描述（可选）",
      "spec_file": "规格文件路径",
      "status": "pending"
    },
    {
      "name": "多文件任务",
      "description": "使用多个规格文件的任务",
      "spec_file": [
        "规格文件路径1",
        "规格文件路径2"
      ],
      "status": "pending"
    }
  ]
}
```

## 字段说明

### 顶级字段

- **`prompts`** (可选): 字符串数组，提示词文件路径列表。这些文件会在执行每个任务时作为系统提示词传递给 cursor-agent。
- **`tasks`** (必需): 任务对象数组，定义要执行的任务列表。

### 任务对象字段

- **`name`** (必需): 任务名称，必须唯一。用于标识任务，也用作报告文件名的一部分。
- **`description`** (可选): 任务描述，会在执行报告中显示。
- **`spec_file`** (必需): 规格文件路径，可以是：
  - 字符串：单个规格文件路径
  - 字符串数组：多个规格文件路径，这些文件会按顺序传递给 cursor-agent
- **`status`** (可选): 任务状态，可选值：
  - `pending`: 待执行（默认）
  - `done`: 已完成
  - `error`: 执行失败
- **`error_message`** (自动添加): 执行失败时的简短错误信息，由系统自动添加。
- **`report`** (自动添加): 执行报告文件路径，由系统自动添加。

## 状态流转

1. 初始状态：`status: "pending"`
2. 执行成功：`status: "done"`，并添加 `report` 字段
3. 执行失败：`status: "error"`，并添加 `error_message` 和 `report` 字段

## 示例

参考 `task.json.example` 文件查看完整示例。

## 注意事项

1. 所有文件路径都是相对于 `task.json` 文件所在目录的相对路径，或绝对路径。
2. 任务名称必须唯一，不能重复。
3. 规格文件 (`spec_file`) 必须存在，否则任务执行会失败。如果是数组，所有文件都必须存在。
4. 当 `spec_file` 是数组时，多个文件会按顺序传递给 cursor-agent，并且在语义判定时会合并所有文件的内容。
5. 提示词文件 (`prompts`) 如果不存在会被跳过，不会导致任务失败。
6. 使用 `cursor-tasks --reset` 可以将所有任务状态重置为 `pending`。

