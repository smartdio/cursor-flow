#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");
const taskecho = require("./taskecho-client");

// ============================================================================
// 日志输出
// ============================================================================

// ANSI 颜色代码
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// 图标符号
const icons = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  arrow: "➜",
  task: "📋",
  file: "📄",
  report: "📝",
  target: "🎯",
  gear: "⚙",
  check: "✓",
  cross: "✗",
  hourglass: "⏳",
  rocket: "🚀",
  sparkles: "✨",
};

// 检测是否支持颜色输出
const supportsColor = process.stdout.isTTY && process.env.TERM !== "dumb";

// 应用颜色（如果不支持颜色则返回原文本）
function colorize(text, color) {
  if (!supportsColor) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

// 创建分隔线
function separator(char = "═", length = 60) {
  return char.repeat(length);
}

// 格式化时间戳
function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString("zh-CN", { hour12: false });
}

// 基础日志函数
function log(message, ...args) {
  const time = formatTime();
  const prefix = colorize(`[${time}]`, "gray");
  console.error(`${prefix} ${message}`, ...args);
}

// 带图标的日志函数
function logIcon(icon, message, iconColor = "bright", ...args) {
  const time = formatTime();
  const timePrefix = colorize(`[${time}]`, "gray");
  const iconText = colorize(icon, iconColor);
  console.error(`${timePrefix} ${iconText} ${message}`, ...args);
}

// 成功日志
function logSuccess(message, ...args) {
  logIcon(icons.success, message, "green", ...args);
}

// 错误日志
function logError(message, ...args) {
  logIcon(icons.error, message, "red", ...args);
}

// 警告日志
function logWarning(message, ...args) {
  logIcon(icons.warning, message, "yellow", ...args);
}

// 信息日志
function logInfo(message, ...args) {
  logIcon(icons.info, message, "cyan", ...args);
}

// 任务日志
function logTask(taskName, message, ...args) {
  const time = formatTime();
  const timePrefix = colorize(`[${time}]`, "gray");
  const taskIcon = colorize(icons.task, "blue");
  const taskNameText = colorize(taskName, "bright");
  console.error(`${timePrefix} ${taskIcon} ${taskNameText} ${message}`, ...args);
}

// 带状态的任务日志
function logTaskStatus(taskName, status, message, ...args) {
  const time = formatTime();
  const timePrefix = colorize(`[${time}]`, "gray");
  const taskIcon = colorize(icons.task, "blue");
  const taskNameText = colorize(taskName, "bright");
  
  let statusIcon, statusColor;
  switch (status) {
    case "success":
    case "done":
      statusIcon = icons.success;
      statusColor = "green";
      break;
    case "error":
    case "failed":
      statusIcon = icons.error;
      statusColor = "red";
      break;
    case "pending":
      statusIcon = icons.hourglass;
      statusColor = "yellow";
      break;
    default:
      statusIcon = icons.info;
      statusColor = "cyan";
  }
  
  const statusText = colorize(statusIcon, statusColor);
  console.error(`${timePrefix} ${taskIcon} ${taskNameText} ${statusText} ${message}`, ...args);
}

// 打印标题块
function printHeader(title, icon = icons.sparkles) {
  const sep = separator("═", 60);
  const iconText = colorize(icon, "cyan");
  const titleText = colorize(title, "bright");
  console.error("");
  console.error(colorize(sep, "cyan"));
  console.error(`  ${iconText}  ${titleText}`);
  console.error(colorize(sep, "cyan"));
  console.error("");
}

// 打印分隔线
function printSeparator(char = "─") {
  console.error(colorize(separator(char, 60), "gray"));
}

// 打印步骤
function printStep(stepNum, totalSteps, message) {
  const stepText = colorize(`[${stepNum}/${totalSteps}]`, "cyan");
  const arrow = colorize(icons.arrow, "blue");
  console.error(`  ${stepText} ${arrow} ${message}`);
}

// ============================================================================
// 1. 命令行参数解析
// ============================================================================

/**
 * 加载 .flow/.env 文件中的环境变量
 * @param {string} [cwd] - 工作目录（默认: process.cwd()）
 * @returns {Promise<void>}
 */
