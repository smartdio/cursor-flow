# 客户端实现指引

## 1. 概述

本文档说明如何实现 TaskEcho 系统的客户端，用于将本地任务数据推送到 TaskEcho 服务器。

### 1.1 核心概念

- **项目（Project）**：对应一个代码仓库或工作目录
- **任务队列（Queue）**：对应一个任务文件（如 `task.json`），一个文件就是一个队列
- **任务（Task）**：队列中的单个任务项

### 1.2 数据流程

```
客户端本地 .flow 目录
  ↓
读取任务文件（如 task.json）
  ↓
构造项目信息和队列信息
  ↓
调用 POST /api/v1/submit 接口
  ↓
TaskEcho 服务器创建/更新项目和队列
```

---

## 2. 目录结构规范

### 2.1 任务文件位置

客户端应在项目根目录下的 `.flow` 目录中存储任务文件：

```
项目根目录/
  ├── .flow/
  │   ├── task.json          # 默认任务队列
  │   ├── task-dev.json      # 开发环境任务队列
  │   └── task-prod.json     # 生产环境任务队列
  └── ...
```

### 2.2 任务文件命名规则

- 文件名格式：`task[-<用途>].json`
- 示例：
  - `task.json` → 队列ID: `task`
  - `task-dev.json` → 队列ID: `task-dev`
  - `task-prod.json` → 队列ID: `task-prod`

### 2.3 任务文件格式

任务文件为 JSON 格式，包含以下字段：

```json
{
  "prompts": [
    ".flow/skills/spcewriter.md"
  ],
  "tasks": [
    {
      "id": "1",
      "name": "任务名称",
      "prompt": "任务提示文本",
      "spec_file": [".flow/skills/spcewriter.md"],
      "status": "pending",
      "report": ".flow/tasks/report/xxx.md"
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompts` | array[string] | 否 | 提示文件路径数组，会作为 `meta.prompts` 传递 |
| `tasks` | array[object] | 是 | 任务数组，至少包含一个任务 |

**任务对象字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 任务ID（在队列内唯一） |
| `name` | string | 是 | 任务名称 |
| `prompt` | string | 是 | 任务提示文本 |
| `spec_file` | array[string] | 否 | 规范文件路径数组 |
| `status` | string | 是 | 任务状态：`pending`、`done`、`error` |
| `report` | string | 否 | 报告文件路径 |
| `messages` | array[object] | 否 | 对话消息数组（导入时通常为空） |
| `logs` | array[object] | 否 | 执行日志数组（导入时通常为空） |

---

## 3. 项目信息生成规则

### 3.1 项目名称（project_name）

**规则**：使用客户端命令执行时所在目录的名称。

**示例**：
- 目录：`/Users/smart/Documents/workspace/ai/TaskEcho`
- 项目名称：`TaskEcho`

**实现方式**：
```bash
# Bash
PROJECT_NAME=$(basename "$(pwd)")

# Python
import os
project_name = os.path.basename(os.getcwd())

# Node.js
const path = require('path');
const project_name = path.basename(process.cwd());
```

### 3.2 项目ID（project_id）

**规则**：客户端自己生成一个 UUID（通用唯一标识符），用于唯一标识项目。

**格式**：标准 UUID 格式（如 `550e8400-e29b-41d4-a716-446655440000`）

**要求**：
- 必须使用标准 UUID v4 格式
- 每个项目应该有唯一的 UUID
- UUID 应该在客户端首次推送时生成，并持久化保存（如保存在配置文件中）
- 同一项目的后续推送应使用相同的 UUID

**实现方式**：

```bash
# Bash
# 生成 UUID（需要 uuidgen 命令，macOS/Linux 通常自带）
PROJECT_ID=$(uuidgen)

# 或者使用 Python 生成
PROJECT_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
```

```python
# Python
import uuid

# 生成 UUID
project_id = str(uuid.uuid4())

# 可选：持久化保存到配置文件
import json
import os

config_file = '.taskecho_project_id'
if os.path.exists(config_file):
    # 如果配置文件存在，读取已保存的 UUID
    with open(config_file, 'r') as f:
        config = json.load(f)
        project_id = config.get('project_id')
        if not project_id:
            project_id = str(uuid.uuid4())
            config['project_id'] = project_id
            with open(config_file, 'w') as f:
                json.dump(config, f)
else:
    # 首次运行，生成新的 UUID 并保存
    project_id = str(uuid.uuid4())
    with open(config_file, 'w') as f:
        json.dump({'project_id': project_id}, f)
```

```javascript
// Node.js
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const configFile = '.taskecho_project_id';
let project_id;

if (fs.existsSync(configFile)) {
    // 如果配置文件存在，读取已保存的 UUID
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    project_id = config.project_id || randomUUID();
    if (!config.project_id) {
        config.project_id = project_id;
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    }
} else {
    // 首次运行，生成新的 UUID 并保存
    project_id = randomUUID();
    fs.writeFileSync(configFile, JSON.stringify({ project_id }, null, 2));
}
```

