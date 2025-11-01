# cursor-tasks.js 流程图

本文档使用 Mermaid 图表展示 `cursor-tasks.js` 的执行流程。

## 主流程图

```mermaid
flowchart TD
    Start([开始]) --> ParseArgs["解析命令行参数<br/>(parse_args)"]
    ParseArgs --> CheckHelp{是否 --help?}
    CheckHelp -->|是| PrintHelp["显示帮助信息<br/>(print_help)"]
    PrintHelp --> Exit1([退出])
    
    CheckHelp -->|否| CheckReset{是否 --reset?}
    CheckReset -->|是| ResetFlow["重置任务流程<br/>(reset_tasks)"]
    CheckReset -->|否| RunTasksFlow["执行任务流程<br/>(run_all_tasks)"]
    
    ResetFlow --> End1([结束])
    RunTasksFlow --> End2([结束])
    
    ParseArgs -.->|错误| ErrorHandler[错误处理]
    ResetFlow -.->|错误| ErrorHandler
    RunTasksFlow -.->|错误| ErrorHandler
    ErrorHandler --> ExitError([退出码: 1])
    
    style Start fill:#90EE90
    style Exit1 fill:#FFB6C1
    style ExitError fill:#FF6B6B
    style End1 fill:#87CEEB
    style End2 fill:#87CEEB
```

## 重置任务流程

```mermaid
flowchart TD
    Start([开始重置]) --> LoadFile["加载任务文件<br/>(load_task_file)"]
    LoadFile --> Validate["验证配置<br/>(validate_config)"]
    Validate --> InitCount[初始化重置计数: 0]
    InitCount --> LoopStart{遍历所有任务}
    
    LoopStart -->|有任务| CheckStatus{任务状态 != pending?}
    CheckStatus -->|是| ResetStatus[设置状态为 pending]
    ResetStatus --> ClearData[清除错误信息和报告路径]
    ClearData --> Increment[重置计数 +1]
    Increment --> LogReset[记录重置日志]
    LogReset --> LoopStart
    
    CheckStatus -->|否| LogSkip[记录跳过日志]
    LogSkip --> LoopStart
    
    LoopStart -->|无任务| SaveFile["保存任务文件<br/>(save_task_file)"]
    SaveFile --> PrintSummary[打印重置摘要]
    PrintSummary --> End([结束])
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style ResetStatus fill:#FFD700
    style ClearData fill:#FFD700
```

## 执行所有任务流程

```mermaid
flowchart TD
    Start([开始执行]) --> PrintHeader[打印标题]
    PrintHeader --> LoadFile["加载任务文件<br/>(load_task_file)"]
    LoadFile --> Validate["验证配置<br/>(validate_config)"]
    Validate --> EnsureDir["确保报告目录存在<br/>(ensure_directories)"]
    EnsureDir --> FilterPrompts[过滤有效的 prompts 文件]
    FilterPrompts --> InitStats[初始化统计: completed=0, skipped=0, errored=0]
    
    InitStats --> TaskLoop{遍历任务列表}
    
    TaskLoop -->|有任务| CheckDone{状态 == done?}
    CheckDone -->|是| SkipDone[跳过, skipped++]
    SkipDone --> TaskLoop
    
    CheckDone -->|否| CheckError{状态 == error?}
    CheckError -->|是| SkipError[跳过并显示错误, skipped++]
    SkipError --> TaskLoop
    
    CheckError -->|否| CheckPending{状态 == pending?}
    CheckPending -->|否| SkipUnknown[跳过未知状态, skipped++]
    SkipUnknown --> TaskLoop
    
    CheckPending -->|是| ExecuteTask["执行任务<br/>(execute_task)"]
    ExecuteTask --> UpdateStatus["更新任务状态<br/>(update_task_status)"]
    UpdateStatus --> SaveTaskFile["保存任务文件<br/>(save_task_file)"]
    SaveTaskFile --> CheckResult{执行结果}
    CheckResult -->|成功| IncCompleted[completed++]
    CheckResult -->|失败| IncErrored[errored++]
    IncCompleted --> TaskLoop
    IncErrored --> TaskLoop
    
    TaskLoop -->|无任务| PrintSummary[打印执行摘要]
    PrintSummary --> End([结束])
    
    ExecuteTask -.->|异常| CatchError[捕获异常]
    CatchError --> UpdateErrorStatus["更新为 error 状态<br/>(update_task_status)"]
    UpdateErrorStatus --> SaveTaskFile
    SaveTaskFile --> IncErrored
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style ExecuteTask fill:#FFD700
    style CatchError fill:#FF6B6B
```

