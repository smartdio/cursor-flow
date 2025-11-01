#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

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
 * 加载 .cursor.env 文件中的环境变量
 * @param {string} [cwd] - 工作目录（默认: process.cwd()）
 * @returns {Promise<void>}
 */
async function load_cursor_env(cwd = process.cwd()) {
  const envFilePath = path.join(cwd, ".cursor.env");
  
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
          logInfo(`从 .cursor.env 加载环境变量: ${colorize(key, "cyan")}`);
        } else {
          logInfo(`跳过已存在的环境变量: ${colorize(key, "dim")}`);
        }
      }
    }
  } catch (err) {
    // 加载失败时记录警告，但不中断程序执行
    logWarning(`加载 .cursor.env 文件失败: ${err.message}`);
  }
}

/**
 * 显示帮助信息
 */
function print_help() {
  const text = `用法:
  cursor-tasks [选项]

选项:
  -t, --task-file <path>    任务文件路径（默认: doc/task.json）
  -m, --model <model>       模型名称（默认: composer-1）
  --judge-model <model>     语义判定模型（必需，或设置 CURSOR_TASKS_JUDGE_MODEL 环境变量）
  --retry <num>             重试次数（默认: 3）
  --timeout <minutes>       超时时间（分钟，默认: 30）
  --reset                   重置所有任务状态为 pending
  -h, --help                显示帮助信息

环境变量:
  CURSOR_TASKS_JUDGE_MODEL  语义判定模型（如果未通过 --judge-model 提供）

示例:
  # 执行任务（指定判定模型）
  cursor-tasks -t doc/task.json -m composer-1 --judge-model gpt-4

  # 使用环境变量指定判定模型
  export CURSOR_TASKS_JUDGE_MODEL=gpt-4
  cursor-tasks -t doc/task.json -m composer-1

  # 重置任务状态
  cursor-tasks --task-file doc/task.json --reset

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
    taskFile: "doc/task.json",
    model: "composer-1",
    judgeModel: process.env.CURSOR_TASKS_JUDGE_MODEL || null, // 判定模型
    retry: 3,
    timeoutMinutes: 30,
    reportDir: "doc/tasks/report",
    reset: false, // 是否重置任务状态
    help: false, // 是否显示帮助
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "-t" || arg === "--task-file") && i + 1 < argv.length) {
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
    } else if (arg === "-h" || arg === "--help") {
      config.help = true;
    }
  }

  // 如果执行任务（非 reset 和 help），验证判定模型是否已指定
  if (!config.reset && !config.help && !config.judgeModel) {
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

  // 检查任务名称唯一性
  const names = new Set();
  for (const task of config.tasks) {
    if (!task.name) {
      throw new Error("任务缺少 name 字段");
    }
    if (names.has(task.name)) {
      throw new Error(`任务名称重复: ${task.name}`);
    }
    names.add(task.name);

    if (!task.spec_file) {
      throw new Error(`任务 ${task.name} 缺少 spec_file 字段`);
    }
    // spec_file 可以是字符串或字符串数组
    if (typeof task.spec_file !== "string" && !Array.isArray(task.spec_file)) {
      throw new Error(`任务 ${task.name} 的 spec_file 必须是字符串或字符串数组`);
    }
    if (Array.isArray(task.spec_file) && task.spec_file.length === 0) {
      throw new Error(`任务 ${task.name} 的 spec_file 数组不能为空`);
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
 * @returns {string[]} 参数数组
 */
function build_agent_args(model, prompts, specFiles) {
  const args = ["-m", model];

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

  // 添加 spec_file(s) - 支持单个文件或文件数组
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

/**
 * 查找 cursor-agent 命令路径
 * @returns {string} 命令名（默认: "cursor-agent"）
 */
function find_cursor_agent_command() {
  // 检查命令是否存在
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync("cursor-agent", ["--version"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (!result.error) {
      return "cursor-agent";
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 如果命令不存在，抛出错误
  throw new Error("cursor-agent 命令未找到，请确认已安装并在 PATH 中");
}

/**
 * 直接调用 cursor-agent（用于 resume 模式）
 * @param {string} model - 模型名称
 * @param {string} prompt - 提示词
 * @param {number} timeoutMinutes - 超时时间(分钟)
 * @returns {Promise<Object>} AgentRunResult
 */
function run_cursor_agent_directly(model, prompt, timeoutMinutes) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const command = find_cursor_agent_command();

    // 构建命令参数: cursor-agent resume --model <model> --print --output-format stream-json --force <prompt>
    const args = [
      "resume",                    // resume 命令
      "--model", model,
      "--print",
      "--output-format", "stream-json",
      "--force",
      prompt,                      // 提示词作为位置参数
    ];

    logInfo(`直接调用 cursor-agent: ${colorize(`cursor-agent ${args.join(" ")}`, "bright")}`);
    console.error(""); // 空行分隔

    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

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

// ============================================================================
// 4. Call-LLM 相关
// ============================================================================

/**
 * 查找 call-llm 脚本路径
 * @returns {string} 脚本路径或命令名
 */
function find_call_llm_script() {
  // 1. 尝试命令（如果已安装）
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync("call-llm", ["--help"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (!result.error) {
      return "call-llm";
    }
  } catch (e) {
    // 忽略错误
  }

  // 2. 使用本地文件路径
  const localPath = path.resolve(__dirname, "call-llm.js");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // 3. 通过 require.resolve 查找
  try {
    const resolved = require.resolve("@n8flow/cursor-flow/call-llm.js");
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
 * 执行一次 call-llm 调用
 * @param {string[]} args - call-llm 参数数组
 * @param {number} timeoutSeconds - 超时时间(秒)
 * @returns {Promise<Object>} { exitCode, stdout, stderr, durationMs }
 */
function run_call_llm_once(args, timeoutSeconds = 60) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const scriptPathOrCommand = find_call_llm_script();

    // 检查是否是文件路径且文件存在
    if (scriptPathOrCommand !== "call-llm" && !fs.existsSync(scriptPathOrCommand)) {
      reject(new Error(`call-llm 不存在: ${scriptPathOrCommand}`));
      return;
    }

    const isCommand = scriptPathOrCommand === "call-llm";
    logInfo(`执行 call-llm: ${colorize((isCommand ? "call-llm" : `node ${scriptPathOrCommand}`) + " " + args.join(" "), "dim")}`);

    const child = spawn(
      isCommand ? "call-llm" : "node",
      isCommand ? args : [scriptPathOrCommand, ...args],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutMs = timeoutSeconds * 1000;
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`call-llm 执行超时(超过 ${timeoutSeconds} 秒)`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * 解析 call-llm 返回的 JSON 结果
 * @param {string} stdout - call-llm 的标准输出
 * @returns {Object} { result: "done"|"resume"|"auto", reasons: string[] }
 */
function parse_llm_result(stdout) {
  try {
    const json = JSON.parse(stdout.trim());
    if (json.result === "done" || json.result === "resume" || json.result === "auto") {
      return {
        result: json.result,
        reasons: json.reasons || [json.result],
      };
    }
    throw new Error(`无效的结果值: ${json.result}`);
  } catch (err) {
    // 解析失败，返回默认值
    return {
      result: "resume",
      reasons: [`JSON解析失败: ${err.message}`],
    };
  }
}

// ============================================================================
// 5. 语义判定相关
// ============================================================================

/**
 * 生成语义判定提示（用于 call-llm）
 * @returns {string} 判定提示
 */
function build_semantic_prompt() {
  return `请分析评估以上内容的含义。如果内容的意思是已经完成所有任务工作，那么返回"done"；如果内容的意思是已经完成了部分工作任务，还有工作任务需要继续，那么返回"resume"；如果内容的包含建议部分，例如提出多个后续方案，或者建议可选择继续执行一些非必要的任务，那么就返回"auto"。返回的内容以JSON格式返回，例如: {"result":"done"}。`;
}

/**
 * 通过 call-llm 进行语义判定
 * @param {string} judgeModel - 用于判定的 LLM 模型
 * @param {string} executionSummary - cursor-agent 执行后的总结内容
 * @returns {Promise<Object>} SemanticsResult { result: "done"|"resume"|"auto", reasons: string[] }
 */
async function interpret_semantics_via_llm(judgeModel, executionSummary) {
  try {
    const judgePrompt = build_semantic_prompt();

    // 构建 call-llm 参数
    const args = [
      "-m", judgeModel,
      "-f", "json",
      "-c", executionSummary.substring(0, 5000), // 限制长度
      "-p", judgePrompt,
    ];

    logInfo(`[语义判定] 使用模型: ${colorize(judgeModel, "cyan")}`);
    
    const result = await run_call_llm_once(args, 60); // 60秒超时

    if (result.exitCode !== 0 || result.stderr) {
      logWarning(`[语义判定] call-llm 返回非零退出码或错误输出`);
      return {
        result: "resume",
        reasons: ["语义判定调用失败，默认需要继续执行"],
      };
    }

    const parsed = parse_llm_result(result.stdout);
    logInfo(`[语义判定] 结果: ${colorize(parsed.result, parsed.result === "done" ? "green" : "yellow")}`);
    
    return parsed;
  } catch (err) {
    logError(`语义判定调用失败: ${err.message}`);
    return {
      result: "resume",
      reasons: [`判定调用失败: ${err.message}`],
    };
  }
}

// ============================================================================
// 5. 报告生成
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

  // 格式化 spec_file 显示（支持单个文件或文件数组）
  const specFileDisplay = Array.isArray(task.spec_file)
    ? task.spec_file.join(", ")
    : task.spec_file;

  const reportContent = `# 任务执行报告

## 任务基本信息

- **任务名称**: ${task.name}
- **任务描述**: ${task.description}
- **规格文件**: ${specFileDisplay}
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
// 7. 任务重置功能
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

  console.error("");
  printSeparator();
  logSuccess(`重置完成: 共重置 ${colorize(resetCount, "bright")} 个任务`);
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
  if (prompts && prompts.length > 0) {
    logInfo(`接收到的 prompts: ${colorize(prompts.length, "cyan")} 个文件`);
  }

  const startedAt = new Date().toISOString();
  const executions = [];
  let attempts = 0;
  let finalStatus = "成功";
  let errorMessage = null; // 简短错误信息(用于 task.json)
  let detailedError = null; // 详细错误信息(用于报告)

  try {
    // 检查 spec_file(s) 是否存在（支持单个文件或文件数组）
    const specFileArray = Array.isArray(task.spec_file) ? task.spec_file : [task.spec_file];
    for (const specFile of specFileArray) {
      const specPath = path.resolve(specFile);
      if (!fs.existsSync(specPath)) {
        throw new Error(`spec_file 不存在: ${specFile}`);
      }
    }

    // 检查 cursor-agent-task 是否可用
    const agentScriptOrCommand = find_agent_script();
    if (agentScriptOrCommand !== "cursor-agent-task" && !fs.existsSync(agentScriptOrCommand)) {
      throw new Error(`cursor-agent-task 不存在: ${agentScriptOrCommand}`);
    }

    let needsContinue = true;
    let lastResult = null;
    let lastSemanticsResult = null;

    // 首次执行使用 cursor-agent-task
    let agentArgs = build_agent_args(
      globalConfig.model,
      prompts,
      task.spec_file
    );

    // 主循环: 执行 -> 判定 -> 继续或完成
    while (needsContinue && attempts < globalConfig.retry) {
      attempts++;

      logTaskStatus(task.name, "pending", `第 ${colorize(attempts, "cyan")} 次执行开始`);

      try {
        let result;
        
        // 根据是否是首次执行选择调用方式
        if (attempts === 1) {
          // 首次执行：使用 cursor-agent-task
          result = await run_agent_once(agentArgs, globalConfig.timeoutMinutes);
        } else {
          // 后续执行：使用 cursor-agent resume（直接调用）
          const resumePrompt = lastSemanticsResult?.result === "auto"
            ? "按你的建议执行"
            : "请继续";
          
          logInfo(`使用 resume 模式: ${colorize(resumePrompt, "cyan")}`);
          result = await run_cursor_agent_directly(
            globalConfig.model,
            resumePrompt,
            globalConfig.timeoutMinutes
          );
        }

        lastResult = result;

        // 检查运行时错误
        if (is_runtime_error(result.exitCode, result.stderr)) {
          logTaskStatus(task.name, "error", "检测到运行时错误");
          const fullError = `运行时错误: 退出码 ${result.exitCode}\n${result.stderr || "无错误输出"}\n\n标准输出:\n${result.stdout}`;
          detailedError = fullError;
          errorMessage = extract_short_error_message(fullError);
          finalStatus = "失败";
          executions.push({
            index: attempts,
            durationMs: result.durationMs,
            conclusion: "运行时错误",
            notes: [
              fullError.substring(0, 500) +
                (fullError.length > 500 ? "..." : ""),
            ],
          });
          break;
        }

        // 进行语义判定（使用 call-llm）
        logInfo(`进行语义判定 ${colorize(icons.target, "yellow")}`);
        const executionSummary = result.stdout.substring(0, 5000);
        const semanticsResult = await interpret_semantics_via_llm(
          globalConfig.judgeModel,
          executionSummary
        );
        
        lastSemanticsResult = semanticsResult; // 保存用于下次判断

        // 记录本次执行
        executions.push({
          index: attempts,
          durationMs: result.durationMs,
          conclusion: semanticsResult.result === "done" ? "已完成" : 
                      semanticsResult.result === "auto" ? "建议继续" : "需要继续",
          notes: [
            `判定结果: ${semanticsResult.result}`,
            ...semanticsResult.reasons,
            result.stdout.substring(0, 200) + "...",
          ],
        });

        // 根据结果处理
        if (semanticsResult.result === "done") {
          logTaskStatus(task.name, "success", "任务已完成");
          finalStatus = "成功";
          needsContinue = false;
          break; // 退出循环，继续下一个任务
        } else {
          // resume 或 auto：标记需要继续，下次循环使用 resume 模式
          needsContinue = true;
          logTaskStatus(task.name, "pending", `需要继续执行 (${semanticsResult.result})`);
          // 继续循环，下次使用 resume 模式
        }
      } catch (err) {
        logTaskStatus(task.name, "error", `执行出错: ${err.message}`);
        const fullError = err.stack || err.message;
        detailedError = fullError;
        errorMessage = extract_short_error_message(fullError);
        finalStatus = "失败";
        executions.push({
          index: attempts,
          durationMs: 0,
          conclusion: "执行出错",
          notes: [
            fullError.substring(0, 500) + (fullError.length > 500 ? "..." : ""),
          ],
        });
        break;
      }
    }

    // 如果达到重试上限仍未完成
    if (needsContinue && attempts >= globalConfig.retry) {
      logWarning(`达到重试上限(${globalConfig.retry}),标记为部分完成`);
      finalStatus = "部分完成";
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
    specFile: Array.isArray(task.spec_file) ? task.spec_file.join(", ") : task.spec_file,
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

  return {
    status: errorMessage ? "error" : "done",
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
      update_task_status(
        taskFile.tasks,
        task.name,
        result.status,
        result.error_message,
        result.reportPath
      );

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
    // 首先加载 .cursor.env 文件中的环境变量
    await load_cursor_env();

    const config = parse_args(process.argv.slice(2));

    // 如果指定了帮助选项,显示帮助并退出
    if (config.help) {
      print_help();
      process.exit(0);
    }

    // 如果指定了 --reset 参数,执行重置操作
    if (config.reset) {
      await reset_tasks(config);
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
  find_cursor_agent_command,
  run_cursor_agent_directly,
  find_call_llm_script,
  run_call_llm_once,
  parse_llm_result,
  build_semantic_prompt,
  interpret_semantics_via_llm,
  write_task_report,
  update_task_status,
  save_task_file,
  reset_tasks,
  execute_task,
  run_all_tasks,
};