### 3.3 客户端信息（clientInfo）

**规则**：保存项目的客户端主机名称、主机用户和客户端项目的路径信息。

**格式**：JSON 对象，包含以下字段：
- `username`：客户端用户名
- `hostname`：客户端主机名
- `project_path`：项目完整路径（建议使用 `~` 缩写形式）

**重要说明**：
- API 请求体和响应中使用 `clientInfo`（驼峰命名）
- 数据库模型中也使用 `clientInfo`（驼峰命名）
- 脚本内部变量可以使用下划线命名（如 Bash 的 `CLIENT_INFO`），但在构造 JSON 请求体时，字段名必须使用 `clientInfo`

**示例**：
```json
{
  "username": "smart",
  "hostname": "macmini",
  "project_path": "~/Documents/workspace/ai/TaskEcho"
}
```

**实现方式**：

```bash
# Bash
# 注意：CLIENT_INFO 是 Bash 变量名（使用下划线），但在 JSON 请求体中字段名为 clientInfo（驼峰）
USERNAME=$(whoami)
HOSTNAME=$(hostname)
PROJECT_PATH=$(pwd | sed "s|^$HOME|~|")

CLIENT_INFO=$(jq -n \
    --arg username "$USERNAME" \
    --arg hostname "$HOSTNAME" \
    --arg project_path "$PROJECT_PATH" \
    '{
        username: $username,
        hostname: $hostname,
        project_path: $project_path
    }')

# 在构造请求体时，使用 clientInfo 作为 JSON 字段名
# 例如：clientInfo: $CLIENT_INFO
```

```python
# Python
import os
import getpass
import socket
import json

username = getpass.getuser()
hostname = socket.gethostname()
project_path = os.getcwd()

# 将绝对路径转换为 ~ 缩写
home = os.path.expanduser('~')
if project_path.startswith(home):
    project_path = project_path.replace(home, '~', 1)

clientInfo = {
    "username": username,
    "hostname": hostname,
    "project_path": project_path
}
```

```javascript
// Node.js
const os = require('os');
const path = require('path');

const username = os.userInfo().username;
const hostname = os.hostname();
let project_path = process.cwd();

// 将绝对路径转换为 ~ 缩写
const home = os.homedir();
if (project_path.startsWith(home)) {
    project_path = project_path.replace(home, '~');
}

const clientInfo = {
    username: username,
    hostname: hostname,
    project_path: project_path
};
```

---

## 4. 队列信息生成规则

### 4.1 队列ID（queue_id）

**规则**：从任务文件名提取，去除 `.json` 后缀。

**示例**：
- `task.json` → 队列ID: `task`
- `task-dev.json` → 队列ID: `task-dev`
- `task-prod.json` → 队列ID: `task-prod`

**实现方式**：

```bash
# Bash
QUEUE_FILE="task.json"
QUEUE_ID=$(basename "$QUEUE_FILE" .json)

# 或者从完整路径提取
QUEUE_FILE=".flow/task-dev.json"
QUEUE_ID=$(basename "$QUEUE_FILE" .json)
```

```python
# Python
import os

queue_file = "task.json"
queue_id = os.path.splitext(os.path.basename(queue_file))[0]
```

```javascript
// Node.js
const path = require('path');

const queue_file = "task.json";
const queue_id = path.basename(queue_file, '.json');
```

### 4.2 队列名称（queue_name）

**规则**：可以使用队列ID作为队列名称，或者根据环境自定义。

**示例**：
- 队列ID: `task` → 队列名称: `任务队列`
- 队列ID: `task-dev` → 队列名称: `开发环境任务队列`
- 队列ID: `task-prod` → 队列名称: `生产环境任务队列`

**实现方式**：

```bash
# Bash
case "$QUEUE_ID" in
  "task")
    QUEUE_NAME="任务队列"
    ;;
  "task-dev")
    QUEUE_NAME="开发环境任务队列"
    ;;
  "task-prod")
    QUEUE_NAME="生产环境任务队列"
    ;;
  *)
    QUEUE_NAME="$QUEUE_ID"
    ;;
esac
```

---

## 5. API 调用规范

### 5.1 提交任务接口

#### 5.1.1 接口信息

- **接口路径**：`POST /api/v1/submit`
- **Content-Type**：`application/json`
- **认证方式**：API Key（请求头：`X-API-Key`）

#### 5.1.2 请求头

```
Content-Type: application/json
X-API-Key: <your_api_key>
```

#### 5.1.3 请求体结构