## 执行单个任务流程（核心流程）

```mermaid
flowchart TD
    Start([开始执行任务]) --> CheckSpec[检查 spec_file 是否存在]
    CheckSpec -->|不存在| ThrowError[抛出错误]
    ThrowError --> ErrorEnd([结束: 失败])
    
    CheckSpec -->|存在| CheckAgent["检查 cursor-agent-task 是否可用<br/>(find_agent_script)"]
    CheckAgent -->|不可用| ThrowError
    
    CheckAgent -->|可用| InitVars[初始化变量<br/>needsContinue=true<br/>attempts=0<br/>lastSemanticsResult=null]
    InitVars --> BuildInitialArgs["构建首次执行参数<br/>(build_agent_args)<br/>-m model<br/>-f prompts<br/>-f spec_file"]
    BuildInitialArgs --> LoopStart{是否继续 且 attempts < retry?}
    
    LoopStart -->|是| IncAttempts[attempts++]
    IncAttempts --> CheckAttempt{attempts == 1?}
    
    CheckAttempt -->|是| RunAgent["首次执行: 使用 cursor-agent-task<br/>(run_agent_once)"]
    CheckAttempt -->|否| CheckSemantics{上次判定结果 == auto?}
    CheckSemantics -->|是| SetResumePrompt[设置 resumePrompt = "按你的建议执行"]
    CheckSemantics -->|否| SetResumePrompt[设置 resumePrompt = "请继续"]
    SetResumePrompt --> RunResume["后续执行: 使用 cursor-agent resume<br/>(run_cursor_agent_directly)"]
    RunResume --> RunAgent
    
    RunAgent --> CheckRuntime["运行时错误?<br/>(is_runtime_error)"]
    
    CheckRuntime -->|是| SetError["记录错误信息<br/>(extract_short_error_message)"]
    SetError --> BreakLoop[跳出循环]
    
    CheckRuntime -->|否| CallLLM["调用 call-llm 进行语义判定<br/>(interpret_semantics_via_llm)"]
    CallLLM --> ParseResult[解析 JSON 结果<br/>(parse_llm_result)<br/>result: done/resume/auto]
    ParseResult --> SaveSemantics[保存判定结果到 lastSemanticsResult]
    SaveSemantics --> CheckResult{判定结果}
    
    CheckResult -->|done| SetSuccess[标记为成功<br/>needsContinue=false]
    SetSuccess --> BreakLoop
    
    CheckResult -->|resume/auto| LogContinue[记录继续原因]
    LogContinue --> RecordExecution[记录本次执行]
    RecordExecution --> LoopStart
    
    BreakLoop --> CheckMaxRetry{attempts >= retry<br/>且 needsContinue?}
    CheckMaxRetry -->|是| SetPartial[标记为部分完成]
    CheckMaxRetry -->|否| SetFinalStatus[设置最终状态]
    SetPartial --> SetFinalStatus
    
    SetFinalStatus --> GenerateReport["生成任务报告<br/>(write_task_report)"]
    GenerateReport --> WriteReport[写入报告文件]
    WriteReport --> ReturnResult[返回执行结果]
    ReturnResult --> End([结束])
    
    RunAgent -.->|异常| CatchRunError[捕获执行异常]
    CatchRunError --> SetError
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style RunAgent fill:#FFD700
    style SetSuccess fill:#90EE90
    style SetError fill:#FF6B6B
    style SetPartial fill:#FFA500
```

## Agent 调用流程