async function load_cursor_env(cwd = process.cwd()) {
  const envFilePath = path.join(cwd, ".flow", ".env");
  
  try {
    // 检查文件是否存在
    if (!fs.existsSync(envFilePath)) {
      return; // 文件不存在，静默返回
    }

    // 读取文件内容
    const content = await fsp.readFile(envFilePath, "utf8");
    const lines = content.split(/\r?\n/);

    // 解析每一行
    for (const line of lines) {
      // 去除首尾空白
      const trimmed = line.trim();

      // 跳过空行和注释行（以 # 开头）
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // 解析 key=value 格式
      const match = trimmed.match(/^([^=#\s]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // 处理引号包围的值
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // 如果环境变量已存在，不覆盖（保留已设置的值）
        if (process.env[key] === undefined) {
          process.env[key] = value;
          logInfo(`从 .flow/.env 加载环境变量: ${colorize(key, "cyan")}`);
        } else {
          logInfo(`跳过已存在的环境变量: ${colorize(key, "dim")}`);
        }
      }
    }
  } catch (err) {
    // 加载失败时记录警告，但不中断程序执行
    logWarning(`加载 .flow/.env 文件失败: ${err.message}`);
  }
}

/**
 * 显示帮助信息
 */
function print_help() {
  const text = `用法:
  cursor-tasks [选项]

选项:
  init                      初始化 .flow 目录（创建 .env.example 和 task.json）
  -t, --task-file <path>    任务文件路径（默认: .flow/task.json）
  -m, --model <model>       模型名称（默认: composer-1）
  --judge-model <model>     语义判定模型（必需，或设置 CURSOR_TASKS_JUDGE_MODEL 环境变量）
  --retry <num>             重试次数（默认: 3）
  --timeout <minutes>       超时时间（分钟，默认: 30）
  --reset                   重置所有任务状态为 pending
  --reset-error             重置所有 error 状态的任务为 pending
  -h, --help                显示帮助信息

环境变量:
  CURSOR_TASKS_JUDGE_MODEL  语义判定模型（如果未通过 --judge-model 提供）
                            从 .flow/.env 文件加载（如果存在）

示例:
  # 初始化 .flow 目录
  cursor-tasks init

  # 执行任务（指定判定模型）
  cursor-tasks -t .flow/task.json -m composer-1 --judge-model gpt-4

  # 使用环境变量指定判定模型
  export CURSOR_TASKS_JUDGE_MODEL=gpt-4
  cursor-tasks -t .flow/task.json -m composer-1

  # 重置任务状态
  cursor-tasks --task-file .flow/task.json --reset

  # 重置 error 状态的任务
  cursor-tasks --task-file .flow/task.json --reset-error

  # 显示帮助
  cursor-tasks --help
  cursor-tasks -h
`;
  console.log(text);
}

/**
 * 解析命令行参数,返回全局配置对象
 * @param {string[]} argv - 命令行参数数组
 * @returns {Object} GlobalConfig
 */
function parse_args(argv) {
  const config = {
    taskFile: ".flow/task.json",
    model: "composer-1",
    judgeModel: process.env.CURSOR_TASKS_JUDGE_MODEL || null, // 判定模型
    retry: 3,
    timeoutMinutes: 30,
    reportDir: ".flow/tasks/report",
    reset: false, // 是否重置任务状态
    resetError: false, // 是否重置 error 状态的任务
    init: false, // 是否初始化 .flow 目录
    help: false, // 是否显示帮助
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "init") {
      config.init = true;
    } else if ((arg === "-t" || arg === "--task-file") && i + 1 < argv.length) {
      config.taskFile = argv[++i];
    } else if ((arg === "-m" || arg === "--model") && i + 1 < argv.length) {
      config.model = argv[++i];
    } else if (arg === "--judge-model" && i + 1 < argv.length) {
      config.judgeModel = argv[++i];
    } else if (arg === "--retry" && i + 1 < argv.length) {
      config.retry = parseInt(argv[++i], 10);
    } else if (arg === "--timeout" && i + 1 < argv.length) {
      config.timeoutMinutes = parseInt(argv[++i], 10);
    } else if (arg === "--reset") {
      config.reset = true;
    } else if (arg === "--reset-error") {
      config.resetError = true;
    } else if (arg === "-h" || arg === "--help") {
      config.help = true;
    }
  }

  // 如果执行任务（非 reset、reset-error、init 和 help），验证判定模型是否已指定
  if (!config.reset && !config.resetError && !config.init && !config.help && !config.judgeModel) {
    throw new Error("判定模型未指定。请使用 --judge-model 参数或设置 CURSOR_TASKS_JUDGE_MODEL 环境变量");
  }

  return config;
}

// ============================================================================
// 2. 文件加载和验证
// ============================================================================

/**
 * 读取并解析 task.json
 * @param {string} taskFilePath - task.json 文件路径
 * @returns {Promise<Object>} TaskFile
 */
async function load_task_file(taskFilePath) {
  const resolvedPath = path.resolve(taskFilePath);
  const content = await fsp.readFile(resolvedPath, "utf8");
  return JSON.parse(content);
}

/**
 * 校验配置完整性
 * @param {Object} config - TaskFile 配置对象
 * @returns {void}
 */
function validate_config(config) {
  if (!config.tasks || !Array.isArray(config.tasks)) {
    throw new Error("task.json 中缺少 tasks 数组");
  }

  // 检查任务 ID 唯一性和必填性
  const ids = new Set();
  const names = new Set();
  
  for (const task of config.tasks) {
    // 验证 name 字段（必填）
    if (!task.name) {
      throw new Error("任务缺少 name 字段");
    }
    if (names.has(task.name)) {
      throw new Error(`任务名称重复: ${task.name}`);
    }
    names.add(task.name);

    // 验证 id 字段（必填）
    if (task.id === undefined || task.id === null) {
      throw new Error(`任务 "${task.name}" 缺少必填字段 id`);
    }
    
    const taskId = String(task.id).trim();
    if (taskId.length === 0) {
      throw new Error(`任务 "${task.name}" 的 id 字段不能为空字符串`);
    }
    if (taskId.length > 255) {
      throw new Error(`任务 "${task.name}" 的 id 字段长度不能超过 255 字符`);
    }
    if (ids.has(taskId)) {
      throw new Error(`任务 ID 重复: ${taskId} (任务: ${task.name})`);
    }
    ids.add(taskId);

    // prompt 和 spec_file 至少要有其中一个
    const hasPrompt = task.prompt && typeof task.prompt === "string" && task.prompt.trim().length > 0;
    const hasSpecFile = task.spec_file !== undefined && task.spec_file !== null;
    
    if (!hasPrompt && !hasSpecFile) {
      throw new Error(`任务 ${task.name} 必须至少提供 prompt 或 spec_file 其中之一`);
    }

    // 如果提供了 spec_file，验证其格式
    if (hasSpecFile) {
      // spec_file 可以是字符串或字符串数组
      if (typeof task.spec_file !== "string" && !Array.isArray(task.spec_file)) {
        throw new Error(`任务 ${task.name} 的 spec_file 必须是字符串或字符串数组`);
      }
      if (Array.isArray(task.spec_file) && task.spec_file.length === 0) {
        throw new Error(`任务 ${task.name} 的 spec_file 数组不能为空`);
      }
    }
  }
}

/**
 * 确保报告目录存在
 * @param {string} reportDir - 报告目录路径
 * @returns {Promise<void>}
 */
async function ensure_directories(reportDir) {
  const resolvedPath = path.resolve(reportDir);
  try {
    await fsp.mkdir(resolvedPath, { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") {
      throw err;
    }
  }
}

// ============================================================================
// 3. Agent 调用相关
// ============================================================================

/**
 * 查找 cursor-agent-task 脚本路径
 * 优先使用命令（如果已安装），否则使用本地文件路径
 * @returns {string} 脚本路径或命令名
 */
function find_agent_script() {
  // 方法1: 尝试使用命令（如果已全局安装或通过 npx）
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync("cursor-agent-task", ["--help"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.error && result.error.code !== "ENOENT") {
      // 命令存在但执行出错，仍然使用命令
      return "cursor-agent-task";
    }
    if (!result.error) {
      // 命令存在且可以执行
      return "cursor-agent-task";
    }
  } catch (e) {
    // 忽略错误，继续尝试其他方法
  }

  // 方法2: 使用本地文件路径（同一包中的文件）
  const localPath = path.resolve(__dirname, "cursor-agent-task.js");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 方法3: 尝试通过 require.resolve 查找（对于 npm 包）
  try {
    const resolved = require.resolve("@n8flow/cursor-flow/cursor-agent-task.js");
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  } catch (e) {
    // 忽略错误
  }

  // 如果都找不到，返回默认路径（会在使用时检查）
  return localPath;
}

/**
 * 组装 cursor-agent-task.js 的参数数组（仅用于 initial 模式）
 * @param {string} model - 模型名称
 * @param {string[]} prompts - 提示词文件路径数组
 * @param {string|string[]} specFiles - spec 文件路径（字符串或字符串数组）
 * @param {string} [taskPrompt] - 任务的 prompt 属性（可选）
 * @param {string} judgeModel - 语义判定模型
 * @param {number} retry - 重试次数
 * @param {number} timeoutMinutes - 超时时间（分钟）
 * @param {Object} [task] - 任务对象（可选，用于 TaskEcho 推送）
 * @param {string} [taskFile] - 任务文件路径（可选，用于 TaskEcho 推送）
 * @returns {string[]} 参数数组
 */
function build_agent_args(model, prompts, specFiles, taskPrompt, judgeModel, retry, timeoutMinutes, task = null, taskFile = null) {
  const args = ["-m", model];

  // 添加语义判定模型（必需）
  args.push("--judge-model", judgeModel);

  // 添加重试次数
  args.push("--retry", retry.toString());

  // 添加超时时间
  args.push("--timeout", timeoutMinutes.toString());

  // 先添加 prompts 文件(作为最优先的 -f 参数)
  if (prompts && prompts.length > 0) {
    logInfo(`开始处理 ${prompts.length} 个提示词文件`);
    for (const promptFile of prompts) {
      const resolved = path.resolve(promptFile);
      if (fs.existsSync(resolved)) {
        args.push("-f", resolved);
        logSuccess(`添加提示词文件: ${colorize(promptFile, "cyan")}`);
      } else {
        logWarning(`提示词文件不存在,已跳过: ${colorize(promptFile, "dim")}`);
      }
    }
  } else {
    logWarning(`prompts 数组为空或未提供`);
  }

  // 添加 spec_file(s) - 支持单个文件或文件数组（如果提供）
  if (specFiles) {
    const specFileArray = Array.isArray(specFiles) ? specFiles : [specFiles];
    logInfo(`开始处理 ${specFileArray.length} 个 spec 文件`);
    for (const specFile of specFileArray) {
      const resolvedSpec = path.resolve(specFile);
      if (!fs.existsSync(resolvedSpec)) {
        throw new Error(`spec_file 不存在: ${specFile}`);
      }
      args.push("-f", resolvedSpec);
      logSuccess(`添加 spec 文件: ${colorize(specFile, "cyan")}`);
    }
  }

  // 最后添加任务的 prompt 属性（如果存在）- 作为 -p 参数
  if (taskPrompt && taskPrompt.trim()) {
    args.push("-p", taskPrompt.trim());
    logSuccess(`添加任务 prompt: ${colorize(taskPrompt.substring(0, 50) + (taskPrompt.length > 50 ? "..." : ""), "cyan")}`);
  }

  // 如果 TaskEcho 启用且任务有 ID，添加 TaskEcho 参数
  if (taskecho.isEnabled() && task && task.id && taskFile) {
    const echoUrl = taskecho.getApiUrl();
    const echoApiKey = taskecho.getApiKey();
    if (echoUrl && echoApiKey) {
      args.push("--echo-url", echoUrl);
      args.push("--echo-api-key", echoApiKey);
      args.push("--echo-task-id", task.id);
      args.push("--echo-task-file", taskFile);
      logInfo(`添加 TaskEcho 参数: ${colorize("已启用", "cyan")}`);
    }
  }

  logInfo(`构建的 agent 参数: ${colorize(args.join(" "), "dim")}`);
  return args;
}

/**
 * 执行一次 agent 调用
 * @param {string[]} agentArgs - agent 参数数组
 * @param {number} timeoutMinutes - 超时时间(分钟)
 * @returns {Promise<Object>} AgentRunResult
 */
function run_agent_once(agentArgs, timeoutMinutes) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const scriptPathOrCommand = find_agent_script();

    // 检查是否是文件路径且文件存在
    if (scriptPathOrCommand !== "cursor-agent-task" && !fs.existsSync(scriptPathOrCommand)) {
      reject(new Error(`cursor-agent-task 不存在: ${scriptPathOrCommand}`));
      return;
    }

    // 构建完整命令并输出
    // 格式化参数，对于长文件路径或提示词，只显示关键信息
    const formattedArgs = [];
    for (let i = 0; i < agentArgs.length; i++) {
      const arg = agentArgs[i];
      if (arg === "-f" || arg === "--file") {
        // 文件路径参数
        formattedArgs.push(arg);
        if (i + 1 < agentArgs.length) {
          const filePath = agentArgs[++i];
          // 显示相对路径或文件名
          const relativePath = path.relative(process.cwd(), filePath);
          formattedArgs.push(
            relativePath.startsWith("..")
              ? path.basename(filePath)
              : relativePath
          );
        }
      } else if (arg === "-p" || arg === "--prompt") {
        // 提示词参数
        formattedArgs.push(arg);
        if (i + 1 < agentArgs.length) {
          const prompt = agentArgs[++i];
          // 如果提示词太长，只显示前100个字符
          if (prompt.length > 100) {
            formattedArgs.push(`"${prompt.substring(0, 97)}..."`);
          } else {
            formattedArgs.push(`"${prompt}"`);
          }
        }
      } else {
        formattedArgs.push(arg);
      }
    }
    // 根据脚本路径或命令选择执行方式
    const isCommand = scriptPathOrCommand === "cursor-agent-task";
    const fullCommand = isCommand
      ? `cursor-agent-task ${formattedArgs.join(" ")}`
      : `node ${scriptPathOrCommand} ${formattedArgs.join(" ")}`;
    logInfo(`执行命令: ${colorize(fullCommand, "bright")}`);
    console.error(""); // 空行分隔

    const child = spawn(
      isCommand ? "cursor-agent-task" : "node",
      isCommand ? agentArgs : [scriptPathOrCommand, ...agentArgs],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let isClosed = false;

    // 安全写入函数，检查流是否可写
    const safeWrite = (stream, text) => {
      if (!isClosed && stream && !stream.destroyed && stream.writable) {
        try {
          stream.write(text);
        } catch (err) {
          // 忽略写入错误（流可能已关闭）
        }
      }
    };

    // 实时输出到控制台，同时收集内容
    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      // 实时输出到控制台
      safeWrite(process.stdout, text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      // 实时输出到控制台
      safeWrite(process.stderr, text);
    });

    // 处理流结束事件
    child.stdout.on("end", () => {
      // stdout 流结束
    });

    child.stderr.on("end", () => {
      // stderr 流结束
    });

    // 处理流错误
    child.stdout.on("error", (err) => {
      // 忽略 stdout 错误
    });

    child.stderr.on("error", (err) => {
      // 忽略 stderr 错误
    });

    const timeoutMs = timeoutMinutes * 60 * 1000;
    const timeoutId = setTimeout(() => {
      isClosed = true;
      child.kill("SIGTERM");
      reject(new Error(`执行超时(超过 ${timeoutMinutes} 分钟)`));
    }, timeoutMs);

    child.on("close", (code) => {
      isClosed = true;
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs,
      });
    });

    child.on("error", (err) => {
      isClosed = true;
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * 判定是否为运行时错误
 * @param {number} exitCode - 退出码
 * @param {string} stderr - 错误输出
 * @returns {boolean}
 */
function is_runtime_error(exitCode, stderr) {
  // 退出码非0视为运行时错误
  if (exitCode !== 0) {
    return true;
  }
  // stderr 中包含关键错误信息也视为运行时错误
  const errorPatterns = [
    /错误:/,
    /error:/i,
    /failed/i,
    /cannot find/i,
    /not found/i,
    /ENOENT/i,
  ];
  return errorPatterns.some((pattern) => pattern.test(stderr));
}

// ============================================================================
// 4. 报告生成
// ============================================================================

/**
 * 提取简短的错误说明(用于 task.json)
 * @param {string} detailedError - 详细错误信息
 * @returns {string} 简短错误说明
 */
function extract_short_error_message(detailedError) {
  if (!detailedError) return "";

  // 提取第一行或前100个字符
  const firstLine = detailedError.split("\n")[0];
  if (firstLine.length <= 100) {
    return firstLine;
  }
  return firstLine.substring(0, 97) + "...";
}

/**
 * 生成任务执行报告
 * @param {Object} task - 任务对象
 * @param {number} attempts - 执行次数
 * @param {Object} summary - ReportSummary 对象
 * @param {string} finalStatus - 最终状态
 * @param {string} reportDir - 报告目录
 * @param {string} [detailedError] - 详细错误信息(可选)
 * @returns {Promise<string>} 报告文件路径
 */
async function write_task_report(
  task,
  attempts,
  summary,
  finalStatus,
  reportDir,
  detailedError
) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .substring(0, 19);
  const filename = `${task.name}_${timestamp}.md`;
  const reportPath = path.resolve(reportDir, filename);
  // 计算相对路径(相对于当前工作目录)
  const reportRelativePath = path.relative(process.cwd(), reportPath);

  // 格式化 spec_file 显示（支持单个文件或文件数组，如果不存在则显示"无"）
  const specFileDisplay = task.spec_file
    ? (Array.isArray(task.spec_file)
        ? task.spec_file.join(", ")
        : task.spec_file)
    : "无";

  const reportContent = `# 任务执行报告

## 任务基本信息

- **任务名称**: ${task.name}
${task.description ? `- **任务描述**: ${task.description}\n` : ""}- **规格文件**: ${specFileDisplay}
- **模型**: ${summary.model}
- **超时设置**: ${summary.timeoutMinutes} 分钟
- **重试次数**: ${summary.retry}

## 执行统计

- **开始时间**: ${summary.startedAt}
- **结束时间**: ${summary.endedAt}
- **实际执行次数**: ${summary.attempts}
- **最终状态**: ${finalStatus}

## 执行详情

${summary.executions
  .map(
    (exec, idx) => `
### 第 ${exec.index} 次执行

- **耗时**: ${(exec.durationMs / 1000).toFixed(2)} 秒
- **结论**: ${exec.conclusion}
${exec.notes && exec.notes.length > 0 ? `- **关键信息**:\n${exec.notes.map((n) => `  - ${n}`).join("\n")}` : ""}
`
  )
  .join("\n")}

## 总结

最终执行结果: **${finalStatus}**

${detailedError ? `### 详细错误信息\n\n\`\`\`\n${detailedError}\n\`\`\`\n` : ""}

${
  summary.executions.length > 0 &&
  summary.executions[summary.executions.length - 1].notes
    ? `### 备注\n${summary.executions[summary.executions.length - 1].notes.join("\n")}`
    : ""
}
`;

  await fsp.writeFile(reportPath, reportContent, "utf8");
  // 返回相对路径,便于保存到 task.json
  return reportRelativePath;
}

// ============================================================================
// 6. 任务状态管理
// ============================================================================

/**
 * 更新任务状态
 * @param {Object[]} tasks - 任务数组
 * @param {string} taskName - 任务名称
 * @param {string} status - 新状态
 * @param {string} [errorMessage] - 错误信息(可选)
 * @param {string} [reportPath] - 报告文件路径(可选)
 * @returns {void}
 */
function update_task_status(tasks, taskName, status, errorMessage, reportPath) {
  const task = tasks.find((t) => t.name === taskName);
  if (task) {
    task.status = status;
    if (errorMessage) {
      task.error_message = errorMessage;
    } else if (status !== "error") {
      delete task.error_message;
    }
    if (reportPath) {
      task.report = reportPath;
    }
  }
}

/**
 * 原子性保存 task.json
 * @param {string} taskFilePath - task.json 文件路径
 * @param {Object} config - TaskFile 配置对象
 * @returns {Promise<void>}
 */
async function save_task_file(taskFilePath, config) {
  const resolvedPath = path.resolve(taskFilePath);
  const tempPath = resolvedPath + ".tmp";
  const content = JSON.stringify(config, null, 2) + "\n";

  // 先写入临时文件
  await fsp.writeFile(tempPath, content, "utf8");
  // 原子性替换
  await fsp.rename(tempPath, resolvedPath);
}

// ============================================================================
// 7. 初始化功能
// ============================================================================

/**
 * 验证 task.json 示例文件格式是否正确
 * @param {string} filePath - 文件路径
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validate_example_task_file(filePath) {
  try {
    const content = await fsp.readFile(filePath, "utf8");
    const config = JSON.parse(content);
    
    // 检查基本结构
    if (!config.tasks || !Array.isArray(config.tasks)) {
      return { valid: false, error: "缺少 tasks 数组" };
    }
    
    // 检查每个任务是否包含 id 字段
    for (let i = 0; i < config.tasks.length; i++) {
      const task = config.tasks[i];
      if (task.id === undefined || task.id === null) {
        return { valid: false, error: `任务 ${i + 1} (${task.name || "未命名"}) 缺少 id 字段` };
      }
      if (typeof task.id !== "string" || task.id.trim().length === 0) {
        return { valid: false, error: `任务 ${i + 1} (${task.name || "未命名"}) 的 id 字段无效` };
      }
    }
    
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `解析失败: ${err.message}` };
  }
}

/**
 * 初始化 .flow 目录
 * 创建 .flow/.env.example、.flow/task.json 和报告目录
 * @param {string} [cwd] - 工作目录（默认: process.cwd()）
 * @returns {Promise<void>}
 */
async function init_flow_directory(cwd = process.cwd()) {
  printHeader("初始化 .flow 目录", icons.gear);

  const flowDir = path.join(cwd, ".flow");
  const reportDir = path.join(flowDir, "tasks", "report");
  const envExamplePath = path.join(flowDir, ".env.example");
  const taskJsonPath = path.join(flowDir, "task.json");
  const taskJsonExamplePath = path.join(cwd, "doc", "task.json.example");

  // 创建 .flow 目录（如果不存在）
  try {
    await fsp.mkdir(flowDir, { recursive: true });
    logSuccess(`目录已创建: ${colorize(".flow", "cyan")}`);
  } catch (err) {
    if (err.code !== "EEXIST") {
      throw new Error(`创建 .flow 目录失败: ${err.message}`);
    }
    logInfo(`目录已存在: ${colorize(".flow", "dim")}`);
  }

  // 创建报告目录（如果不存在）
  try {
    await fsp.mkdir(reportDir, { recursive: true });
    logSuccess(`目录已创建: ${colorize(".flow/tasks/report", "cyan")}`);
  } catch (err) {
    if (err.code !== "EEXIST") {
      throw new Error(`创建报告目录失败: ${err.message}`);
    }
    logInfo(`目录已存在: ${colorize(".flow/tasks/report", "dim")}`);
  }

  // 创建 .env.example 文件（如果不存在）
  if (!fs.existsSync(envExamplePath)) {
    const envExampleContent = `# Cursor Tasks 环境变量配置示例
# 复制此文件为 .env 并填入实际值

# 语义判定模型（必需）
# 用于判定任务是否完成，例如: gpt-4, gpt-4-turbo-preview, claude-3-opus-20240229
CURSOR_TASKS_JUDGE_MODEL=

# TaskEcho 服务配置（可选）
# TaskEcho API 服务地址
TASKECHO_API_URL=http://localhost:3000
# TaskEcho API Key
TASKECHO_API_KEY=
# 是否启用 TaskEcho 集成（true/false）
TASKECHO_ENABLED=false
`;
    await fsp.writeFile(envExamplePath, envExampleContent, "utf8");
    logSuccess(`文件已创建: ${colorize(".flow/.env.example", "cyan")}`);
  } else {
    logInfo(`文件已存在，跳过: ${colorize(".flow/.env.example", "dim")}`);
  }

  // 创建 task.json 文件（如果不存在）
  if (!fs.existsSync(taskJsonPath)) {
    let taskJsonContent;
    let useExampleFile = false;
    
    // 如果存在示例文件，验证并使用示例文件内容
    if (fs.existsSync(taskJsonExamplePath)) {
      const validation = await validate_example_task_file(taskJsonExamplePath);
      if (validation.valid) {
        taskJsonContent = await fsp.readFile(taskJsonExamplePath, "utf8");
        logSuccess(`使用示例文件: ${colorize("doc/task.json.example", "cyan")}`);
        useExampleFile = true;
      } else {
        logWarning(`示例文件格式验证失败: ${validation.error}`);
        logInfo(`将使用默认模板替代`);
      }
    }
    
    // 如果示例文件不存在或验证失败，使用默认模板
    if (!useExampleFile) {
      taskJsonContent = JSON.stringify({
        prompts: [],
        tasks: [
          {
            id: "1",
            name: "示例任务1",
            description: "这是一个示例任务，用于演示 task.json 的格式",
            spec_file: "doc/specs/example-task-1.md",
            prompt: "请完成这个示例任务",
            status: "pending"
          },
          {
            id: "2",
            name: "示例任务2",
            description: "另一个示例任务，演示多个 spec 文件",
            spec_file: [
              "doc/specs/example-task-2-part1.md",
              "doc/specs/example-task-2-part2.md"
            ],
            status: "pending"
          },
          {
            id: "3",
            name: "示例任务3",
            description: "演示仅使用 prompt 而不使用 spec_file 的任务",
            prompt: "请帮我生成一个简单的 Hello World 程序",
            status: "pending"
          }
        ]
      }, null, 2) + "\n";
      logInfo(`使用默认模板创建 task.json`);
    }
    
    await fsp.writeFile(taskJsonPath, taskJsonContent, "utf8");
    logSuccess(`文件已创建: ${colorize(".flow/task.json", "cyan")}`);
  } else {
    logInfo(`文件已存在，跳过: ${colorize(".flow/task.json", "dim")}`);
  }

  console.error("");
  printSeparator();
  logSuccess(`初始化完成！`);
  console.error("");
  logInfo(`${colorize("下一步:", "bright")}`);
  logInfo(`  1. 复制 ${colorize(".flow/.env.example", "cyan")} 为 ${colorize(".flow/.env", "cyan")} 并填入实际值`);
  logInfo(`  2. 编辑 ${colorize(".flow/task.json", "cyan")} 配置你的任务`);
  console.error("");
  logInfo(`${colorize("重要提示:", "bright")}`);
  logInfo(`  • 每个任务必须包含 ${colorize("id", "yellow")} 字段（必填，在队列内唯一）`);
  logInfo(`  • 任务必须提供 ${colorize("prompt", "yellow")} 或 ${colorize("spec_file", "yellow")} 至少其中一个`);
  logInfo(`  • 执行报告将保存在 ${colorize(".flow/tasks/report", "cyan")} 目录`);
  logInfo(`  • TaskEcho 集成（可选）：在 ${colorize(".flow/.env", "cyan")} 中设置 TASKECHO_ENABLED=true 启用`);
  logInfo(`  • TaskEcho 项目 ID 会在首次推送时自动生成并保存到 ${colorize(".flow/.taskecho_project_id", "cyan")}`);
  printSeparator();
}

// ============================================================================
// 8. 任务重置功能
// ============================================================================

/**
 * 重置任务状态为 pending
 * @param {Object} globalConfig - 全局配置
 * @returns {Promise<void>}
 */
async function reset_tasks(globalConfig) {
  printHeader("重置任务状态", icons.gear);

  // 加载任务文件
  logInfo(`加载任务文件: ${colorize(globalConfig.taskFile, "cyan")}`);
  const taskFile = await load_task_file(globalConfig.taskFile);

  // 验证配置
  validate_config(taskFile);

  let resetCount = 0;

  // 重置所有任务状态为 pending
  console.error("");
  for (const task of taskFile.tasks) {
    if (task.status !== "pending") {
      const oldStatus = task.status;
      task.status = "pending";
      // 清除错误信息和报告路径
      delete task.error_message;
      delete task.report;
      resetCount++;
      const oldStatusText = colorize(oldStatus, "yellow");
      const newStatusText = colorize("pending", "green");
      logTaskStatus(task.name, "pending", `${oldStatusText} ${colorize("→", "gray")} ${newStatusText}`);
    } else {
      logTaskStatus(task.name, "pending", "已经是 pending 状态,跳过");
    }
  }

  // 保存任务文件
  await save_task_file(globalConfig.taskFile, taskFile);
  logSuccess(`任务文件已保存`);

  // 推送更新后的全量队列到 TaskEcho（如果启用）
  if (taskecho.isEnabled()) {
    try {
      logInfo(`TaskEcho 已启用，重新读取任务文件并推送全量队列...`);
      // 重新读取任务文件，确保推送的是文件中的最新状态
      const updatedTaskFile = await load_task_file(globalConfig.taskFile);
      const projectInfo = await taskecho.getProjectInfo();
      const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, updatedTaskFile);
      await taskecho.submitQueue(projectInfo, queueInfo, updatedTaskFile);
      logSuccess(`全量队列已推送到 TaskEcho（共 ${colorize(updatedTaskFile.tasks.length, "bright")} 个任务）`);
    } catch (err) {
      logWarning(`TaskEcho 推送失败: ${err.message}`);
      // 不中断执行，重置操作已完成
    }
  } else {
    const enabledValue = process.env.TASKECHO_ENABLED || "未设置";
    const apiKeySet = process.env.TASKECHO_API_KEY ? "已设置" : "未设置";
    logInfo(`TaskEcho 未启用（TASKECHO_ENABLED=${enabledValue}, TASKECHO_API_KEY=${apiKeySet}），跳过队列推送`);
  }

  console.error("");
  printSeparator();
  logSuccess(`重置完成: 共重置 ${colorize(resetCount, "bright")} 个任务`);
  printSeparator();
}

/**
 * 重置 error 状态的任务为 pending
 * @param {Object} globalConfig - 全局配置
 * @returns {Promise<void>}
 */
async function reset_error_tasks(globalConfig) {
  printHeader("重置 error 状态任务", icons.gear);

  // 加载任务文件
  logInfo(`加载任务文件: ${colorize(globalConfig.taskFile, "cyan")}`);
  const taskFile = await load_task_file(globalConfig.taskFile);

  // 验证配置
  validate_config(taskFile);

  let resetCount = 0;

  // 只重置 error 状态的任务为 pending
  console.error("");
  for (const task of taskFile.tasks) {
    if (task.status === "error") {
      task.status = "pending";
      // 清除错误信息和报告路径
      delete task.error_message;
      delete task.report;
      resetCount++;
      const oldStatusText = colorize("error", "red");
      const newStatusText = colorize("pending", "green");
      logTaskStatus(task.name, "pending", `${oldStatusText} ${colorize("→", "gray")} ${newStatusText}`);
    } else {
      logTaskStatus(task.name, task.status || "pending", `状态为 ${task.status || "pending"},跳过`);
    }
  }

  // 保存任务文件
  await save_task_file(globalConfig.taskFile, taskFile);
  logSuccess(`任务文件已保存`);

  // 推送更新后的全量队列到 TaskEcho（如果启用）
  if (taskecho.isEnabled()) {
    try {
      logInfo(`TaskEcho 已启用，重新读取任务文件并推送全量队列...`);
      // 重新读取任务文件，确保推送的是文件中的最新状态
      const updatedTaskFile = await load_task_file(globalConfig.taskFile);
      const projectInfo = await taskecho.getProjectInfo();
      const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, updatedTaskFile);
      await taskecho.submitQueue(projectInfo, queueInfo, updatedTaskFile);
      logSuccess(`全量队列已推送到 TaskEcho（共 ${colorize(updatedTaskFile.tasks.length, "bright")} 个任务）`);
    } catch (err) {
      logWarning(`TaskEcho 推送失败: ${err.message}`);
      // 不中断执行，重置操作已完成
    }
  } else {
    const enabledValue = process.env.TASKECHO_ENABLED || "未设置";
    const apiKeySet = process.env.TASKECHO_API_KEY ? "已设置" : "未设置";
    logInfo(`TaskEcho 未启用（TASKECHO_ENABLED=${enabledValue}, TASKECHO_API_KEY=${apiKeySet}），跳过队列推送`);
  }

  console.error("");
  printSeparator();
  logSuccess(`重置完成: 共重置 ${colorize(resetCount, "bright")} 个 error 状态的任务`);
  printSeparator();
}

// ============================================================================
// 8. 任务执行编排
// ============================================================================

/**
 * 执行单个任务
 * @param {Object} task - 任务对象
 * @param {Object} globalConfig - 全局配置
 * @param {string[]} prompts - 提示词文件数组
 * @returns {Promise<Object>} ExecutionResult
 */
async function execute_task(task, globalConfig, prompts) {
  console.error("");
  printSeparator("─");
  logTaskStatus(task.name, "pending", "开始执行任务");
  
  // 推送用户消息到 TaskEcho（如果启用）
  if (taskecho.isEnabled() && task.id) {
    try {
      const projectInfo = await taskecho.getProjectInfo();
      const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, { prompts: prompts || [] });
      const userMessage = task.prompt || "开始执行任务";
      await taskecho.addMessage(
        projectInfo.project_id,
        queueInfo.queue_id,
        task.id,
        "user",
        userMessage
      );
    } catch (err) {
      logWarning(`TaskEcho 消息推送失败: ${err.message}`);
    }
  }
  
  if (prompts && prompts.length > 0) {
    logInfo(`接收到的 prompts: ${colorize(prompts.length, "cyan")} 个文件`);
  }

  const startedAt = new Date().toISOString();
  let errorMessage = null; // 简短错误信息(用于 task.json)
  let detailedError = null; // 详细错误信息(用于报告)
  let attempts = 0;
  let finalStatus = "成功";
  let executions = [];

  try {
    // 检查 spec_file(s) 是否存在（如果提供了 spec_file，支持单个文件或文件数组）
    if (task.spec_file) {
      const specFileArray = Array.isArray(task.spec_file) ? task.spec_file : [task.spec_file];
      for (const specFile of specFileArray) {
        const specPath = path.resolve(specFile);
        if (!fs.existsSync(specPath)) {
          throw new Error(`spec_file 不存在: ${specFile}`);
        }
      }
    }

    // 检查 cursor-agent-task 是否可用
    const agentScriptOrCommand = find_agent_script();
    if (agentScriptOrCommand !== "cursor-agent-task" && !fs.existsSync(agentScriptOrCommand)) {
      throw new Error(`cursor-agent-task 不存在: ${agentScriptOrCommand}`);
    }

    // 构建参数（包括新增的 judgeModel, retry, timeout）
    const agentArgs = build_agent_args(
      globalConfig.model,
      prompts,
      task.spec_file,
      task.prompt,
      globalConfig.judgeModel,
      globalConfig.retry,
      globalConfig.timeoutMinutes,
      task, // 传递任务对象用于 TaskEcho
      globalConfig.taskFile // 传递任务文件路径用于 TaskEcho
    );

    // 调用 cursor-agent-task.js（只调用一次，它会内部处理循环）
    // 超时时间应该是 每次超时 * 重试次数
    const totalTimeoutMinutes = globalConfig.timeoutMinutes * globalConfig.retry;
    logTaskStatus(task.name, "pending", `调用 cursor-agent-task（总超时: ${totalTimeoutMinutes} 分钟）`);
    
    const result = await run_agent_once(agentArgs, totalTimeoutMinutes);

    // 解析返回的 JSON 结果
    // 注意：stdout 中可能包含助手输出的文本，需要提取 JSON 部分
    let executionResult = null;
    let jsonParseSuccess = false;
    
    try {
      let jsonText = result.stdout.trim();
      
      // 方法1: 尝试直接解析整个 stdout（可能 stdout 就是纯 JSON）
      try {
        executionResult = JSON.parse(jsonText);
        jsonParseSuccess = true;
        logInfo(`成功解析完整 stdout 为 JSON`);
      } catch (e) {
        // 方法2: 尝试找到 JSON 对象（从最后一个 { 开始，匹配到对应的 }）
        const lastBraceIndex = jsonText.lastIndexOf("{");
        if (lastBraceIndex >= 0) {
          // 从最后一个 { 开始，尝试找到匹配的 }
          let braceCount = 0;
          let jsonEndIndex = -1;
          for (let i = lastBraceIndex; i < jsonText.length; i++) {
            if (jsonText[i] === "{") braceCount++;
            if (jsonText[i] === "}") braceCount--;
            if (braceCount === 0) {
              jsonEndIndex = i + 1;
              break;
            }
          }
          if (jsonEndIndex > lastBraceIndex) {
            const extractedJson = jsonText.substring(lastBraceIndex, jsonEndIndex);
            executionResult = JSON.parse(extractedJson);
            jsonParseSuccess = true;
            logInfo(`成功从 stdout 中提取并解析 JSON`);
          } else {
            throw new Error("无法找到匹配的 JSON 结束位置");
          }
        } else {
          throw new Error("stdout 中未找到 JSON 对象");
        }
      }
    } catch (parseErr) {
      // JSON 解析失败，记录但不立即判断为错误
      logWarning(`JSON 解析失败: ${parseErr.message}`);
      logInfo(`原始输出长度: ${result.stdout.length}，退出码: ${result.exitCode}`);
      if (result.stdout.length > 0) {
        const preview = result.stdout.substring(Math.max(0, result.stdout.length - 500));
        logInfo(`输出末尾500字符预览:\n${preview}`);
      }
    }

    // 如果 JSON 解析成功，完全基于 JSON 结果判断
    if (jsonParseSuccess && executionResult) {
      attempts = executionResult.attempts || 0;
      executions = executionResult.executions || [];
      
      // 调试信息：输出关键字段
      logInfo(`解析结果: success=${executionResult.success} (type: ${typeof executionResult.success}), finalStatus=${executionResult.finalStatus}`);
      
      // 推送 AI 回复消息到 TaskEcho（如果启用）
      if (taskecho.isEnabled() && task.id) {
        try {
          const projectInfo = await taskecho.getProjectInfo();
          const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, { prompts: prompts || [] });
          
          // 提取 AI 回复内容
          let aiMessage = "";
          
          // 方案1: 从 executionResult 中提取消息内容
          if (executionResult.message || executionResult.content) {
            aiMessage = executionResult.message || executionResult.content;
          } else if (executionResult.executions && executionResult.executions.length > 0) {
            // 从最后一次执行中提取输出
            const lastExecution = executionResult.executions[executionResult.executions.length - 1];
            if (lastExecution.output || lastExecution.stdout) {
              aiMessage = lastExecution.output || lastExecution.stdout;
            }
          }
          
          // 方案2: 如果无法从 JSON 中提取，使用 stdout（去除 JSON 部分）
          if (!aiMessage && result.stdout) {
            // 尝试提取非 JSON 部分的输出
            const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              // 提取 JSON 之前的内容作为 AI 回复
              const jsonIndex = result.stdout.indexOf(jsonMatch[0]);
              if (jsonIndex > 0) {
                aiMessage = result.stdout.substring(0, jsonIndex).trim();
              } else {
                // 如果 JSON 在开头，尝试提取 JSON 之后的内容
                const afterJson = result.stdout.substring(jsonIndex + jsonMatch[0].length).trim();
                if (afterJson) {
                  aiMessage = afterJson;
                }
              }
            } else {
              // 没有 JSON，直接使用 stdout
              aiMessage = result.stdout.trim();
            }
          }
          
          // 如果提取到了消息内容，推送消息
          if (aiMessage && aiMessage.length > 0) {
            await taskecho.addMessage(
              projectInfo.project_id,
              queueInfo.queue_id,
              task.id,
              "assistant",
              aiMessage
            );
            logInfo("AI 回复已推送到 TaskEcho");
          } else {
            logWarning("无法从执行结果中提取 AI 回复内容，跳过推送");
          }
        } catch (err) {
          logWarning(`TaskEcho AI 消息推送失败: ${err.message}`);
          // 不中断执行，继续处理任务结果
        }
      }
      
      // 简化判断逻辑：优先检查 success 字段，其次检查 finalStatus
      // 注意：success 可能是布尔值 true，finalStatus 可能是字符串 "done"
      const isSuccess = executionResult.success === true || executionResult.success === "true" || String(executionResult.success).toLowerCase() === "true";
      const isDone = executionResult.finalStatus === "done" || executionResult.finalStatus === "完成";
      
      if (isSuccess || isDone) {
        logTaskStatus(task.name, "success", "任务已完成");
        
        finalStatus = "成功";
        errorMessage = null;
        detailedError = null;
      } else if (executionResult.finalStatus === "partial" || executionResult.finalStatus === "部分完成") {
        logWarning(`达到重试上限(${globalConfig.retry}),标记为部分完成`);
        finalStatus = "部分完成";
        errorMessage = null;
      } else {
        // success !== true 且 finalStatus 不是 done/partial，视为失败
        logTaskStatus(task.name, "error", `任务执行失败 (success=${executionResult.success}, finalStatus=${executionResult.finalStatus})`);
        
        finalStatus = "失败";
        errorMessage = executionResult.errorMessage || "任务执行失败";
        detailedError = executionResult.errorMessage || "任务执行失败";
      }
    } else {
      // JSON 解析失败的情况
      logWarning(`JSON 解析失败或 executionResult 为空: jsonParseSuccess=${jsonParseSuccess}, executionResult=${executionResult ? "存在" : "null"}`);
      // JSON 解析失败，使用退出码和 stderr 判断
      if (result.exitCode !== 0) {
        logTaskStatus(task.name, "error", `cursor-agent-task 执行失败（退出码: ${result.exitCode}）`);
        const fullError = `运行时错误: 退出码 ${result.exitCode}\n${result.stderr || "无错误输出"}\n\n标准输出:\n${result.stdout}`;
        detailedError = fullError;
        errorMessage = extract_short_error_message(fullError);
        finalStatus = "失败";
      } else {
        // 退出码为 0 但 JSON 解析失败，可能是输出格式问题
        logTaskStatus(task.name, "error", "无法解析执行结果");
        const fullError = `JSON 解析失败: 无法从输出中提取有效的 JSON 结果\n\n标准输出:\n${result.stdout}\n\n错误输出:\n${result.stderr || "无"}`;
        detailedError = fullError;
        errorMessage = "无法解析执行结果";
        finalStatus = "失败";
      }
    }
    } catch (err) {
    logTaskStatus(task.name, "error", `任务执行失败: ${err.message}`);
    
    const fullError = err.stack || err.message;
    detailedError = fullError;
    errorMessage = extract_short_error_message(fullError);
    finalStatus = "失败";
  }

  const endedAt = new Date().toISOString();

  // 生成报告摘要
  const summary = {
    taskName: task.name,
    specFile: task.spec_file
      ? (Array.isArray(task.spec_file) ? task.spec_file.join(", ") : task.spec_file)
      : "无",
    startedAt,
    endedAt,
    attempts,
    finalStatus,
    model: globalConfig.model,
    timeoutMinutes: globalConfig.timeoutMinutes,
    retry: globalConfig.retry,
    executions,
  };

  // 生成报告(包含详细错误信息)
  const reportPath = await write_task_report(
    task,
    attempts,
    summary,
    finalStatus,
    globalConfig.reportDir,
    detailedError
  );
  const reportIcon = colorize(icons.report, "magenta");
  logSuccess(`报告已保存: ${reportIcon} ${colorize(reportPath, "cyan")}`);

  // 确定最终状态
  let resultStatus;
  if (finalStatus === "成功") {
    resultStatus = "done";
  } else if (finalStatus === "部分完成") {
    resultStatus = "done"; // 部分完成也视为 done，避免无限重试
  } else {
    resultStatus = "error";
  }

  return {
    status: resultStatus,
    error_message: errorMessage, // 简短错误信息(保存到 task.json)
    detailedError, // 详细错误信息(已保存到报告中)
    reportPath,
    attempts,
  };
}

/**
 * 执行所有任务
 * @param {Object} globalConfig - 全局配置
 * @returns {Promise<Object>} 执行统计
 */
async function run_all_tasks(globalConfig) {
  printHeader("流程控制脚本开始执行", icons.rocket);

  // 加载任务文件
  logInfo(`加载任务文件: ${colorize(globalConfig.taskFile, "cyan")}`);
  const taskFile = await load_task_file(globalConfig.taskFile);

  // 验证配置
  validate_config(taskFile);
  logSuccess(`配置验证通过，共 ${colorize(taskFile.tasks.length, "bright")} 个任务`);

  // 推送队列到 TaskEcho（如果启用）
  if (taskecho.isEnabled()) {
    try {
      logInfo(`TaskEcho 已启用，准备推送队列...`);
      const projectInfo = await taskecho.getProjectInfo();
      const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, taskFile);
      await taskecho.submitQueue(projectInfo, queueInfo, taskFile);
      logSuccess("队列已推送到 TaskEcho");
    } catch (err) {
      logWarning(`TaskEcho 推送失败: ${err.message}`);
      // 不中断执行，继续本地任务
    }
  } else {
    logInfo(`TaskEcho 未启用（TASKECHO_ENABLED=${process.env.TASKECHO_ENABLED || "未设置"}, TASKECHO_API_KEY=${process.env.TASKECHO_API_KEY ? "已设置" : "未设置"}）`);
  }

  // 确保报告目录存在
  await ensure_directories(globalConfig.reportDir);
  logInfo(`报告目录: ${colorize(globalConfig.reportDir, "cyan")}`);

  // 过滤 prompts,只保留存在的文件
  const validPrompts = taskFile.prompts.filter((p) => {
    const resolved = path.resolve(p);
    const exists = fs.existsSync(resolved);
    if (!exists) {
      logWarning(`提示词文件不存在,已跳过: ${colorize(p, "dim")}`);
    }
    return exists;
  });
  
  if (validPrompts.length > 0) {
    logSuccess(`加载了 ${colorize(validPrompts.length, "bright")} 个提示词文件`);
  }

  let completed = 0;
  let skipped = 0;
  let errored = 0;

  // 依次执行任务
  console.error("");
  for (const task of taskFile.tasks) {
    if (task.status === "done") {
      logTaskStatus(task.name, "done", "状态为 done,跳过");
      skipped++;
      continue;
    }

    if (task.status === "error") {
      logTaskStatus(task.name, "error", "状态为 error,跳过");
      if (task.error_message) {
        logError(`错误信息: ${task.error_message}`);
      }
      skipped++;
      continue;
    }

    if (task.status !== "pending") {
      logWarning(`未知状态 ${colorize(task.status, "yellow")},跳过`);
      skipped++;
      continue;
    }

    // 执行任务
    try {
      const result = await execute_task(task, globalConfig, validPrompts);

      // 更新任务状态(包括报告路径)
      const oldStatus = task.status;
      update_task_status(
        taskFile.tasks,
        task.name,
        result.status,
        result.error_message,
        result.reportPath
      );

      // 推送状态更新到 TaskEcho（如果启用）
      if (taskecho.isEnabled() && task.id) {
        if (oldStatus !== result.status) {
          try {
            logInfo(`推送任务状态更新到 TaskEcho: ${task.name} (${oldStatus || "unknown"} → ${result.status})`);
            const projectInfo = await taskecho.getProjectInfo();
            const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, taskFile);
            
            // 使用 updateStatus API 更新任务状态
            await taskecho.updateStatus(
              projectInfo.project_id,
              queueInfo.queue_id,
              task.id,
              result.status
            );
            
            logSuccess(`任务状态已推送到 TaskEcho: ${task.name}`);
          } catch (err) {
            logWarning(`TaskEcho 状态推送失败: ${err.message}`);
            if (err.stack) {
              logWarning(`错误堆栈: ${err.stack}`);
            }
          }
        } else {
          logInfo(`任务状态未变化，跳过推送: ${task.name} (${oldStatus} → ${result.status})`);
        }
      } else {
        if (!taskecho.isEnabled()) {
          logInfo(`TaskEcho 未启用，跳过状态推送: ${task.name}`);
        } else if (!task.id) {
          logWarning(`任务缺少 id 字段，跳过状态推送: ${task.name}`);
        }
      }

      // 保存任务文件
      await save_task_file(globalConfig.taskFile, taskFile);

      if (result.status === "error") {
        errored++;
      } else {
        completed++;
      }
    } catch (err) {
      logTaskStatus(task.name, "error", `执行异常: ${err.message}`);
      update_task_status(taskFile.tasks, task.name, "error", err.message);
      
      // 推送错误状态到 TaskEcho（如果启用）
      if (taskecho.isEnabled() && task.id) {
        try {
          const projectInfo = await taskecho.getProjectInfo();
          const queueInfo = taskecho.getQueueInfo(globalConfig.taskFile, taskFile);
          await taskecho.updateStatus(
            projectInfo.project_id,
            queueInfo.queue_id,
            task.id,
            "error"
          );
        } catch (taskechoErr) {
          logWarning(`TaskEcho 错误状态推送失败: ${taskechoErr.message}`);
        }
      }
      
      await save_task_file(globalConfig.taskFile, taskFile);
      errored++;
    }
  }

  console.error("");
  printSeparator("═");
  
  const completedText = colorize(completed, "green");
  const skippedText = colorize(skipped, "yellow");
  const erroredText = colorize(errored, "red");
  
  const summaryIcon = colorize(icons.sparkles, "cyan");
  const summaryTitle = colorize("执行完成", "bright");
  console.error(`  ${summaryIcon}  ${summaryTitle}`);
  printSeparator("═");
  logInfo(`完成: ${completedText}, 跳过: ${skippedText}, 错误: ${erroredText}`);
  console.error("");

  return { completed, skipped, errored };
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
  try {
    // 先解析参数，检查是否是 init 或 help 命令（这些命令不需要加载环境变量）
    const argv = process.argv.slice(2);
    const isInit = argv.includes("init");
    const isHelp = argv.includes("-h") || argv.includes("--help");
    
    // 如果不是 init 或 help 命令，先加载环境变量（reset 和 reset-error 需要环境变量来启用 TaskEcho）
    if (!isInit && !isHelp) {
      await load_cursor_env();
    }

    // 解析完整参数（此时环境变量已加载）
    const config = parse_args(argv);

    // 如果指定了帮助选项,显示帮助并退出
    if (config.help) {
      print_help();
      process.exit(0);
    }

    // 如果指定了 init 参数,执行初始化操作
    if (config.init) {
      await init_flow_directory();
      process.exit(0);
    }

    // 如果指定了 --reset 参数,执行重置操作
    if (config.reset) {
      await reset_tasks(config);
    } else if (config.resetError) {
      // 如果指定了 --reset-error 参数,执行重置 error 任务操作
      await reset_error_tasks(config);
    } else {
      // 否则执行任务
      await run_all_tasks(config);
    }

    process.exit(0);
  } catch (err) {
    printHeader("致命错误", icons.error);
    logError(err.message);
    console.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parse_args,
  load_cursor_env,
  load_task_file,
  validate_config,
  ensure_directories,
  build_agent_args,
  run_agent_once,
  is_runtime_error,
  write_task_report,
  update_task_status,
  save_task_file,
  init_flow_directory,
  reset_tasks,
  reset_error_tasks,
  execute_task,
  run_all_tasks,
};