```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_name": "TaskEcho",
  "clientInfo": {
    "username": "smart",
    "hostname": "macmini",
    "project_path": "~/Documents/workspace/ai/TaskEcho"
  },
  "queue_id": "task",
  "queue_name": "任务队列",
  "meta": {
    "prompts": [".flow/skills/spcewriter.md"]
  },
  "tasks": [
    {
      "id": "1",
      "name": "任务名称",
      "prompt": "任务提示文本",
      "spec_file": [".flow/skills/spcewriter.md"],
      "status": "pending",
      "report": null,
      "messages": [],
      "logs": []
    }
  ]
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_id` | string | 是 | 项目UUID（客户端生成的唯一标识符） |
| `project_name` | string | 是 | 项目显示名称 |
| `clientInfo` | object | 否 | 客户端信息（主机名、用户名、路径） |
| `clientInfo.username` | string | 否 | 客户端用户名 |
| `clientInfo.hostname` | string | 否 | 客户端主机名 |
| `clientInfo.project_path` | string | 否 | 项目完整路径（建议使用 `~` 缩写） |
| `queue_id` | string | 是 | 任务队列ID |
| `queue_name` | string | 是 | 任务队列显示名称 |
| `meta` | object | 否 | 元数据信息（如 prompts） |
| `tasks` | array | 是 | 任务数组 |

#### 5.1.4 响应格式