```mermaid
flowchart TD
    Start([开始调用]) --> FindScript["查找 cursor-agent-task 脚本路径<br/>(find_agent_script)"]
    FindScript --> CheckExists{脚本存在?}
    CheckExists -->|否| Reject[拒绝: 脚本不存在]
    Reject --> ErrorEnd([结束: 错误])
    
    CheckExists -->|是| FormatArgs[格式化参数显示]
    FormatArgs --> SpawnProcess["spawn 子进程<br/>(spawn)"]
    SpawnProcess --> SetupStreams[设置 stdout/stderr 流处理]
    SetupStreams --> SetupTimeout[设置超时定时器]
    SetupTimeout --> CollectOutput[收集输出内容]
    
    CollectOutput --> WaitClose{进程关闭?}
    WaitClose -->|否| CheckTimeout{超时?}
    CheckTimeout -->|是| KillProcess[终止进程]
    KillProcess --> RejectTimeout[拒绝: 超时]
    RejectTimeout --> ErrorEnd
    
    CheckTimeout -->|否| WaitClose
    
    WaitClose -->|是| ClearTimeout[清除超时定时器]
    ClearTimeout --> CalculateDuration[计算执行时长]
    CalculateDuration --> ReturnResult["返回结果对象<br/>(AgentRunResult)<br/>exitCode, stdout, stderr, durationMs"]
    ReturnResult --> End([结束])
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style Reject fill:#FF6B6B
    style ErrorEnd fill:#FF6B6B
    style RejectTimeout fill:#FF6B6B
```

## 语义判定流程（使用 call-llm）

```mermaid
flowchart TD
    Start([开始语义判定]) --> BuildPrompt["构建判定提示词<br/>(build_semantic_prompt)<br/>返回固定提示词"]
    BuildPrompt --> BuildArgs["构建 call-llm 参数<br/>-m judgeModel<br/>-f json<br/>-c executionSummary<br/>-p judgePrompt"]
    BuildArgs --> FindScript["查找 call-llm 脚本<br/>(find_call_llm_script)"]
    FindScript --> CallLLM["调用 call-llm<br/>(run_call_llm_once)"]
    CallLLM --> CheckError{调用失败?<br/>exitCode != 0 或 stderr}
    
    CheckError -->|是| ReturnResume["返回: resume<br/>(默认行为)"]
    ReturnResume --> End([结束])
    
    CheckError -->|否| ParseJSON["解析 JSON 结果<br/>(parse_llm_result)"]
    ParseJSON --> CheckResult{result 值}
    
    CheckResult -->|done| ReturnDone["返回: done<br/>(SemanticsResult)"]
    CheckResult -->|resume| ReturnResumeResult["返回: resume<br/>(SemanticsResult)"]
    CheckResult -->|auto| ReturnAuto["返回: auto<br/>(SemanticsResult)"]
    CheckResult -->|无效值| ReturnResume
    
    ReturnDone --> End
    ReturnResumeResult --> End
    ReturnAuto --> End
    
    CallLLM -.->|异常| CatchError[捕获异常]
    CatchError --> LogError["记录错误日志<br/>(logError)"]
    LogError --> ReturnResume
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style ReturnDone fill:#90EE90
    style ReturnResumeResult fill:#FFA500
    style ReturnAuto fill:#FFD700
    style ReturnResume fill:#FF6B6B
```

## Resume 模式执行流程

```mermaid
flowchart TD
    Start([开始 Resume 模式]) --> FindCommand["查找 cursor-agent 命令<br/>(find_cursor_agent_command)"]
    FindCommand --> BuildArgs["构建命令参数<br/>cursor-agent resume<br/>--model model<br/>--print<br/>--output-format stream-json<br/>--force<br/>prompt"]
    BuildArgs --> SpawnProcess["spawn 子进程<br/>(spawn)"]
    SpawnProcess --> SetupStreams[设置 stdout/stderr 流处理]
    SetupStreams --> SetupTimeout[设置超时定时器]
    SetupTimeout --> CollectOutput[收集输出内容]
    
    CollectOutput --> WaitClose{进程关闭?}
    WaitClose -->|否| CheckTimeout{超时?}
    CheckTimeout -->|是| KillProcess[终止进程]
    KillProcess --> RejectTimeout[拒绝: 超时]
    RejectTimeout --> ErrorEnd([结束: 错误])
    
    CheckTimeout -->|否| WaitClose
    
    WaitClose -->|是| ClearTimeout[清除超时定时器]
    ClearTimeout --> CalculateDuration[计算执行时长]
    CalculateDuration --> ReturnResult["返回结果对象<br/>(AgentRunResult)<br/>exitCode, stdout, stderr, durationMs"]
    ReturnResult --> End([结束])
    
    SpawnProcess -.->|异常| CatchError[捕获异常]
    CatchError --> RejectError[拒绝: 执行异常]
    RejectError --> ErrorEnd
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style RejectTimeout fill:#FF6B6B
    style ErrorEnd fill:#FF6B6B
    style RejectError fill:#FF6B6B
```