**成功响应（200）**：
```json
{
  "success": true,
  "data": {
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "queue_id": "task",
    "tasks_count": 1,
    "created_tasks": 1,
    "updated_tasks": 0
  },
  "message": "提交成功",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**错误响应（400/401/500）**：
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {}
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### 5.2 追加对话消息接口

追加对话消息接口用于在任务创建后，向指定任务追加对话消息（用户消息或 AI 回复）。

#### 5.2.1 接口信息

- **接口路径**：`POST /api/v1/tasks/:projectId/:queueId/:taskId/message`
- **Content-Type**：`application/json`
- **认证方式**：API Key（请求头：`X-API-Key`）
- **幂等性**：非幂等（每次调用都会追加新消息）

#### 5.2.2 路径参数

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `projectId` | string | 是 | 项目外部唯一标识（1-255字符） | `"550e8400-e29b-41d4-a716-446655440000"` |
| `queueId` | string | 是 | 任务队列外部唯一标识（在项目内唯一，1-255字符） | `"task"` |
| `taskId` | string | 是 | 任务外部唯一标识（在队列内唯一，1-255字符） | `"1"` |

#### 5.2.3 请求头

```
Content-Type: application/json
X-API-Key: <your_api_key>
```

#### 5.2.4 请求体结构

```json
{
  "role": "user",
  "content": "请帮我实现登录功能"
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| `role` | string | 是 | 消息角色，必须是 `user` 或 `assistant`（不区分大小写） | `"user"` |
| `content` | string | 是 | 消息内容，支持 Markdown 格式，长度 1-100000 字符 | `"请帮我实现登录功能"` |

#### 5.2.5 响应格式

**成功响应（200）**：
```json
{
  "success": true,
  "data": {
    "message_id": 0,
    "role": "USER",
    "content": "请帮我实现登录功能",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "message": "消息追加成功",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**响应字段说明**：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `data.message_id` | number | 消息在任务中的索引位置（从0开始） |
| `data.role` | string | 消息角色（USER/ASSISTANT，大写） |
| `data.content` | string | 消息内容 |
| `data.created_at` | string | 消息创建时间（ISO 8601 格式） |

**错误响应（401 - API Key 无效）**：
```json
{
  "success": false,
  "error": {
    "code": "INVALID_API_KEY",
    "message": "API Key 无效或缺失",
    "details": {}
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**错误响应（404 - 任务不存在）**：
```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "任务不存在",
    "details": {
      "project_id": "550e8400-e29b-41d4-a716-446655440000",
      "queue_id": "task",
      "task_id": "1"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**错误响应（400 - 参数验证失败）**：
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数验证失败",
    "details": {
      "field": "role",
      "reason": "role 必须是 user 或 assistant"
    }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### 5.2.6 使用场景

追加对话消息接口适用于以下场景：

1. **任务执行过程中的对话**：外部系统在执行任务时，需要记录用户与 AI 的对话内容
2. **实时对话更新**：支持多轮对话，可以连续追加多条消息
3. **任务状态同步**：在任务执行过程中，通过追加消息来记录任务进展

**使用示例**：

```bash
# 追加用户消息
curl -X POST "http://localhost:3000/api/v1/tasks/project_001/task/task_001/message" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-xxxxxxxxxxxxxxxx" \
  -d '{
    "role": "user",
    "content": "请帮我实现登录功能"
  }'

# 追加 AI 回复
curl -X POST "http://localhost:3000/api/v1/tasks/project_001/task/task_001/message" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk-xxxxxxxxxxxxxxxx" \
  -d '{
    "role": "assistant",
    "content": "好的，我来帮你实现登录功能..."
  }'

# 查询任务详情，验证消息是否正确保存（需要认证）
curl -X GET "http://localhost:3000/api/v1/projects/project_001/queues/task/tasks/task_001" \
  -H "X-API-Key: sk-xxxxxxxxxxxxxxxx"
```

**注意事项**：
- 追加消息后，消息会立即保存到数据库
- 可以通过查询任务详情API验证消息是否正确保存
- 查询任务详情API需要 API Key 认证（与追加消息API相同）
- 如果任务不存在，追加消息API会返回 404 错误
- 消息按时间顺序追加，查询时会按 `created_at` 正序返回

---

## 6. 实现示例

### 6.1 Bash 脚本示例

```bash
#!/bin/bash

# 配置
API_BASE_URL="http://localhost:3000"
API_KEY="sk-xxxxxxxxxxxxxxxx"
FLOW_DIR=".flow"

# 获取项目信息
PROJECT_NAME=$(basename "$(pwd)")
USERNAME=$(whoami)
HOSTNAME=$(hostname)
PROJECT_PATH=$(pwd | sed "s|^$HOME|~|")

# 生成或读取项目UUID
PROJECT_ID_FILE=".taskecho_project_id"
if [ -f "$PROJECT_ID_FILE" ]; then
    PROJECT_ID=$(jq -r '.project_id' "$PROJECT_ID_FILE" 2>/dev/null || echo "")
fi
if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(uuidgen)
    echo "{\"project_id\": \"$PROJECT_ID\"}" > "$PROJECT_ID_FILE"
fi

# 处理 .flow 目录下的所有任务文件
for QUEUE_FILE in "$FLOW_DIR"/task*.json; do
    if [ ! -f "$QUEUE_FILE" ]; then
        continue
    fi
    
    # 提取队列ID和名称
    QUEUE_ID=$(basename "$QUEUE_FILE" .json)
    QUEUE_NAME="任务队列 ($QUEUE_ID)"
    
    # 读取任务文件
    TASK_DATA=$(cat "$QUEUE_FILE")
    
    # 提取 prompts（如果存在）
    PROMPTS=$(echo "$TASK_DATA" | jq -r '.prompts // []')
    
    # 提取 tasks
    TASKS=$(echo "$TASK_DATA" | jq -r '.tasks // []')
    
    # 构造客户端信息
    CLIENT_INFO=$(jq -n \
        --arg username "$USERNAME" \
        --arg hostname "$HOSTNAME" \
        --arg project_path "$PROJECT_PATH" \
        '{
            username: $username,
            hostname: $hostname,
            project_path: $project_path
        }')
    
    # 构造请求体
    REQUEST_BODY=$(jq -n \
        --arg project_id "$PROJECT_ID" \
        --arg project_name "$PROJECT_NAME" \
        --argjson clientInfo "$CLIENT_INFO" \
        --arg queue_id "$QUEUE_ID" \
        --arg queue_name "$QUEUE_NAME" \
        --argjson prompts "$PROMPTS" \
        --argjson tasks "$TASKS" \
        '{
            project_id: $project_id,
            project_name: $project_name,
            clientInfo: $clientInfo,
            queue_id: $queue_id,
            queue_name: $queue_name,
            meta: { prompts: $prompts },
            tasks: $tasks
        }')
    
    # 发送请求
    echo "推送队列: $QUEUE_ID"
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$REQUEST_BODY" \
        "$API_BASE_URL/api/v1/submit")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo "✓ 成功推送队列: $QUEUE_ID"
        echo "$BODY" | jq -r '.message'
    else
        echo "✗ 推送失败: $QUEUE_ID"
        echo "$BODY" | jq -r '.error.message'
        exit 1
    fi
done

echo "所有队列推送完成"
```

### 6.2 Python 示例

```python
#!/usr/bin/env python3
import os
import json
import uuid
import getpass
import socket
import requests
from pathlib import Path

# 配置
API_BASE_URL = "http://localhost:3000"
API_KEY = "sk-xxxxxxxxxxxxxxxx"
FLOW_DIR = ".flow"
PROJECT_ID_FILE = ".taskecho_project_id"

def get_project_info():
    """获取项目信息"""
    # 生成或读取项目UUID
    if os.path.exists(PROJECT_ID_FILE):
        with open(PROJECT_ID_FILE, 'r') as f:
            config = json.load(f)
            project_id = config.get('project_id')
            if not project_id:
                project_id = str(uuid.uuid4())
                config['project_id'] = project_id
                with open(PROJECT_ID_FILE, 'w') as f:
                    json.dump(config, f)
    else:
        project_id = str(uuid.uuid4())
        with open(PROJECT_ID_FILE, 'w') as f:
            json.dump({'project_id': project_id}, f)
    
    # 获取客户端信息
    username = getpass.getuser()
    hostname = socket.gethostname()
    project_path = os.getcwd()
    
    # 将绝对路径转换为 ~ 缩写
    home = os.path.expanduser('~')
    if project_path.startswith(home):
        project_path = project_path.replace(home, '~', 1)
    
    clientInfo = {
        "username": username,
        "hostname": hostname,
        "project_path": project_path
    }
    
    project_name = os.path.basename(os.getcwd())
    
    return project_id, project_name, clientInfo

def get_queue_info(queue_file):
    """从文件名提取队列信息"""
    queue_id = Path(queue_file).stem
    queue_name = f"任务队列 ({queue_id})"
    return queue_id, queue_name

def load_task_file(queue_file):
    """加载任务文件"""
    with open(queue_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('prompts', []), data.get('tasks', [])

def submit_queue(project_id, project_name, clientInfo, queue_id, queue_name, prompts, tasks):
    """提交队列到服务器"""
    url = f"{API_BASE_URL}/api/v1/submit"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
    }
    payload = {
        "project_id": project_id,
        "project_name": project_name,
        "clientInfo": clientInfo,
        "queue_id": queue_id,
        "queue_name": queue_name,
        "meta": {
            "prompts": prompts
        },
        "tasks": tasks
    }
    
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()

def main():
    project_id, project_name, clientInfo = get_project_info()
    flow_path = Path(FLOW_DIR)
    
    if not flow_path.exists():
        print(f"错误: {FLOW_DIR} 目录不存在")
        return
    
    # 处理所有任务文件
    for queue_file in flow_path.glob("task*.json"):
        queue_id, queue_name = get_queue_info(queue_file)
        prompts, tasks = load_task_file(queue_file)
        
        if not tasks:
            print(f"跳过空队列: {queue_id}")
            continue
        
        try:
            print(f"推送队列: {queue_id}")
            result = submit_queue(
                project_id, project_name, clientInfo,
                queue_id, queue_name,
                prompts, tasks
            )
            print(f"✓ 成功推送队列: {queue_id}")
            print(f"  消息: {result['message']}")
            print(f"  任务数: {result['data']['tasks_count']}")
        except requests.exceptions.RequestException as e:
            print(f"✗ 推送失败: {queue_id}")
            print(f"  错误: {e}")
            if hasattr(e.response, 'json'):
                error = e.response.json()
                print(f"  详情: {error.get('error', {}).get('message', '')}")
            return
    
    print("所有队列推送完成")

if __name__ == "__main__":
    main()
```

### 6.3 Node.js 示例

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const https = require('https');
const http = require('http');

// 配置
const API_BASE_URL = 'http://localhost:3000';
const API_KEY = 'sk-xxxxxxxxxxxxxxxx';
const FLOW_DIR = '.flow';
const PROJECT_ID_FILE = '.taskecho_project_id';

function getProjectInfo() {
    // 生成或读取项目UUID
    let projectId;
    if (fs.existsSync(PROJECT_ID_FILE)) {
        const config = JSON.parse(fs.readFileSync(PROJECT_ID_FILE, 'utf-8'));
        projectId = config.project_id || randomUUID();
        if (!config.project_id) {
            config.project_id = projectId;
            fs.writeFileSync(PROJECT_ID_FILE, JSON.stringify(config, null, 2));
        }
    } else {
        projectId = randomUUID();
        fs.writeFileSync(PROJECT_ID_FILE, JSON.stringify({ project_id: projectId }, null, 2));
    }
    
    // 获取客户端信息
    const username = os.userInfo().username;
    const hostname = os.hostname();
    let projectPath = process.cwd();
    
    // 将绝对路径转换为 ~ 缩写
    const home = os.homedir();
    if (projectPath.startsWith(home)) {
        projectPath = projectPath.replace(home, '~');
    }
    
    const clientInfo = {
        username: username,
        hostname: hostname,
        project_path: projectPath
    };
    
    const projectName = path.basename(process.cwd());
    
    return { projectId, projectName, clientInfo };
}

function getQueueInfo(queueFile) {
    const queueId = path.basename(queueFile, '.json');
    const queueName = `任务队列 (${queueId})`;
    return { queueId, queueName };
}

function loadTaskFile(queueFile) {
    const content = fs.readFileSync(queueFile, 'utf-8');
    const data = JSON.parse(content);
    return {
        prompts: data.prompts || [],
        tasks: data.tasks || []
    };
}

function submitQueue(projectId, projectName, clientInfo, queueId, queueName, prompts, tasks) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${API_BASE_URL}/api/v1/submit`);
        const payload = JSON.stringify({
            project_id: projectId,
            project_name: projectName,
            clientInfo: clientInfo,
            queue_id: queueId,
            queue_name: queueName,
            meta: { prompts },
            tasks
        });
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode === 200) {
                        resolve(result);
                    } else {
                        reject(new Error(result.error?.message || '请求失败'));
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败: ${e.message}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function main() {
    const { projectId, projectName, clientInfo } = getProjectInfo();
    const flowPath = path.join(process.cwd(), FLOW_DIR);
    
    if (!fs.existsSync(flowPath)) {
        console.error(`错误: ${FLOW_DIR} 目录不存在`);
        process.exit(1);
    }
    
    // 读取所有任务文件
    const files = fs.readdirSync(flowPath)
        .filter(file => file.startsWith('task') && file.endsWith('.json'));
    
    for (const file of files) {
        const queueFile = path.join(flowPath, file);
        const { queueId, queueName } = getQueueInfo(queueFile);
        const { prompts, tasks } = loadTaskFile(queueFile);
        
        if (tasks.length === 0) {
            console.log(`跳过空队列: ${queueId}`);
            continue;
        }
        
        try {
            console.log(`推送队列: ${queueId}`);
            const result = await submitQueue(
                projectId, projectName, clientInfo,
                queueId, queueName,
                prompts, tasks
            );
            console.log(`✓ 成功推送队列: ${queueId}`);
            console.log(`  消息: ${result.message}`);
            console.log(`  任务数: ${result.data.tasks_count}`);
        } catch (error) {
            console.error(`✗ 推送失败: ${queueId}`);
            console.error(`  错误: ${error.message}`);
            process.exit(1);
        }
    }
    
    console.log('所有队列推送完成');
}

main().catch(console.error);
```

---

### 6.4 追加对话消息示例

以下示例展示如何在任务创建后追加对话消息。

#### 6.4.1 Bash 脚本示例

```bash
#!/bin/bash

# 配置
API_BASE_URL="http://localhost:3000"
API_KEY="sk-xxxxxxxxxxxxxxxx"
PROJECT_ID="550e8400-e29b-41d4-a716-446655440000"
QUEUE_ID="task"
TASK_ID="1"

# 追加消息到任务
add_message() {
    local role=$1
    local content=$2
    
    local url="${API_BASE_URL}/api/v1/tasks/${PROJECT_ID}/${QUEUE_ID}/${TASK_ID}/message"
    
    local request_body=$(jq -n \
        --arg role "$role" \
        --arg content "$content" \
        '{
            role: $role,
            content: $content
        }')
    
    echo "追加消息: role=$role"
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$request_body" \
        "$url")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo "✓ 消息追加成功"
        echo "$BODY" | jq -r '.message'
        echo "$BODY" | jq -r '.data | "消息ID: \(.message_id), 角色: \(.role)"'
        return 0
    else
        echo "✗ 消息追加失败 (HTTP $HTTP_CODE)"
        echo "$BODY" | jq -r '.error.message // "未知错误"'
        return 1
    fi
}

# 查询任务详情，验证消息是否正确保存
query_task_detail() {
    local url="${API_BASE_URL}/api/v1/projects/${PROJECT_ID}/queues/${QUEUE_ID}/tasks/${TASK_ID}"
    
    echo "查询任务详情..."
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -X GET \
        -H "X-API-Key: $API_KEY" \
        "$url")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        local messages_count=$(echo "$BODY" | jq -r '.data.messages | length')
        echo "✓ 查询成功，找到 $messages_count 条消息"
        echo "$BODY" | jq -r '.data.messages[] | "  [\(.role)] \(.content)"'
        return 0
    else
        echo "✗ 查询失败 (HTTP $HTTP_CODE)"
        echo "$BODY" | jq -r '.error.message // "未知错误"'
        return 1
    fi
}

# 使用示例
# 1. 追加用户消息
add_message "user" "请帮我实现登录功能"

# 2. 追加 AI 回复
add_message "assistant" "好的，我来帮你实现登录功能..."

# 3. 查询任务详情，验证消息是否正确保存
sleep 0.5  # 等待一小段时间，确保数据已保存
query_task_detail
```

#### 6.4.2 Python 示例

```python
#!/usr/bin/env python3
import requests
import time

# 配置
API_BASE_URL = "http://localhost:3000"
API_KEY = "sk-xxxxxxxxxxxxxxxx"
PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000"
QUEUE_ID = "task"
TASK_ID = "1"

def add_message(role, content):
    """追加对话消息到指定任务"""
    url = f"{API_BASE_URL}/api/v1/tasks/{PROJECT_ID}/{QUEUE_ID}/{TASK_ID}/message"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
    }
    payload = {
        "role": role,
        "content": content
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        print(f"✓ 消息追加成功")
        print(f"  消息: {result['message']}")
        print(f"  消息ID: {result['data']['message_id']}")
        print(f"  角色: {result['data']['role']}")
        return result
    except requests.exceptions.HTTPError as e:
        print(f"✗ 消息追加失败: HTTP {e.response.status_code}")
        if e.response.headers.get('content-type', '').startswith('application/json'):
            error = e.response.json()
            print(f"  错误: {error.get('error', {}).get('message', '')}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"✗ 网络错误: {e}")
        return None

def query_task_detail():
    """查询任务详情，验证消息是否正确保存"""
    url = f"{API_BASE_URL}/api/v1/projects/{PROJECT_ID}/queues/{QUEUE_ID}/tasks/{TASK_ID}"
    headers = {
        "X-API-Key": API_KEY
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        result = response.json()
        messages = result.get('data', {}).get('messages', [])
        print(f"✓ 查询成功，找到 {len(messages)} 条消息")
        for msg in messages:
            print(f"  [{msg['role']}] {msg['content']}")
        return result
    except requests.exceptions.HTTPError as e:
        print(f"✗ 查询失败: HTTP {e.response.status_code}")
        if e.response.headers.get('content-type', '').startswith('application/json'):
            error = e.response.json()
            print(f"  错误: {error.get('error', {}).get('message', '')}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"✗ 网络错误: {e}")
        return None

# 使用示例
if __name__ == "__main__":
    # 1. 追加用户消息
    add_message("user", "请帮我实现登录功能")
    
    # 2. 追加 AI 回复
    add_message("assistant", "好的，我来帮你实现登录功能...")
    
    # 3. 查询任务详情，验证消息是否正确保存
    time.sleep(0.5)  # 等待一小段时间，确保数据已保存
    query_task_detail()
```

#### 6.4.3 Node.js 示例

```javascript
#!/usr/bin/env node
const https = require('https');
const http = require('http');

// 配置
const API_BASE_URL = 'http://localhost:3000';
const API_KEY = 'sk-xxxxxxxxxxxxxxxx';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const QUEUE_ID = 'task';
const TASK_ID = '1';

function addMessage(role, content) {
    return new Promise((resolve, reject) => {
        const url = new URL(
            `${API_BASE_URL}/api/v1/tasks/${PROJECT_ID}/${QUEUE_ID}/${TASK_ID}/message`
        );
        const payload = JSON.stringify({ role, content });
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode === 200) {
                        console.log('✓ 消息追加成功');
                        console.log(`  消息: ${result.message}`);
                        console.log(`  消息ID: ${result.data.message_id}`);
                        console.log(`  角色: ${result.data.role}`);
                        resolve(result);
                    } else {
                        console.error(`✗ 消息追加失败: HTTP ${res.statusCode}`);
                        console.error(`  错误: ${result.error?.message || '请求失败'}`);
                        reject(new Error(result.error?.message || '请求失败'));
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败: ${e.message}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function queryTaskDetail() {
    return new Promise((resolve, reject) => {
        const url = new URL(
            `${API_BASE_URL}/api/v1/projects/${PROJECT_ID}/queues/${QUEUE_ID}/tasks/${TASK_ID}`
        );
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'GET',
            headers: {
                'X-API-Key': API_KEY
            }
        };
        
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (res.statusCode === 200) {
                        const messages = result.data?.messages || [];
                        console.log(`✓ 查询成功，找到 ${messages.length} 条消息`);
                        messages.forEach(msg => {
                            console.log(`  [${msg.role}] ${msg.content}`);
                        });
                        resolve(result);
                    } else {
                        console.error(`✗ 查询失败: HTTP ${res.statusCode}`);
                        console.error(`  错误: ${result.error?.message || '请求失败'}`);
                        reject(new Error(result.error?.message || '请求失败'));
                    }
                } catch (e) {
                    reject(new Error(`解析响应失败: ${e.message}`));
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
}

// 使用示例
async function main() {
    try {
        // 1. 追加用户消息
        await addMessage('user', '请帮我实现登录功能');
        
        // 2. 追加 AI 回复
        await addMessage('assistant', '好的，我来帮你实现登录功能...');
        
        // 3. 查询任务详情，验证消息是否正确保存
        await new Promise(resolve => setTimeout(resolve, 500)); // 等待一小段时间
        await queryTaskDetail();
    } catch (error) {
        console.error(`错误: ${error.message}`);
        process.exit(1);
    }
}

main().catch(console.error);
```

---

## 7. 错误处理

### 7.1 常见错误

#### 7.1.1 提交任务接口错误

| HTTP 状态码 | 错误码 | 说明 | 解决方案 |
|------------|--------|------|----------|
| 401 | `INVALID_API_KEY` | API Key 无效或缺失 | 检查 API Key 是否正确配置 |
| 400 | `VALIDATION_ERROR` | 请求参数验证失败 | 检查请求数据格式和必填字段 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 | 联系管理员或稍后重试 |

#### 7.1.2 追加对话消息接口错误

| HTTP 状态码 | 错误码 | 说明 | 解决方案 |
|------------|--------|------|----------|
| 401 | `INVALID_API_KEY` | API Key 无效或缺失 | 检查 API Key 是否正确配置 |
| 400 | `VALIDATION_ERROR` | 请求参数验证失败 | 检查 `role` 是否为 `user` 或 `assistant`，`content` 是否为空或超过100000字符 |
| 404 | `RESOURCE_NOT_FOUND` | 任务不存在 | 检查 `projectId`、`queueId`、`taskId` 是否正确，任务是否已创建 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 | 联系管理员或稍后重试 |

### 7.2 错误处理示例

```python
try:
    result = submit_queue(...)
    print(f"成功: {result['message']}")
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 401:
        print("错误: API Key 无效")
    elif e.response.status_code == 400:
        error = e.response.json()
        print(f"错误: {error['error']['message']}")
        if 'details' in error['error']:
            print(f"详情: {error['error']['details']}")
    else:
        print(f"错误: HTTP {e.response.status_code}")
except requests.exceptions.RequestException as e:
    print(f"网络错误: {e}")
```

---

## 8. 最佳实践

### 8.1 配置文件管理

建议将 API 配置存储在配置文件中，而不是硬编码：

```json
// config.json
{
  "api_base_url": "http://localhost:3000",
  "api_key": "sk-xxxxxxxxxxxxxxxx"
}
```

### 8.2 环境变量

使用环境变量存储敏感信息：

```bash
# .env
TASKECHO_API_URL=http://localhost:3000
TASKECHO_API_KEY=sk-xxxxxxxxxxxxxxxx
```

### 8.3 幂等性保证

- 接口支持重复调用，不会产生重复数据
- 可以安全地多次推送相同的数据
- 适合在 CI/CD 流程中使用

### 8.4 批量处理

- 一次请求可以推送多个任务
- 建议单次请求不超过 100 个任务
- 如果任务数量很大，可以考虑分批推送

### 8.5 日志记录

建议记录推送操作日志：

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('taskecho_client.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)
logger.info(f"推送队列: {queue_id}")
```

---

## 9. 集成到工作流

### 9.1 Git Hook 集成

在 `post-commit` hook 中自动推送：

```bash
#!/bin/bash
# .git/hooks/post-commit

# 推送任务到 TaskEcho
/path/to/taskecho_client.sh
```

### 9.2 CI/CD 集成

在 CI/CD 流程中推送：

```yaml
# .github/workflows/push-tasks.yml
name: Push Tasks to TaskEcho

on:
  push:
    branches: [main]

jobs:
  push-tasks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Push tasks
        run: |
          python3 taskecho_client.py
        env:
          TASKECHO_API_URL: ${{ secrets.TASKECHO_API_URL }}
          TASKECHO_API_KEY: ${{ secrets.TASKECHO_API_KEY }}
```

### 9.3 定时任务

使用 cron 定时推送：

```bash
# 每天凌晨 2 点推送
0 2 * * * /path/to/taskecho_client.sh
```

---

## 10. 总结

客户端实现的核心步骤：

### 10.1 提交任务流程

1. **读取任务文件**：从 `.flow` 目录读取任务文件
2. **生成项目UUID**：客户端生成或读取已保存的项目UUID（首次运行时生成并保存到 `.taskecho_project_id` 文件）
3. **获取客户端信息**：获取主机名、用户名和项目路径信息
4. **生成项目名称**：根据当前目录名称生成项目名称
5. **生成队列信息**：从文件名提取队列ID和名称
6. **构造请求数据**：组装符合 API 规范的请求体（包含 `project_id`、`project_name`、`clientInfo`、`queue_id`、`queue_name`、`meta`、`tasks` 等字段）
7. **调用提交API**：使用 API Key 认证发送 `POST /api/v1/submit` 请求
8. **处理响应**：检查响应状态并处理错误

### 10.2 追加对话消息流程

1. **确保任务已创建**：追加消息前，必须先通过提交接口创建任务
2. **准备消息数据**：构造包含 `role`（`user` 或 `assistant`）和 `content` 的消息对象
3. **构造API路径**：使用 `projectId`、`queueId`、`taskId` 构造完整的API路径
4. **调用消息API**：使用 API Key 认证发送 `POST /api/v1/tasks/:projectId/:queueId/:taskId/message` 请求
5. **处理响应**：检查响应状态，获取追加后的消息信息（包括 `message_id`）
6. **验证消息保存**：可以通过查询任务详情API验证消息是否正确保存

**重要说明**：
- 项目ID使用UUID格式，由客户端生成并持久化保存
- 客户端信息（`clientInfo`）包含主机名、用户名和项目路径，用于标识项目的来源
- UUID文件（`.taskecho_project_id`）应该添加到 `.gitignore`，避免提交到版本控制
- 追加对话消息接口支持多轮对话，可以连续追加多条消息
- 追加消息前需要确保任务已通过提交接口创建
- 消息会立即保存到数据库，可以通过查询任务详情API（`GET /api/v1/projects/:projectId/queues/:queueId/tasks/:taskId`）验证消息是否正确保存
- 查询任务详情API需要认证（API Key），与追加消息API使用相同的认证方式

通过遵循本文档的指引，您可以轻松实现 TaskEcho 客户端，将本地任务数据推送到服务器，并在任务执行过程中追加对话消息。