## 报告生成流程

```mermaid
flowchart TD
    Start([开始生成报告]) --> GenTimestamp[生成时间戳]
    GenTimestamp --> GenFilename["生成文件名<br/>(taskName_timestamp.md)"]
    GenFilename --> FormatSpecFile[格式化 spec_file 显示<br/>支持单个或数组]
    FormatSpecFile --> BuildContent[构建报告内容]
    
    BuildContent --> AddBasicInfo["添加基本信息<br/>(任务名称/描述/规格文件/模型等)"]
    AddBasicInfo --> AddStats["添加执行统计<br/>(开始时间/结束时间/执行次数/最终状态)"]
    AddStats --> AddDetails["添加执行详情<br/>(每次执行的耗时/结论/关键信息)"]
    AddDetails --> AddSummary[添加总结]
    AddSummary --> CheckError{有详细错误?}
    
    CheckError -->|是| AddError[添加详细错误信息]
    CheckError -->|否| WriteFile
    AddError --> WriteFile["写入报告文件<br/>(fsp.writeFile)"]
    WriteFile --> ReturnPath[返回报告文件路径]
    ReturnPath --> End([结束])
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style AddError fill:#FF6B6B
```

## 任务状态更新流程

```mermaid
flowchart TD
    Start([更新任务状态]) --> FindTask[查找任务对象]
    FindTask -->|找不到| End([结束])
    FindTask -->|找到| UpdateStatus["更新 status 字段<br/>(update_task_status)"]
    UpdateStatus --> CheckError{有错误信息?}
    
    CheckError -->|是| SetErrorMsg[设置 error_message]
    CheckError -->|否| CheckStatus{status == error?}
    CheckStatus -->|否| DeleteErrorMsg[删除 error_message]
    CheckStatus -->|是| KeepErrorMsg[保留 error_message]
    
    SetErrorMsg --> CheckReport
    DeleteErrorMsg --> CheckReport
    KeepErrorMsg --> CheckReport{有报告路径?}
    
    CheckReport -->|是| SetReportPath[设置 report 字段]
    CheckReport -->|否| End
    SetReportPath --> End
    
    style Start fill:#90EE90
    style End fill:#87CEEB
    style SetErrorMsg fill:#FF6B6B
```

## 完整执行流程图（概览）

```mermaid
flowchart TB
    subgraph 入口
        Main["主入口<br/>(main)"]
        ParseArgs["解析命令行参数<br/>(parse_args)"]
    end
    
    subgraph 分支决策
        CheckHelp{--help?}
        CheckReset{--reset?}
    end
    
    subgraph 重置流程
        ResetTasks["重置任务流程<br/>(reset_tasks)"]
    end
    
    subgraph 执行流程
        RunAllTasks["执行所有任务<br/>(run_all_tasks)"]
        ExecuteTask["执行单个任务<br/>(execute_task)"]
        RunAgent["首次执行: cursor-agent-task<br/>(run_agent_once)"]
        RunResume["后续执行: cursor-agent resume<br/>(run_cursor_agent_directly)"]
        SemanticJudge["语义判定<br/>(interpret_semantics_via_llm)<br/>使用 call-llm"]
        GenerateReport["生成报告<br/>(write_task_report)"]
    end
    
    subgraph 错误处理
        ErrorHandler[错误处理]
    end
    
    Main --> ParseArgs
    ParseArgs --> CheckHelp
    CheckHelp -->|是| PrintHelp["显示帮助<br/>(print_help)"]
    CheckHelp -->|否| CheckReset
    CheckReset -->|是| ResetTasks
    CheckReset -->|否| RunAllTasks
    
    ResetTasks --> End1([结束])
    PrintHelp --> End1
    
    RunAllTasks --> ExecuteTask
    ExecuteTask -->|首次执行| RunAgent
    ExecuteTask -->|后续执行| RunResume
    RunAgent --> SemanticJudge
    RunResume --> SemanticJudge
    SemanticJudge -->|done| GenerateReport
    SemanticJudge -->|resume/auto| ExecuteTask
    GenerateReport --> End2([结束])
    
    ParseArgs -.->|错误| ErrorHandler
    ResetTasks -.->|错误| ErrorHandler
    RunAllTasks -.->|错误| ErrorHandler
    ExecuteTask -.->|错误| ErrorHandler
    ErrorHandler --> ErrorEnd([退出码: 1])
    
    style Main fill:#90EE90
    style End1 fill:#87CEEB
    style End2 fill:#87CEEB
    style ErrorEnd fill:#FF6B6B
    style SemanticJudge fill:#FFD700
    style GenerateReport fill:#87CEEB
```

## 关键数据结构

### 任务对象 (Task)
```typescript
interface Task {
  name: string;              // 任务名称
  description?: string;      // 任务描述
  spec_file: string | string[];  // 规格文件路径（单个或数组）
  status: "pending" | "done" | "error";  // 任务状态
  error_message?: string;    // 错误信息（简短）
  report?: string;          // 报告文件路径
}
```

### 全局配置 (GlobalConfig)
```typescript
interface GlobalConfig {
  taskFile: string;          // 任务文件路径
  model: string;            // 模型名称
  retry: number;            // 重试次数
  timeoutMinutes: number;   // 超时时间（分钟）
  reportDir: string;        // 报告目录
  reset: boolean;           // 是否重置
  help: boolean;           // 是否显示帮助
}
```

### Agent 执行结果 (AgentRunResult)
```typescript
interface AgentRunResult {
  exitCode: number;         // 退出码
  stdout: string;          // 标准输出
  stderr: string;          // 标准错误
  durationMs: number;      // 执行时长（毫秒）
}
```

### 语义判定结果 (SemanticsResult)
```typescript
interface SemanticsResult {
  needsContinue: boolean;   // 是否需要继续
  reasons: string[];        // 原因列表
  acceptanceSummary: string; // 验收摘要
}
```

### 执行结果 (ExecutionResult)
```typescript
interface ExecutionResult {
  status: "error" | "done"; // 最终状态
  error_message?: string;    // 简短错误信息
  detailedError?: string;    // 详细错误信息
  reportPath: string;       // 报告文件路径
  attempts: number;          // 执行次数
}
```

## 关键函数说明

| 函数名 | 功能描述 |
|--------|---------|
| `parse_args` | 解析命令行参数，返回全局配置对象 |
| `load_task_file` | 读取并解析 task.json 文件 |
| `validate_config` | 校验配置完整性（任务名称唯一性、必需字段等） |
| `find_agent_script` | 查找 cursor-agent-task 脚本路径 |
| `build_agent_args` | 构建 agent 调用的参数数组 |
| `run_agent_once` | 执行一次 agent 调用，返回执行结果 |
| `is_runtime_error` | 判定是否为运行时错误 |
| `extract_acceptance_criteria` | 从 spec 文件中提取验收相关的内容 |
| `build_semantic_prompt` | 生成语义判定提示 |
| `interpret_semantics_via_agent` | 通过 agent 进行语义判定 |
| `write_task_report` | 生成任务执行报告 |
| `update_task_status` | 更新任务状态 |
| `save_task_file` | 原子性保存 task.json |
| `reset_tasks` | 重置所有任务状态为 pending |
| `execute_task` | 执行单个任务（包含重试和语义判定循环） |
| `run_all_tasks` | 执行所有任务 |

## 流程说明

### 主要特点

1. **状态驱动**: 任务执行基于状态（pending/done/error），只执行 pending 状态的任务
2. **重试机制**: 每个任务最多重试 `retry` 次
3. **语义判定**: 每次执行后通过 AI 判定任务是否完成，未完成则继续执行
4. **原子性保存**: 使用临时文件 + 重命名确保 task.json 写入的原子性
5. **实时输出**: Agent 执行过程中的输出实时显示到控制台
6. **详细报告**: 每次任务执行都会生成详细的 Markdown 报告

### 执行策略

- **跳过已完成**: 状态为 `done` 的任务直接跳过
- **跳过错误**: 状态为 `error` 的任务跳过（避免重复执行失败任务）
- **继续执行**: 通过语义判定判断任务是否完成，未完成则继续下一次执行
- **部分完成**: 达到重试上限仍未完成时，标记为"部分完成"

### 错误处理

- 运行时错误：检测退出码和非零 stderr
- 超时处理：设置超时定时器，超时后终止进程
- 异常捕获：所有关键步骤都有 try-catch 保护
- 错误记录：错误信息保存到 task.json 和详细报告中

