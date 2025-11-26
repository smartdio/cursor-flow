#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");
const taskecho = require("./taskecho-client");

// 注意: 已移除浏览器关闭相关功能

// ============================================================================
// 颜色和格式化工具
// ============================================================================

/**
 * 检测终端是否支持颜色和 Unicode
 */
function detectTerminalCapabilities() {
  const isTTY = process.stderr.isTTY;
  const forceColor = process.env.FORCE_COLOR;
  const noColor = process.env.NO_COLOR;
  const term = process.env.TERM || "";
  
  // 检测颜色支持
  const supportsColor = isTTY && 
    (forceColor === "1" || forceColor === "true" || forceColor === "2" || forceColor === "3") ||
    (forceColor !== "0" && noColor !== "1" && term !== "dumb");
  
  // 检测 Unicode 支持（简单检测）
  const supportsUnicode = isTTY && term !== "dumb" && 
    !process.env.CI && // CI 环境可能不支持
    (process.platform !== "win32" || process.env.WT_SESSION); // Windows Terminal 支持
  
  return { supportsColor, supportsUnicode, isTTY };
}

const TERMINAL = detectTerminalCapabilities();

// Agent 输出框的宽度（在整个输出过程中保持一致）
let agentOutputBoxWidth = null;

/**
 * 获取终端宽度
 * @returns {number} 终端宽度（列数），如果无法获取则返回默认值
 */
function getTerminalWidth() {
  // 优先使用 stderr 的列数（因为我们的输出都到 stderr）
  if (process.stderr.isTTY && process.stderr.columns) {
    return process.stderr.columns;
  }
  // 其次使用 stdout 的列数
  if (process.stdout.isTTY && process.stdout.columns) {
    return process.stdout.columns;
  }
  // 使用环境变量 COLUMNS
  if (process.env.COLUMNS) {
    const cols = parseInt(process.env.COLUMNS, 10);
    if (!isNaN(cols) && cols > 0) {
      return cols;
    }
  }
  // 默认宽度
  return 80;
}

/**
 * 计算合适的输出宽度
 * @param {number} minWidth - 最小宽度（默认：60）
 * @param {number} contentLength - 内容长度（可选）
 * @param {number} padding - 额外边距（默认：4）
 * @returns {number} 计算后的宽度
 */
function calculateOutputWidth(minWidth = 60, contentLength = 0, padding = 4) {
  const terminalWidth = getTerminalWidth();
  // 最大宽度：终端宽度 - 2（留出边距）
  const maxWidth = Math.max(minWidth, terminalWidth - 2);
  // 如果内容长度 + padding 小于最小宽度，使用最小宽度
  // 如果内容长度 + padding 大于最大宽度，使用最大宽度
  // 否则使用内容长度 + padding
  const calculatedWidth = Math.max(minWidth, Math.min(maxWidth, contentLength + padding));
  return calculatedWidth;
}

/**
 * 获取或计算 Agent 输出框的宽度
 * @param {string} title - 标题（可选，用于计算初始宽度）
 * @returns {number} Agent 输出框宽度
 */
function getAgentOutputBoxWidth(title = null) {
  // 如果已经设置过宽度，直接返回（保持一致性）
  if (agentOutputBoxWidth !== null) {
    return agentOutputBoxWidth;
  }
  
  // 计算初始宽度
  const terminalWidth = getTerminalWidth();
  const minWidth = 60;
  const maxWidth = Math.max(minWidth, terminalWidth - 2);
  
  if (title) {
    const contentLength = title.length;
    agentOutputBoxWidth = calculateOutputWidth(minWidth, contentLength, 4);
  } else {
    // 如果没有标题，使用终端宽度的 90%（但至少 60，最多不超过终端宽度-2）
    agentOutputBoxWidth = Math.max(minWidth, Math.min(maxWidth, Math.floor(terminalWidth * 0.9)));
  }
  
  return agentOutputBoxWidth;
}

/**
 * ANSI 颜色代码
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  
  // 前景色
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  
  // 背景色
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  bgGray: "\x1b[100m",
};

/**
 * 应用颜色（如果不支持颜色则返回原文本）
 */
function colorize(text, ...colorCodes) {
  if (!TERMINAL.supportsColor) {
    return text;
  }
  return colorCodes.join("") + text + colors.reset;
}

/**
 * Unicode 字符（如果不支持则使用 ASCII 替代）
 */
const symbols = {
  // 成功/完成
  check: TERMINAL.supportsUnicode ? "✓" : "[OK]",
  checkCircle: TERMINAL.supportsUnicode ? "●" : "*",
  
  // 错误/失败
  cross: TERMINAL.supportsUnicode ? "✗" : "[X]",
  
  // 警告
  warning: TERMINAL.supportsUnicode ? "⚠" : "[!]",
  
  // 信息
  info: TERMINAL.supportsUnicode ? "ℹ" : "[i]",
  
  // 步骤/进行中
  arrowRight: TERMINAL.supportsUnicode ? "▶" : ">",
  arrowRightSmall: TERMINAL.supportsUnicode ? "▸" : "->",
  arrow: TERMINAL.supportsUnicode ? "→" : "->",
  
  // Agent 输出标签
  userLabel: TERMINAL.supportsUnicode ? "📝" : "[用户]",
  agentLabel: TERMINAL.supportsUnicode ? "🤖" : "[Agent]",
  
  // 边框字符
  box: {
    topLeft: TERMINAL.supportsUnicode ? "┌" : "+",
    topRight: TERMINAL.supportsUnicode ? "┐" : "+",
    bottomLeft: TERMINAL.supportsUnicode ? "└" : "+",
    bottomRight: TERMINAL.supportsUnicode ? "┘" : "+",
    horizontal: TERMINAL.supportsUnicode ? "─" : "-",
    vertical: TERMINAL.supportsUnicode ? "│" : "|",
    topT: TERMINAL.supportsUnicode ? "┬" : "+",
    bottomT: TERMINAL.supportsUnicode ? "┴" : "+",
    leftT: TERMINAL.supportsUnicode ? "├" : "+",
    rightT: TERMINAL.supportsUnicode ? "┤" : "+",
    cross: TERMINAL.supportsUnicode ? "┼" : "+",
  },
  
  // Agent 输出边框（双线）
  agentBox: {
    topLeft: TERMINAL.supportsUnicode ? "╔" : "+",
    topRight: TERMINAL.supportsUnicode ? "╗" : "+",
    bottomLeft: TERMINAL.supportsUnicode ? "╚" : "+",
    bottomRight: TERMINAL.supportsUnicode ? "╝" : "+",
    horizontal: TERMINAL.supportsUnicode ? "═" : "=",
    vertical: TERMINAL.supportsUnicode ? "║" : "|",
    topT: TERMINAL.supportsUnicode ? "╦" : "+",
    bottomT: TERMINAL.supportsUnicode ? "╩" : "+",
    leftT: TERMINAL.supportsUnicode ? "╠" : "+",
    rightT: TERMINAL.supportsUnicode ? "╣" : "+",
  },
};

/**
 * 绘制水平线
 */
function drawHorizontalLine(length, char = symbols.box.horizontal) {
  return char.repeat(Math.max(1, length));
}

/**
 * 绘制带文本的框线
 */
function drawBoxLine(text, width, leftChar = symbols.box.vertical, rightChar = symbols.box.vertical) {
  const textLen = text.length;
  const padding = Math.max(0, width - textLen - 2);
  return leftChar + " " + text + " ".repeat(padding) + " " + rightChar;
}

/**
 * 绘制 Agent 输出框线
 */
function drawAgentBoxLine(text, width) {
  const textLen = text.length;
  const padding = Math.max(0, width - textLen - 2);
  return symbols.agentBox.vertical + " " + text + " ".repeat(padding) + " " + symbols.agentBox.vertical;
}

/**
 * 计算字符串的实际显示长度（去除 ANSI 颜色代码）
 * @param {string} str - 可能包含 ANSI 代码的字符串
 * @returns {number} 实际显示长度
 */
function getDisplayLength(str) {
  // 移除 ANSI 转义序列（\x1b[...m 格式）
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  return str.replace(ansiRegex, "").length;
}

/**
 * 将文本按最大宽度换行（考虑边框前缀）
 * @param {string} text - 要换行的文本
 * @param {number} maxWidth - 最大宽度（包括边框前缀）
 * @param {number} prefixLength - 前缀长度（包括边框和标签，实际显示长度）
 * @returns {string[]} 换行后的文本数组
 */
function wrapTextForAgentOutput(text, maxWidth, prefixLength) {
  const contentWidth = maxWidth - prefixLength;
  if (contentWidth <= 0) {
    return [text];
  }
  
  const lines = [];
  const words = text.split(/(\s+)/);
  let currentLine = "";
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + word;
    
    // 如果当前行加上新词超过宽度，或者遇到换行符
    if (testLine.length > contentWidth || word.includes("\n")) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      
      // 处理换行符
      if (word.includes("\n")) {
        const parts = word.split(/\n/);
        for (let j = 0; j < parts.length - 1; j++) {
          if (parts[j]) {
            lines.push(parts[j]);
          }
        }
        currentLine = parts[parts.length - 1];
      } else if (word.length > contentWidth) {
        // 单词本身超过宽度，强制分割
        let remaining = word;
        while (remaining.length > contentWidth) {
          lines.push(remaining.substring(0, contentWidth));
          remaining = remaining.substring(contentWidth);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.length > 0 ? lines : [text];
}

// ============================================================================
// 语义判定提示词配置（用于判断任务是否完成）
// ============================================================================
// 此提示词用于 call-llm 进行语义判定，判断 cursor-agent 的执行结果
// 返回结果说明：
// - "done": 已完成所有任务工作
// - "resume": 已完成部分工作，还有任务需要继续
// - "auto": 包含建议部分，或提出多个后续方案/可选任务
const SEMANTIC_JUDGE_PROMPT = `

------------------------------------------------------
请分析评估以上内容的含义。如果内容的意思是已经完成所有任务工作，那么返回"done"；
如果内容的意思是已经完成了部分工作任务，还有工作任务需要继续，那么返回"resume"；
如果内容的包含建议部分，例如提出多个后续方案，或者建议可选择继续执行一些非必要的任务，那么就返回"auto"。
要仔细分辨建议部分的内容。如果总结已经说明任务已经完成,只是建议任务外的其他工作。也判定为:已经完成任务。返回"done"。
------------------------------------------------------
返回的内容以JSON格式返回，例如: 
\`\`\`json
{"result":"done"}。
\`\`\`
`;

// ============================================================================
// 日志输出函数系统（输出到 stderr，避免影响 stdout）
// ============================================================================

// 日志级别控制（可通过环境变量 LOG_LEVEL 设置）
const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  verbose: 4,
  debug: 5,
};

const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "info"] || LOG_LEVELS.info;

/**
 * 基础日志函数（保留用于向后兼容）
 */
function log(message, ...args) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.info) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;
  console.error(prefix, message, ...args);
  }
}

/**
 * 标题/分隔符
 */
function logTitle(title, subtitle = null) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  
  const contentLength = Math.max(title.length, subtitle ? subtitle.length : 0);
  const width = calculateOutputWidth(60, contentLength, 4);
  console.error("");
  console.error(
    colorize(
      symbols.box.topLeft + drawHorizontalLine(width - 2, symbols.box.horizontal) + symbols.box.topRight,
      colors.cyan
    )
  );
  console.error(colorize(drawBoxLine(title, width), colors.cyan, colors.bold));
  if (subtitle) {
    console.error(colorize(drawBoxLine(subtitle, width), colors.cyan));
  }
  console.error(
    colorize(
      symbols.box.bottomLeft + drawHorizontalLine(width - 2, symbols.box.horizontal) + symbols.box.bottomRight,
      colors.cyan
    )
  );
  console.error("");
}

/**
 * 成功信息
 */
function logSuccess(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = colorize(symbols.check + " ", colors.green, colors.bold);
  console.error(prefix + colorize(message, colors.green), ...args);
}

/**
 * 错误信息
 */
function logError(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.error) return;
  const prefix = colorize(symbols.cross + " ", colors.red, colors.bold);
  console.error(prefix + colorize(message, colors.red), ...args);
}

/**
 * 警告信息
 */
function logWarning(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.warn) return;
  const prefix = colorize(symbols.warning + " ", colors.yellow, colors.bold);
  console.error(prefix + colorize(message, colors.yellow), ...args);
}

/**
 * 信息（普通）
 */
function logInfo(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = colorize(symbols.info + " ", colors.blue);
  console.error(prefix + message, ...args);
}

/**
 * 步骤信息
 */
function logStep(step, message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = colorize(symbols.arrowRight + " ", colors.cyan, colors.bold) + 
                 colorize(`[步骤 ${step}] `, colors.cyan);
  console.error(prefix + message, ...args);
}

/**
 * 子步骤信息
 */
function logSubStep(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = "  " + colorize(symbols.arrowRightSmall + " ", colors.cyan);
  console.error(prefix + message, ...args);
}

/**
 * 详细信息（verbose）
 */
function logDetail(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.verbose) return;
  const prefix = "  " + colorize("▸ ", colors.gray);
  console.error(prefix + colorize(message, colors.gray), ...args);
}

/**
 * 调试信息
 */
function logDebug(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.debug) return;
  const prefix = colorize("[DEBUG] ", colors.gray, colors.dim);
  console.error(prefix + colorize(message, colors.gray, colors.dim), ...args);
}

/**
 * 重要状态
 */
function logStatus(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = colorize(symbols.checkCircle + " ", colors.cyan, colors.bold);
  console.error(prefix + colorize(message, colors.cyan, colors.bold), ...args);
}

/**
 * 流程/跳转
 */
function logFlow(message, ...args) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  const prefix = colorize(symbols.arrow + " ", colors.cyan);
  console.error(prefix + message, ...args);
}

/**
 * Cursor Agent 输出开始标记
 */
function logAgentOutputStart(isResume = false) {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  
  const title = isResume ? "Cursor Agent 输出 (Resume)" : "Cursor Agent 输出";
  const width = getAgentOutputBoxWidth(title);
  
  console.error("");
  console.error(
    colorize(
      symbols.agentBox.topLeft + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.topRight,
      colors.blue
    )
  );
  console.error(
    colorize(
      drawAgentBoxLine(title, width),
      colors.blue,
      colors.bold
    )
  );
  console.error(
    colorize(
      symbols.agentBox.leftT + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.rightT,
      colors.blue
    )
  );
}

/**
 * Cursor Agent 输出结束标记
 */
function logAgentOutputEnd() {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.info) return;
  
  const width = getAgentOutputBoxWidth(); // 使用与开始标记相同的宽度
  console.error(
    colorize(
      symbols.agentBox.bottomLeft + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.bottomRight,
      colors.blue
    )
  );
  console.error("");
  
  // 重置宽度，以便下次输出时重新计算
  agentOutputBoxWidth = null;
}

/**
 * Cursor Agent 错误输出开始标记
 */
function logAgentErrorStart() {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.error) return;
  
  const title = "Cursor Agent 错误输出";
  const width = getAgentOutputBoxWidth(title);
  
  console.error("");
  console.error(
    colorize(
      symbols.agentBox.topLeft + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.topRight,
      colors.red
    )
  );
  console.error(
    colorize(
      drawAgentBoxLine(title, width),
      colors.red,
      colors.bold
    )
  );
  console.error(
    colorize(
      symbols.agentBox.leftT + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.rightT,
      colors.red
    )
  );
}

/**
 * Cursor Agent 错误输出结束标记
 */
function logAgentErrorEnd() {
  if (CURRENT_LOG_LEVEL < LOG_LEVELS.error) return;
  
  const width = getAgentOutputBoxWidth(); // 使用与开始标记相同的宽度
  console.error(
    colorize(
      symbols.agentBox.bottomLeft + 
      drawHorizontalLine(width - 2, symbols.agentBox.horizontal) + 
      symbols.agentBox.bottomRight,
      colors.red
    )
  );
  console.error("");
  
  // 重置宽度，以便下次输出时重新计算
  agentOutputBoxWidth = null;
}

// 注意: 已移除 closeMCPBrowser 函数
// 作为通用脚本，不应该管理浏览器的生命周期

/**
 * 从 .flow/.env 文件加载环境变量
 * 支持的变量：
 * - OPENAI_API_KEY
 * - OPENAI_API_BASE
 * - CURSOR_TASKS_JUDGE_MODEL
 */
function loadEnvFile() {
  const envFilePath = path.resolve(process.cwd(), ".flow", ".env");
  
  if (!fs.existsSync(envFilePath)) {
    logDetail(`环境变量文件不存在: ${envFilePath}`);
    return;
  }

  logStep(0, "加载环境变量");
  logSubStep(`从文件加载: ${envFilePath}`);
  
  try {
    const content = fs.readFileSync(envFilePath, "utf8");
    const lines = content.split(/\r?\n/);
    let loadedCount = 0;

    for (const line of lines) {
      // 跳过空行和注释
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // 解析 KEY=VALUE 格式
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let value = match[2];

        // 移除引号（支持单引号和双引号）
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        // 只加载指定的环境变量
        if (
          key === "OPENAI_API_KEY" ||
          key === "OPENAI_API_BASE" ||
          key === "CURSOR_TASKS_JUDGE_MODEL"
        ) {
          // 优先使用文件中的值（覆盖系统环境变量）
          process.env[key] = value;
          loadedCount++;
          logDetail(`已加载: ${key} = ${value.substring(0, 20)}${value.length > 20 ? "..." : ""}`);
        }
      }
    }

    if (loadedCount > 0) {
      logSuccess(`环境变量加载完成，共加载 ${loadedCount} 个变量`);
    } else {
      logDetail("未加载任何环境变量");
    }
  } catch (err) {
    logWarning(`读取环境变量文件失败: ${err.message}`);
  }
}

function printUsage() {
  const text = `用法:
  cursor-agent-task.js [-s "系统提示词"] [-p "提示词"] [-f 提示词文件(可多次)] [选项] [-- 其他参数]

参数:
  -s, --system        系统提示词（可选）
  -p, --prompt        普通提示词（可选，可与 -f 同时使用）
  -f, --file          从文件读取提示词（可多次；可与 -p 同时使用；传 - 表示从 stdin 读取）
  -m, --model         指定 cursor-agent 模型名称（默认: auto）
  --judge-model <model>  语义判定模型（用于判断任务是否完成）
                        可通过环境变量 CURSOR_TASKS_JUDGE_MODEL 设置
  --retry <num>       最大重试次数（默认: 3）
  --timeout <minutes> 每次执行的超时时间，分钟（默认: 60）
  --echo-url <url>    TaskEcho API URL（可选，用于推送消息）
  --echo-api-key <key> TaskEcho API Key（可选，用于推送消息）
  --echo-task-id <id> TaskEcho 任务 ID（可选，用于推送消息）
  --echo-task-file <file> TaskEcho 任务文件路径（可选，用于推送消息）
  -h, --help          显示帮助

环境变量:
  脚本会优先从 .flow/.env 文件加载以下环境变量：
  - OPENAI_API_KEY
  - OPENAI_API_BASE
  - CURSOR_TASKS_JUDGE_MODEL（用于语义判定模型，可通过 --judge-model 覆盖）

说明:
  - 若提供系统提示词，则按 "系统提示词 + 两个换行 + 普通提示词" 合并；若未提供，则仅使用普通提示词。
  - 多个 --file 时，按传入顺序拼接内容，文件之间以两个换行分隔。
  - 若同时提供 -p 和 -f，合并顺序为：先合并所有 -f 文件内容，最后追加 -p 内容（之间用两个换行分隔）。
  - 脚本会持续执行任务直到完成：
      - 首次执行：调用 cursor-agent 执行任务
      - 判断是否需要继续：使用 call-llm 进行语义判定
      - 如果需要继续：调用 cursor-agent resume 继续执行
      - 循环执行直到任务完成或达到重试上限
  - 可在 "--" 之后追加要透传给 cursor-agent 的其他参数。
  - 执行结果以 JSON 格式输出到 stdout，日志输出到 stderr。

示例:
  # 使用 .flow 目录下的提示词文件
  cursor-agent-task -f .flow/prompts/system-prompt.md -f .flow/spec/task.md --judge-model gpt-4
  
  # 使用系统提示词和规格文件
  cursor-agent-task -s "你是一个专业的开发者" -f .flow/spec/task.md --judge-model gpt-4
  
  # 使用直接提示词
  cursor-agent-task -p "请帮我实现一个功能" --judge-model gpt-4`;
  console.log(text);
}

function parseArgs(argv) {
  const state = {
    prompt: "",
    promptFiles: [],
    systemPrompt: "",
    model: "auto",
    judgeModel: null, // 语义判定模型（必需）
    retry: 3, // 最大重试次数
    timeoutMinutes: 60, // 每次执行的超时时间（分钟），默认1小时
    echoUrl: null, // TaskEcho API URL（可选）
    echoApiKey: null, // TaskEcho API Key（可选）
    echoTaskId: null, // TaskEcho 任务 ID（可选）
    echoTaskFile: null, // TaskEcho 任务文件路径（可选）
    help: false,
    positional: [],
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "-p" || a === "--prompt") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --prompt 需要一个参数");
      }
      state.prompt = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "-f" || a === "--file") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --file 需要一个参数");
      }
      state.promptFiles.push(argv[i + 1]);
      i += 2;
      continue;
    }
    if (a === "-s" || a === "--system") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --system 需要一个参数");
      }
      state.systemPrompt = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "-m" || a === "--model") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --model 需要一个参数");
      }
      state.model = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--judge-model") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --judge-model 需要一个参数");
      }
      state.judgeModel = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--retry") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --retry 需要一个参数");
      }
      state.retry = parseInt(argv[i + 1], 10);
      if (isNaN(state.retry) || state.retry < 1) {
        die(2, "错误: --retry 必须是一个正整数");
      }
      i += 2;
      continue;
    }
    if (a === "--timeout") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --timeout 需要一个参数");
      }
      state.timeoutMinutes = parseInt(argv[i + 1], 10);
      if (isNaN(state.timeoutMinutes) || state.timeoutMinutes < 1) {
        die(2, "错误: --timeout 必须是一个正整数");
      }
      i += 2;
      continue;
    }
    if (a === "--echo-url") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --echo-url 需要一个参数");
      }
      state.echoUrl = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--echo-api-key") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --echo-api-key 需要一个参数");
      }
      state.echoApiKey = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--echo-task-id") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --echo-task-id 需要一个参数");
      }
      state.echoTaskId = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--echo-task-file") {
      if (i + 1 >= argv.length) {
        die(2, "错误: --echo-task-file 需要一个参数");
      }
      state.echoTaskFile = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "-h" || a === "--help") {
      state.help = true;
      i += 1;
      continue;
    }
    if (a === "--") {
      state.positional = state.positional.concat(argv.slice(i + 1));
      break;
    }
    state.positional.push(a);
    i += 1;
  }
  return state;
}

function die(code, message) {
  if (message) {
    console.error(message);
  }
      process.exit(code);
}

async function readAll(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => (data += chunk));
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

async function buildUserPrompt(prompt, promptFiles) {
  let out = "";
  let hasContent = false;

  // 第一步：处理所有文件（-f 参数）
  if (promptFiles.length > 0) {
    logStep(2, `读取提示词文件 (${promptFiles.length} 个)`);
    let stdinUsed = false;
    let first = true;
    for (let i = 0; i < promptFiles.length; i++) {
      const f = promptFiles[i];
      let content = "";
      if (f === "-") {
        if (stdinUsed) {
          logError("标准输入 (-) 只能使用一次");
          die(2, "错误: 标准输入 (-) 只能使用一次");
        }
        logSubStep(`文件 ${i + 1}/${promptFiles.length}: 从标准输入读取`);
        stdinUsed = true;
        content = await readAll(process.stdin);
        logDetail(`读取完成，长度: ${content.length} 字符`);
      } else {
        if (!fs.existsSync(f)) {
          logError(`文件不存在: ${f}`);
          die(2, `错误: 文件不存在: ${f}`);
        }
        logSubStep(`文件 ${i + 1}/${promptFiles.length}: ${f}`);
        content = await fsp.readFile(f, "utf8");
        logDetail(`读取完成，长度: ${content.length} 字符`);
      }
      if (first) {
        out += content;
        first = false;
      } else {
        out += "\n\n" + content;
      }
      hasContent = true;
    }
    logSuccess(`所有文件读取完成`);
  }

  // 第二步：追加 prompt（-p 参数）
  if (prompt) {
    if (hasContent) {
      out += "\n\n" + prompt;
      logSubStep(`已追加直接提示词`);
    } else {
      out = prompt;
      logSubStep(`使用直接提示词`);
    }
    logDetail(`合并后总长度: ${out.length} 字符`);
  } else if (hasContent) {
    logDetail(`合并后总长度: ${out.length} 字符`);
  }

  return out;
}

function ensureCursorAgentInstalled() {
  logDetail("检查 cursor-agent 是否已安装");
  try {
    const r = spawnSync("cursor-agent", ["--help"], { encoding: "utf8" });
    if (r.error && r.error.code === "ENOENT") {
      logError("未找到 cursor-agent 命令，请确认已安装并在 PATH 中");
      die(127, "错误: 未找到 cursor-agent 命令，请确认已安装并在 PATH 中");
    }
    logDetail("cursor-agent 检测成功");
    return (r.stdout || "") + (r.stderr || "");
  } catch (e) {
    logError("未找到 cursor-agent 命令，请确认已安装并在 PATH 中");
    die(127, "错误: 未找到 cursor-agent 命令，请确认已安装并在 PATH 中");
  }
}

function hasStreamFlag(helpText) {
  return helpText.includes("--stream-partial-output");
}

// ============================================================================
// Call-LLM 相关（用于语义判定）
// ============================================================================

/**
 * 查找 call-llm 脚本路径
 * @returns {string} 脚本路径或命令名
 */
function findCallLLMScript() {
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
function runCallLLMOnce(args, timeoutSeconds = 60) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const scriptPathOrCommand = findCallLLMScript();

    // 检查是否是文件路径且文件存在
    if (scriptPathOrCommand !== "call-llm" && !fs.existsSync(scriptPathOrCommand)) {
      reject(new Error(`call-llm 不存在: ${scriptPathOrCommand}`));
      return;
    }

    const isCommand = scriptPathOrCommand === "call-llm";
    logDebug(`执行 call-llm: ${(isCommand ? "call-llm" : `node ${scriptPathOrCommand}`) + " " + args.join(" ")}`);

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
function parseLLMResult(stdout) {
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

/**
 * 生成语义判定提示（用于 call-llm）
 * @returns {string} 判定提示
 */
function buildSemanticPrompt() {
  return SEMANTIC_JUDGE_PROMPT;
}

/**
 * 通过 call-llm 进行语义判定
 * @param {string} judgeModel - 用于判定的 LLM 模型
 * @param {string} executionSummary - cursor-agent 执行后的总结内容
 * @returns {Promise<Object>} SemanticsResult { result: "done"|"resume"|"auto", reasons: string[] }
 */
async function interpretSemanticsViaLLM(judgeModel, executionSummary) {
  try {
    const judgePrompt = buildSemanticPrompt();

    // 构建 call-llm 参数
    const args = [
      "-m", judgeModel,
      "-f", "json",
      "-c", executionSummary.substring(0, 5000), // 限制长度
      "-p", judgePrompt,
    ];

    logSubStep(`使用模型: ${judgeModel}`);
    
    const result = await runCallLLMOnce(args, 60); // 60秒超时

    if (result.exitCode !== 0 || result.stderr) {
      logWarning(`call-llm 返回非零退出码或错误输出`);
      logDetail(`退出码: ${result.exitCode}`);
      if (result.stderr) {
        logDetail(`错误输出: ${result.stderr.substring(0, 200)}${result.stderr.length > 200 ? "..." : ""}`);
      }
      return {
        result: "resume",
        reasons: [
          `语义判定调用失败，默认需要继续执行`,
          `退出码: ${result.exitCode}`,
          result.stderr ? `错误: ${result.stderr.substring(0, 200)}` : "无错误输出",
        ],
      };
    }

    const parsed = parseLLMResult(result.stdout);
    const resultText = parsed.result === "done" ? "已完成" :
                       parsed.result === "resume" ? "需要继续" :
                       parsed.result === "auto" ? "建议继续" : parsed.result;
    const resultColor = parsed.result === "done" ? colors.green :
                        parsed.result === "resume" ? colors.yellow : colors.cyan;
    logSubStep(`判定结果: ${colorize(resultText, resultColor, colors.bold)}`);
    if (parsed.reasons && parsed.reasons.length > 0) {
      for (const reason of parsed.reasons.slice(0, 3)) {
        logDetail(`• ${reason}`);
      }
    }
    
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
// Resume 调用相关
// ============================================================================

/**
 * 查找 cursor-agent 命令路径
 * @returns {string} 命令名（默认: "cursor-agent"）
 */
function findCursorAgentCommand() {
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
 * 调用 cursor-agent resume（用于继续执行任务）
 * @param {string} model - 模型名称
 * @param {string} sessionId - session_id（必需）
 * @param {string} prompt - 提示词（简短，例如"请继续"）
 * @param {number} timeoutMinutes - 超时时间(分钟)
 * @returns {Promise<Object>} AgentRunResult { exitCode, stdout, stderr, durationMs, sessionId }
 */
function runCursorAgentResume(model, sessionId, prompt, timeoutMinutes) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const command = findCursorAgentCommand();
    const helpText = ensureCursorAgentInstalled();
    const streamPartial = hasStreamFlag(helpText);

    // 构建命令参数: cursor-agent --model <model> --resume=<session_id> --print --output-format stream-json --force <prompt>
    // 使用 --resume=<session_id> 参数，提示词作为位置参数传递
    const args = [
      "--model", model,
      `--resume=${sessionId}`,
      "--print",
      "--output-format", "stream-json",
      "--force",
      prompt,  // 简短的提示词作为位置参数
    ];

    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],  // stdin 不使用
      encoding: "utf8",
    });

    let stdout = "";
    let stderr = "";
    let isClosed = false;
    let extractedSessionId = sessionId; // 初始化为传入的 session_id
    let agentOutputStarted = false; // 是否已显示 Agent 输出开始标记
    let agentErrorStarted = false; // 是否已显示 Agent 错误输出开始标记

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

    if (child.stdout) child.stdout.setEncoding("utf8");
    if (child.stderr) child.stderr.setEncoding("utf8");

    // 检查是否支持流式输出
    if (streamPartial) {
      // 流式模式：使用 pipeThroughAssistantFilter 提取文本并显示
      // 同时收集提取后的文本和 session_id 用于语义判定
      pipeThroughAssistantFilter(child.stdout, () => {
        // 流式处理完成
      }, (extractedText) => {
        // 收集提取的文本
        stdout = extractedText;
      }, (sessionIdFromStream) => {
        // 收集提取的 session_id（可能更新）
        extractedSessionId = sessionIdFromStream;
      }, true); // resume 模式
    } else {
      // 非流式模式：直接收集输出，同时尝试提取 session_id
      child.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        
        // 首次输出时显示 Agent 输出开始标记
        if (!agentOutputStarted) {
          logAgentOutputStart(true); // resume 模式
          agentOutputStarted = true;
        }
        
        // 输出内容（带边框前缀）
        const lines = text.split(/\r?\n/);
        const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
        for (const line of lines.slice(0, -1)) {
          safeWrite(process.stderr, boxPrefix + line + "\n");
        }
        if (lines[lines.length - 1]) {
          safeWrite(process.stderr, boxPrefix + lines[lines.length - 1]);
        }
        
        // 尝试从输出中提取 session_id
        try {
          const lines = text.split(/\r?\n/);
          for (const line of lines) {
            if (line.trim() && (line.trim().startsWith("{") || line.includes("session_id"))) {
              try {
                const obj = JSON.parse(line.trim());
                const sid = extractSessionId(obj);
                if (sid) {
                  extractedSessionId = sid;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        } catch (e) {
          // 忽略提取错误
        }
      });
    }

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      
      // 显示错误输出边框
      if (!agentErrorStarted) {
        logAgentErrorStart();
        agentErrorStarted = true;
      }
      
      // 输出错误内容（带边框前缀）
      const lines = text.split(/\r?\n/);
      const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.red);
      for (const line of lines.slice(0, -1)) {
        safeWrite(process.stderr, boxPrefix + line + "\n");
      }
      if (lines[lines.length - 1]) {
        safeWrite(process.stderr, boxPrefix + lines[lines.length - 1]);
      }
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
      
      // 关闭输出边框
      if (agentOutputStarted) {
        logAgentOutputEnd();
      }
      if (agentErrorStarted) {
        logAgentErrorEnd();
      }
      
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs,
        sessionId: extractedSessionId, // 返回提取到的 session_id
      });
    });

    child.on("error", (err) => {
      isClosed = true;
      clearTimeout(timeoutId);
      
      // 关闭输出边框
      if (agentOutputStarted) {
        logAgentOutputEnd();
      }
      if (agentErrorStarted) {
        logAgentErrorEnd();
      }
      
      reject(err);
    });
  });
}

// 注意: cursor-agent 没有 --prompt 或 --file 选项
// 提示词应该作为位置参数传递，或通过标准输入传递

/**
 * 从 JSON 对象中提取 session_id
 * @param {Object} jsonObj - JSON 对象
 * @returns {string|null} session_id 或 null
 */
function extractSessionId(jsonObj) {
  if (!jsonObj || typeof jsonObj !== "object") {
    return null;
  }
  
  // 优先查找 session_id 字段
  if (typeof jsonObj.session_id === "string" && jsonObj.session_id) {
    return jsonObj.session_id;
  }
  
  return null;
}

/**
 * 从 JSON 对象中提取用户提示词
 * 支持 Cursor Agent 的实际格式：
 * {
 *   "type": "user",
 *   "message": {
 *     "role": "user",
 *     "content": [
 *       {
 *         "type": "text",
 *         "text": "用户提示词..."
 *       }
 *     ]
 *   },
 *   "session_id": "..."
 * }
 */
function extractUserText(jsonObj) {
  if (!jsonObj || typeof jsonObj !== "object") {
    return null;
  }
  
  // 检查是否是用户消息
  if (jsonObj.type === "user") {
    const parts = [];
    
    // Cursor Agent 实际格式：message.content[].text
    if (
      jsonObj.message &&
      jsonObj.message.content &&
      Array.isArray(jsonObj.message.content)
    ) {
      for (const item of jsonObj.message.content) {
        if (item && typeof item === "object") {
          // 查找 text 字段
          if (
            typeof item.text === "string" &&
            item.text !== null &&
            item.text !== ""
          ) {
            parts.push(item.text);
          }
          // 也支持直接的 content 字段（如果是字符串）
          if (
            typeof item.content === "string" &&
            item.content !== null &&
            item.content !== ""
          ) {
            parts.push(item.content);
          }
        }
      }
    }
    
    // 如果 message.content 是字符串（不是数组）
    if (
      jsonObj.message &&
      typeof jsonObj.message.content === "string" &&
      jsonObj.message.content !== null &&
      jsonObj.message.content !== ""
    ) {
      parts.push(jsonObj.message.content);
    }
    
    // 直接 content 字段
    if (
      typeof jsonObj.content === "string" &&
      jsonObj.content !== null &&
      jsonObj.content !== ""
    ) {
      parts.push(jsonObj.content);
    }
    
    if (parts.length > 0) {
      return parts.join("");
    }
  }
  
  return null;
}

/**
 * 从 JSON 对象中提取 assistant 文本内容
 * 支持 Cursor Agent 的实际格式：
 * {
 *   "type": "assistant",
 *   "message": {
 *     "role": "assistant",
 *     "content": [
 *       {
 *         "type": "text",
 *         "text": "实际内容..."
 *       }
 *     ]
 *   },
 *   "session_id": "9088cce5-ea3f-4694-8513-8ecbe5b5ad81"
 * }
 */
function extractAssistantText(jsonObj) {
  if (!jsonObj || typeof jsonObj !== "object") {
    return "";
  }

  // 只处理 assistant 类型的消息，排除 user 和 system 类型
  // 检查 type 字段
  if (jsonObj.type === "user" || jsonObj.type === "system") {
    return "";
  }
  
  // 检查 message.role 字段（如果存在）
  if (jsonObj.message && jsonObj.message.role === "user") {
    return "";
  }

  const parts = [];
  const seen = new Set(); // 用于去重，避免重复添加相同的内容

  // Cursor Agent 实际格式：message.content[].text
  // 这是最优先的格式，因为这是 cursor-agent 实际使用的格式
  // 只处理 role === "assistant" 的消息
  if (
    jsonObj.message &&
    jsonObj.message.role === "assistant" &&
    jsonObj.message.content &&
    Array.isArray(jsonObj.message.content)
  ) {
    for (const item of jsonObj.message.content) {
      if (item && typeof item === "object") {
        // 查找 text 字段
        if (
          typeof item.text === "string" &&
          item.text !== null &&
          item.text !== ""
        ) {
          // 检查是否已经添加过（避免重复）
          if (!seen.has(item.text)) {
            parts.push(item.text);
            seen.add(item.text);
          }
        }
        // 也支持直接的 content 字段（如果是字符串）
        if (
          typeof item.content === "string" &&
          item.content !== null &&
          item.content !== ""
        ) {
          if (!seen.has(item.content)) {
            parts.push(item.content);
            seen.add(item.content);
          }
        }
      }
    }
  }

  // 如果 message.content 是字符串（不是数组）
  // 只处理 role === "assistant" 的消息
  if (
    jsonObj.message &&
    jsonObj.message.role === "assistant" &&
    typeof jsonObj.message.content === "string" &&
    jsonObj.message.content !== null &&
    jsonObj.message.content !== ""
  ) {
    if (!seen.has(jsonObj.message.content)) {
      parts.push(jsonObj.message.content);
      seen.add(jsonObj.message.content);
    }
  }

  // Cursor Agent 格式：type="assistant" 或 "token" 时的直接字段
  // 但这些优先级较低，因为通常内容在 message.content 中
  if (jsonObj.type === "assistant" || jsonObj.type === "token") {
    // 优先查找 content 字段
    if (
      typeof jsonObj.content === "string" &&
      jsonObj.content !== null &&
      jsonObj.content !== ""
    ) {
      if (!seen.has(jsonObj.content)) {
        parts.push(jsonObj.content);
        seen.add(jsonObj.content);
      }
    }
    // 其次查找 text 字段
    if (
      typeof jsonObj.text === "string" &&
      jsonObj.text !== null &&
      jsonObj.text !== ""
    ) {
      if (!seen.has(jsonObj.text)) {
        parts.push(jsonObj.text);
        seen.add(jsonObj.text);
      }
    }
    // 查找 data.content
    if (
      jsonObj.data &&
      typeof jsonObj.data.content === "string" &&
      jsonObj.data.content !== null &&
      jsonObj.data.content !== ""
    ) {
      if (!seen.has(jsonObj.data.content)) {
        parts.push(jsonObj.data.content);
        seen.add(jsonObj.data.content);
      }
    }
  }

  // 如果是其他类型但有 content 字段，也提取（但跳过 system 和 user 类型）
  // 注意：只提取 assistant 相关类型，避免提取用户消息
  if (
    jsonObj.type !== "system" &&
    jsonObj.type !== "user" &&
    typeof jsonObj.content === "string" &&
    jsonObj.content !== null &&
    jsonObj.content !== ""
  ) {
    if (!seen.has(jsonObj.content)) {
      parts.push(jsonObj.content);
      seen.add(jsonObj.content);
    }
  }

  // OpenAI 风格 choices[].delta.content
  if (Array.isArray(jsonObj.choices)) {
    for (const choice of jsonObj.choices) {
      if (
        choice &&
        choice.delta &&
        typeof choice.delta.content === "string" &&
        choice.delta.content !== null &&
        choice.delta.content !== ""
      ) {
        if (!seen.has(choice.delta.content)) {
          parts.push(choice.delta.content);
          seen.add(choice.delta.content);
        }
      }
    }
  }

  // delta.content
  if (
    jsonObj.delta &&
    typeof jsonObj.delta.content === "string" &&
    jsonObj.delta.content !== null &&
    jsonObj.delta.content !== ""
  ) {
    if (!seen.has(jsonObj.delta.content)) {
      parts.push(jsonObj.delta.content);
      seen.add(jsonObj.delta.content);
    }
  }

  // role=assistant && content
  if (
    jsonObj.role === "assistant" &&
    typeof jsonObj.content === "string" &&
    jsonObj.content !== null &&
    jsonObj.content !== ""
  ) {
    if (!seen.has(jsonObj.content)) {
      parts.push(jsonObj.content);
      seen.add(jsonObj.content);
    }
  }

  // data.partial.content
  if (
    jsonObj.data &&
    jsonObj.data.partial &&
    typeof jsonObj.data.partial.content === "string" &&
    jsonObj.data.partial.content !== null &&
    jsonObj.data.partial.content !== ""
  ) {
    if (!seen.has(jsonObj.data.partial.content)) {
      parts.push(jsonObj.data.partial.content);
      seen.add(jsonObj.data.partial.content);
    }
  }

  // partial
  if (
    typeof jsonObj.partial === "string" &&
    jsonObj.partial !== null &&
    jsonObj.partial !== ""
  ) {
    if (!seen.has(jsonObj.partial)) {
      parts.push(jsonObj.partial);
      seen.add(jsonObj.partial);
    }
  }

  // token
  if (
    typeof jsonObj.token === "string" &&
    jsonObj.token !== null &&
    jsonObj.token !== ""
  ) {
    if (!seen.has(jsonObj.token)) {
      parts.push(jsonObj.token);
      seen.add(jsonObj.token);
    }
  }

  // text（通用）
  if (
    typeof jsonObj.text === "string" &&
    jsonObj.text !== null &&
    jsonObj.text !== ""
  ) {
    if (!seen.has(jsonObj.text)) {
      parts.push(jsonObj.text);
      seen.add(jsonObj.text);
    }
  }

  // 拼接所有提取到的内容片段
  return parts.join("");
}

/**
 * 流式过滤函数：从 cursor-agent 的流式输出中提取并渲染 assistant 文本内容
 * 处理 NDJSON 格式（每行一个 JSON 对象）和 SSE 格式
 * @param {Stream} stream - 输入流
 * @param {Function} onEnd - 结束回调
 * @param {Function} [onText] - 文本收集回调，接收提取的完整文本
 * @param {Function} [onSessionId] - session_id 收集回调，接收提取的 session_id
 * @param {boolean} [isResume] - 是否是 resume 模式
 */
function pipeThroughAssistantFilter(stream, onEnd, onText, onSessionId, isResume = false) {
  logDetail("初始化流式输出过滤器");

  let printedAny = false;
  let rawBuffer = ""; // 原始数据缓冲
  let chunkCount = 0;
  let lastUserOutput = ""; // 记录上次输出的用户提示词完整内容
  let lastAssistantOutput = ""; // 记录上次输出的 Agent 回复完整内容
  let sessionId = null; // 保存提取到的 session_id
  let agentOutputStarted = false; // 是否已显示 Agent 输出开始标记
  let currentLine = ""; // 当前正在输出的行（用于处理换行）
  let currentSection = null; // 当前区域：'user' | 'assistant' | null
  let userPromptDisplayed = false; // 用户提示词是否已显示
  let knownUserPrompts = new Set(); // 记录已知的用户提示词，用于过滤 assistant 输出
  let agentLabelDisplayed = false; // Agent 标签是否已在当前输出块中显示

  // 直接监听 data 事件，因为流式数据可能不是完整的行
  stream.on("data", (chunk) => {
    chunkCount++;
    const data = chunk.toString("utf8");

    // 将新数据加入缓冲
    rawBuffer += data;

    // 按行分割处理（NDJSON 格式：每行一个 JSON 对象）
    const lines = rawBuffer.split(/\r?\n/);
    // 保留最后一行（可能不完整）在缓冲中
    const lastLine = lines.pop() || "";
    rawBuffer = lastLine;

    // 处理完整的行
    for (const line of lines) {
      // 跳过空行
      if (!line.trim()) {
        continue;
      }

      // 尝试从行中提取 JSON 对象
      let jsonStr = "";

      // 处理 SSE 格式: "data: { ... }" 或 "data: [...]"
      if (
        line.startsWith("data:") &&
        (line.includes("{") || line.includes("["))
      ) {
        const jsonStart = line.match(/[{[]/);
        if (jsonStart) {
          const startIdx = line.indexOf(jsonStart[0]);
          jsonStr = line.slice(startIdx);
        }
      }
      // 处理直接以 { 或 [ 开头的 JSON 行（NDJSON 格式）
      else if (line.trim().startsWith("{") || line.trim().startsWith("[")) {
        jsonStr = line.trim();
      }
      // 忽略其他行
      else {
        continue;
      }

      // 解析 JSON 并提取内容
      if (jsonStr) {
        try {
          const obj = JSON.parse(jsonStr);
          
          // 提取 session_id
          const extractedSessionId = extractSessionId(obj);
          if (extractedSessionId && (!sessionId || extractedSessionId !== sessionId)) {
            sessionId = extractedSessionId;
            // 立即回调 session_id
            if (onSessionId) {
              onSessionId(sessionId);
            }
          }

          // 处理用户提示词
          const userText = extractUserText(obj);
          if (userText && userText !== "null" && userText.length > 0) {
            // 记录用户提示词，用于后续过滤 assistant 输出
            knownUserPrompts.add(userText.trim());
            
            // 首次输出时显示 Agent 输出开始标记
            if (!agentOutputStarted) {
              logAgentOutputStart(isResume);
              agentOutputStarted = true;
            }
            
            // 处理用户提示词的增量更新
            if (userText.startsWith(lastUserOutput)) {
              const newPart = userText.slice(lastUserOutput.length);
              if (newPart.length > 0) {
                // 如果之前是 assistant 区域，需要切换
                if (currentSection === "assistant") {
                  // 输出当前行并换行
                  if (currentLine.length > 0) {
                    const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                    process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                    currentLine = "";
                  }
                  process.stderr.write(colorize(symbols.agentBox.vertical + " ", colors.blue) + "\n", "utf8");
                }
                
                // 显示用户标签（如果还没显示）
                if (!userPromptDisplayed) {
                  const userLabel = colorize(symbols.userLabel + " ", colors.gray, colors.dim);
                  const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                  process.stderr.write(boxPrefix + userLabel, "utf8");
                  userPromptDisplayed = true;
                  currentSection = "user";
                }
                
                // 处理换行
                const lines = newPart.split(/\r?\n/);
                const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                const userLabel = colorize(symbols.userLabel + " ", colors.gray, colors.dim);
                const boxWidth = getAgentOutputBoxWidth();
                const prefixLength = 2 + getDisplayLength(userLabel); // "| " + 标签实际显示长度
                const maxContentWidth = boxWidth - prefixLength - 2; // 减去边框和空格
                
                for (let i = 0; i < lines.length; i++) {
                  if (i === 0) {
                    // 第一行追加到当前行
                    if (currentLine.length === 0) {
                      // 如果当前行是空的，说明标签刚显示，直接设置内容
                      currentLine = lines[i];
                      // 如果内容很短不需要换行，立即输出（确保用户提示词能显示）
                      if (currentLine.length <= maxContentWidth) {
                        if (lines.length === 1) {
                          // 单行且不需要换行，立即输出
                          // 如果标签还没显示，带标签；否则只带边框前缀
                          if (!userPromptDisplayed) {
                            process.stderr.write(boxPrefix + userLabel + colorize(currentLine, colors.gray, colors.dim) + "\n", "utf8");
                            userPromptDisplayed = true;
                          } else {
                            process.stderr.write(boxPrefix + colorize(currentLine, colors.gray, colors.dim) + "\n", "utf8");
                          }
                          currentLine = "";
                        }
                        // 如果是多行，第一行暂时保留在 currentLine 中，等待后续处理
                      }
                    } else {
                      // 如果当前行已有内容，追加
                      currentLine += lines[i];
                    }
                    
                    // 检查是否需要换行（只有在 currentLine 不为空时才检查）
                    if (currentLine.length > 0 && currentLine.length > maxContentWidth) {
                      const wrapped = wrapTextForAgentOutput(currentLine, boxWidth, prefixLength);
                      // 输出第一行（如果标签还没显示，带标签；否则只带边框前缀）
                      if (wrapped.length > 0) {
                        if (!userPromptDisplayed) {
                          process.stderr.write(boxPrefix + userLabel + colorize(wrapped[0], colors.gray, colors.dim) + "\n", "utf8");
                          userPromptDisplayed = true;
                        } else {
                          process.stderr.write(boxPrefix + colorize(wrapped[0], colors.gray, colors.dim) + "\n", "utf8");
                        }
                        currentLine = wrapped.slice(1).join(" ") || "";
                      }
                    }
                  } else {
                    // 输出完整行（只带边框前缀，标签只在第一行显示）
                    if (currentLine.length > 0) {
                      // 检查是否需要换行
                      if (currentLine.length > maxContentWidth) {
                        const wrapped = wrapTextForAgentOutput(currentLine, boxWidth, 2); // 只有边框前缀，没有标签
                        for (const line of wrapped) {
                          process.stderr.write(boxPrefix + colorize(line, colors.gray, colors.dim) + "\n", "utf8");
                        }
                        currentLine = "";
                      } else {
                        process.stderr.write(boxPrefix + colorize(currentLine, colors.gray, colors.dim) + "\n", "utf8");
                        currentLine = "";
                      }
                    }
                    // 新行
                    if (lines[i]) {
                      currentLine = lines[i];
                    }
                  }
                }
                printedAny = true;
                lastUserOutput = userText;
              }
            } else if (userText !== lastUserOutput) {
              // 内容完全不一样
              if (currentLine.length > 0) {
                const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                currentLine = "";
              }
              
              const userLabel = colorize(symbols.userLabel + " ", colors.gray, colors.dim);
              const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
              const lines = userText.split(/\r?\n/);
              for (let i = 0; i < lines.length - 1; i++) {
                process.stderr.write(boxPrefix + userLabel + colorize(lines[i], colors.gray, colors.dim) + "\n", "utf8");
              }
              if (lines.length > 0) {
                currentLine = lines[lines.length - 1];
              }
              printedAny = true;
              lastUserOutput = userText;
              currentSection = "user";
              userPromptDisplayed = true;
            }
          }

          // 处理 Agent 回复
          let assistantText = extractAssistantText(obj);
          
          // 过滤掉已知的用户提示词（避免重复显示）
          if (assistantText && assistantText !== "null" && assistantText.length > 0) {
            // 检查 assistant 文本是否以用户提示词开头
            for (const userPrompt of knownUserPrompts) {
              if (userPrompt && assistantText.trim().startsWith(userPrompt.trim())) {
                // 移除开头的用户提示词
                assistantText = assistantText.trim().substring(userPrompt.trim().length).trim();
                // 如果移除后为空，跳过输出
                if (!assistantText) {
                  assistantText = "";
                  break;
                }
              }
            }
          }
          
          if (assistantText && assistantText !== "null" && assistantText.length > 0) {
            // 首次输出时显示 Agent 输出开始标记
            if (!agentOutputStarted) {
              logAgentOutputStart(isResume);
              agentOutputStarted = true;
            }
            
            // 如果之前是用户区域，需要切换
            if (currentSection === "user") {
              // 输出当前行并换行
              if (currentLine.length > 0) {
                const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                currentLine = "";
              }
              process.stderr.write(colorize(symbols.agentBox.vertical + " ", colors.blue) + "\n", "utf8");
              // 切换区域时重置标签显示标志
              agentLabelDisplayed = false;
            }
            
            // cursor-agent 流式输出通常是累积式的：每个 JSON 包含完整的累积内容
            // 如果新内容以旧内容开头，说明是增量更新，只输出新增部分
            if (assistantText.startsWith(lastAssistantOutput)) {
              // 增量更新：只输出新增的部分
              const newPart = assistantText.slice(lastAssistantOutput.length);
              if (newPart.length > 0) {
                // 显示 Agent 标签（只在切换区域或新输出块的第一行显示）
                if (currentSection !== "assistant") {
                  currentSection = "assistant";
                  agentLabelDisplayed = false; // 重置标志
                }
                
                // 处理换行，为每一行添加边框前缀（标签只在第一行显示）
                const lines = newPart.split(/\r?\n/);
                const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                const agentLabel = colorize(symbols.agentLabel + " ", colors.blue);
                const boxWidth = getAgentOutputBoxWidth();
                const prefixLength = 2 + getDisplayLength(agentLabel); // "| " + 标签实际显示长度
                const maxContentWidth = boxWidth - prefixLength - 2; // 减去边框和空格
                
                for (let i = 0; i < lines.length; i++) {
                  if (i === 0) {
                    // 第一行追加到当前行
                    if (currentLine.length === 0) {
                      // 如果当前行是空的，说明是新行开始
                      currentLine = lines[i];
                      // 如果这是新输出块的第一行且标签还没显示，立即输出带标签
                      if (!agentLabelDisplayed && currentLine.length > 0) {
                        // 立即输出第一行（带标签）
                        if (currentLine.length <= maxContentWidth && lines.length === 1) {
                          // 单行且不需要换行，立即输出带标签
                          process.stderr.write(boxPrefix + agentLabel + currentLine + "\n", "utf8");
                          currentLine = "";
                          agentLabelDisplayed = true;
                        } else if (currentLine.length > maxContentWidth) {
                          // 需要换行，输出第一行（带标签）
                          const wrapped = wrapTextForAgentOutput(currentLine, boxWidth, prefixLength);
                          if (wrapped.length > 0) {
                            process.stderr.write(boxPrefix + agentLabel + wrapped[0] + "\n", "utf8");
                            agentLabelDisplayed = true;
                            currentLine = wrapped.slice(1).join(" ") || "";
                          }
                        }
                        // 如果不需要立即输出，currentLine 已设置，等待后续处理
                      }
                    } else {
                      // 如果当前行已有内容，追加（这种情况说明是增量更新，标签应该已经显示）
                      currentLine += lines[i];
                      // 检查是否需要换行
                      if (currentLine.length > maxContentWidth) {
                        const wrapped = wrapTextForAgentOutput(currentLine, boxWidth, 2); // 只有边框前缀，没有标签
                        if (wrapped.length > 0) {
                          process.stderr.write(boxPrefix + wrapped[0] + "\n", "utf8");
                          currentLine = wrapped.slice(1).join(" ") || "";
                        }
                      }
                    }
                    
                    // 如果 currentLine 还没输出且需要输出（标签已显示的情况）
                    if (currentLine.length > 0 && agentLabelDisplayed && currentLine.length <= maxContentWidth && lines.length === 1) {
                      // 单行且不需要换行，立即输出（不带标签，因为标签已显示）
                      process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                      currentLine = "";
                    }
                  } else {
                    // 后续行：先输出当前行（如果有），然后处理新行
                    if (currentLine.length > 0) {
                      // 检查是否需要换行
                      if (currentLine.length > maxContentWidth) {
                        const wrapped = wrapTextForAgentOutput(currentLine, boxWidth, 2); // 只有边框前缀，没有标签
                        for (const line of wrapped) {
                          process.stderr.write(boxPrefix + line + "\n", "utf8");
                        }
                        currentLine = "";
                      } else {
                        // 输出当前行（只带边框前缀，不显示标签）
                        process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                        currentLine = "";
                      }
                    }
                    // 新行
                    if (lines[i]) {
                      currentLine = lines[i];
                    }
                  }
                }
                // 如果最后一行没有换行符，暂不输出（等待更多内容或结束）
                printedAny = true;
                lastAssistantOutput = assistantText; // 更新记录的完整内容
              }
            } else if (assistantText !== lastAssistantOutput) {
              // 内容完全不一样（这种情况很少），输出全部
              // 先输出当前行（如果有）
              if (currentLine.length > 0) {
                const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
                process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
                currentLine = "";
              }
              
              // 重置标签显示标志（新输出块）
              agentLabelDisplayed = false;
              const agentLabel = colorize(symbols.agentLabel + " ", colors.blue);
              const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
              const lines = assistantText.split(/\r?\n/);
              // 第一行显示标签，后续行只显示边框前缀
              for (let i = 0; i < lines.length - 1; i++) {
                if (i === 0 && !agentLabelDisplayed) {
                  process.stderr.write(boxPrefix + agentLabel + lines[i] + "\n", "utf8");
                  agentLabelDisplayed = true;
                } else {
                  process.stderr.write(boxPrefix + lines[i] + "\n", "utf8");
                }
              }
              if (lines.length > 0) {
                currentLine = lines[lines.length - 1];
              }
              printedAny = true;
              lastAssistantOutput = assistantText;
              currentSection = "assistant";
            }
            // 如果 assistantText === lastAssistantOutput，说明内容没有变化，不输出
          }

          // DEBUG模式下输出详细信息
          if (process.env.DEBUG === "1") {
            const objType = obj.type || "unknown";
            const extractedText = assistantText || userText || "";
            const lastOutputText = currentSection === "assistant" ? lastAssistantOutput : lastUserOutput;
            logStep(
              7,
              `处理JSON: type=${objType}, 提取长度=${extractedText.length}, 上次长度=${lastOutputText.length}`
            );
            if (extractedText.length > 0) {
              const newPart = extractedText.startsWith(lastOutputText)
                ? extractedText.slice(lastOutputText.length)
                : extractedText;
              if (newPart.length > 0) {
                logStep(
                  7,
                  `✓ 新增输出: ${newPart.substring(0, 50)}${newPart.length > 50 ? "..." : ""}`
                );
              } else {
                logStep(7, `✗ 无新增内容（内容未变化）`);
              }
            }
          }
        } catch (parseErr) {
          // JSON 解析失败（仅在DEBUG模式下输出）
          if (process.env.DEBUG === "1") {
            logStep(7, `JSON解析失败: ${parseErr.message}`);
            logStep(
              7,
              `失败的JSON行: ${line.substring(0, 200)}${line.length > 200 ? "..." : ""}`
            );
          }
        }
      }
    }
  });

  stream.on("end", () => {
    // 处理剩余的缓冲内容
    if (rawBuffer.trim()) {
      const lines = rawBuffer.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        let jsonStr = "";
        if (
          line.startsWith("data:") &&
          (line.includes("{") || line.includes("["))
        ) {
          const jsonStart = line.match(/[{[]/);
          if (jsonStart) {
            const startIdx = line.indexOf(jsonStart[0]);
            jsonStr = line.slice(startIdx);
          }
        } else if (line.trim().match(/^[{\[]/)) {
          jsonStr = line.trim();
        }

        if (jsonStr) {
          try {
            const obj = JSON.parse(jsonStr);
            const extracted = extractAssistantText(obj);
            
            // 提取 session_id
            const extractedSessionId = extractSessionId(obj);
            if (extractedSessionId && (!sessionId || extractedSessionId !== sessionId)) {
              sessionId = extractedSessionId;
              // 立即回调 session_id
              if (onSessionId) {
                onSessionId(sessionId);
              }
            }
            
            if (extracted && extracted !== "null" && extracted.length > 0) {
              // 首次输出时显示 Agent 输出开始标记
              if (!agentOutputStarted) {
                logAgentOutputStart(isResume);
                agentOutputStarted = true;
              }
              // 输出内容（带边框前缀）
              const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
              const lines = extracted.split(/\r?\n/);
              for (const line of lines) {
                process.stderr.write(boxPrefix + line + "\n", "utf8");
              }
              printedAny = true;
            }
          } catch (_) {
            // 忽略解析错误
          }
        }
      }
    }

    // 输出剩余的当前行（如果有）
    if (currentLine.length > 0) {
      const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
      if (currentSection === "user") {
        const label = colorize(symbols.userLabel + " ", colors.gray, colors.dim);
        process.stderr.write(boxPrefix + label + colorize(currentLine, colors.gray, colors.dim) + "\n", "utf8");
      } else if (currentSection === "assistant") {
        // 如果标签还没显示，显示标签；否则只显示边框前缀
        if (!agentLabelDisplayed) {
          const label = colorize(symbols.agentLabel + " ", colors.blue);
          process.stderr.write(boxPrefix + label + currentLine + "\n", "utf8");
          agentLabelDisplayed = true;
        } else {
          process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
        }
      } else {
        process.stderr.write(boxPrefix + currentLine + "\n", "utf8");
      }
      currentLine = "";
    }

    // 如果输出了任何内容，显示结束标记
    if (agentOutputStarted) {
      logAgentOutputEnd();
    }

    // 调用文本收集回调（如果提供）- 只传递 assistant 文本
    if (onText && lastAssistantOutput) {
      onText(lastAssistantOutput);
    }
    
    // 最后回调 session_id（如果提取到了）
    if (onSessionId && sessionId) {
      onSessionId(sessionId);
    }

    // 仅在DEBUG模式下输出统计信息
    if (process.env.DEBUG === "1") {
      logDebug(`流式处理完成: 接收 ${chunkCount} 个数据块, session_id: ${sessionId || "未找到"}`);
    }

    if (onEnd) {
      onEnd();
    }
  });

  stream.on("error", (err) => {
    logError(`流式处理错误: ${err.message}`);
    if (agentOutputStarted) {
      logAgentOutputEnd();
    }
    if (onEnd) {
      onEnd();
    }
  });
}

async function main() {
  // 优先从 .flow/.env 加载环境变量
  loadEnvFile();

  // 先解析参数，检查是否需要显示帮助
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  logTitle("Cursor Agent Task Runner", "任务执行脚本");

  logStep(1, "解析命令行参数");
  
  // 如果未提供 --judge-model，尝试从环境变量读取
  if (!args.judgeModel && process.env.CURSOR_TASKS_JUDGE_MODEL) {
    args.judgeModel = process.env.CURSOR_TASKS_JUDGE_MODEL;
    logSubStep(`从环境变量读取 judge-model: ${args.judgeModel}`);
  }
  
  logSubStep(`模型: ${args.model}`);
  logSubStep(`判定模型: ${args.judgeModel || "(未设置)"}`);
  logSubStep(`提示词文件: ${args.promptFiles.length} 个`);
  logSubStep(`系统提示词: ${args.systemPrompt ? "已提供" : "未提供"}`);
  logSubStep(`直接提示词: ${args.prompt ? "已提供" : "未提供"}`);
  logSubStep(`透传参数: ${args.positional.length} 个`);
  if (args.echoUrl && args.echoApiKey && args.echoTaskId && args.echoTaskFile) {
    logSubStep(`TaskEcho 推送: 已启用`);
  }

  // 如果提供了 TaskEcho 参数，设置环境变量
  if (args.echoUrl && args.echoApiKey) {
    process.env.TASKECHO_API_URL = args.echoUrl;
    process.env.TASKECHO_API_KEY = args.echoApiKey;
    process.env.TASKECHO_ENABLED = "true";
  }

  // 验证必需参数
  if (!args.prompt && args.promptFiles.length === 0) {
    logError("必须提供 --prompt 或 --file 其中之一");
    die(2, "错误: 必须提供 --prompt 或 --file 其中之一");
  }

  if (!args.judgeModel) {
    logError("必须提供 --judge-model 参数（用于语义判定），或设置环境变量 CURSOR_TASKS_JUDGE_MODEL");
    die(2, "错误: 必须提供 --judge-model 参数（用于语义判定），或设置环境变量 CURSOR_TASKS_JUDGE_MODEL");
  }

  const userPrompt = await buildUserPrompt(args.prompt, args.promptFiles);

  logStep(4, "构建最终提示词");
  const combinedPrompt = args.systemPrompt
    ? `${args.systemPrompt}\n\n${userPrompt}`
    : userPrompt;
  logSubStep(`总长度: ${combinedPrompt.length} 字符`);
  if (args.systemPrompt) {
    logDetail(`包含系统提示词`);
  }

  // 执行任务循环
  const result = await executeTaskWithRetry(
    combinedPrompt,
    args.model,
    args.judgeModel,
    args.retry,
    args.timeoutMinutes,
    args.positional,
    args.echoUrl && args.echoApiKey && args.echoTaskId && args.echoTaskFile 
      ? { 
          url: args.echoUrl, 
          apiKey: args.echoApiKey,
          taskId: args.echoTaskId,
          taskFile: args.echoTaskFile
        } 
      : null
  );

  // 输出执行结果汇总
  logTitle("执行结果汇总");
  const statusText = result.success ? "成功完成" : 
                     result.finalStatus === "partial" ? "部分完成" :
                     result.finalStatus === "error" ? "执行失败" : "未知状态";
  const statusSymbol = result.success ? symbols.check : 
                       result.finalStatus === "error" ? symbols.cross : symbols.warning;
  logStatus(`${statusSymbol} 状态: ${statusText}`);
  logSubStep(`执行次数: ${result.attempts} 次`);
  if (result.executions.length > 0) {
    const totalDuration = result.executions.reduce((sum, e) => sum + e.durationMs, 0);
    logSubStep(`总耗时: ${(totalDuration / 1000).toFixed(1)} 秒`);
  }
  if (result.errorMessage) {
    logError(result.errorMessage);
  }

  // 输出 JSON 格式的执行结果到 stdout
  console.log(JSON.stringify(result, null, 2));

  // 根据结果设置退出码
  const exitCode = result.success ? 0 : 1;
  process.exit(exitCode);
}

/**
 * 执行单次 cursor-agent 调用（首次执行）
 * @param {string} prompt - 提示词
 * @param {string} model - 模型名称
 * @param {string[]} positionalArgs - 透传参数
 * @param {number} timeoutMinutes - 超时时间（分钟）
 * @returns {Promise<Object>} { exitCode, stdout, stderr, durationMs, sessionId }
 */
function runCursorAgentInitial(prompt, model, positionalArgs, timeoutMinutes) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const helpText = ensureCursorAgentInstalled();
  const streamPartial = hasStreamFlag(helpText);

  let runArgs = [];
  let useStdinFallback = false;

    // 检查 prompt 是否适合作为命令行参数传递
    const hasNewlines = prompt.includes("\n") || prompt.includes("\r");
    const isTooLong = prompt.length > 50000;
    const needsStdinMode = hasNewlines || isTooLong;
    
    if (needsStdinMode) {
      useStdinFallback = true;
      runArgs = ["-p", "--model", model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
  } else {
      runArgs = ["-p", "--model", model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
      runArgs.push(prompt);
  }

  // 检查是否已经包含 --output-format 参数
    const hasOutputFormat = positionalArgs.some((arg, idx) => {
    if (arg === "--output-format" || arg.startsWith("--output-format=")) {
      return true;
    }
      if (idx > 0 && positionalArgs[idx - 1] === "--output-format") {
      return true;
    }
    return false;
  });

  if (!hasOutputFormat) {
    runArgs.push("--output-format", "stream-json");
    }

    if (positionalArgs.length > 0) {
      runArgs = runArgs.concat(positionalArgs);
    }

  const child = spawn("cursor-agent", runArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (child.stdout) child.stdout.setEncoding("utf8");
  if (child.stderr) child.stderr.setEncoding("utf8");

    let stdout = "";
    let stderr = "";
    let isClosed = false;
    let extractedSessionId = null; // 保存提取到的 session_id
    let agentOutputStarted = false; // 是否已显示 Agent 输出开始标记
    let agentErrorStarted = false; // 是否已显示 Agent 错误输出开始标记

    const safeWrite = (stream, text) => {
      if (!isClosed && stream && !stream.destroyed && stream.writable) {
        try {
          stream.write(text);
        } catch (err) {
          // 忽略写入错误
        }
      }
    };

  child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      // 显示错误输出边框
      if (!agentErrorStarted) {
        logAgentErrorStart();
        agentErrorStarted = true;
      }
      // 输出错误内容（带边框前缀）
      const lines = text.split(/\r?\n/);
      const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.red);
      for (const line of lines.slice(0, -1)) {
        safeWrite(process.stderr, boxPrefix + line + "\n");
      }
      if (lines[lines.length - 1]) {
        safeWrite(process.stderr, boxPrefix + lines[lines.length - 1]);
      }
  });

  if (useStdinFallback) {
      child.stdin.write(prompt + "\n", "utf8");
    child.stdin.end();
  } else {
    child.stdin.end();
  }

  if (streamPartial) {
      // 流式模式：使用 pipeThroughAssistantFilter 提取文本并显示
      // 同时收集提取后的文本和 session_id 用于语义判定
    pipeThroughAssistantFilter(child.stdout, () => {
        // 流式处理完成
      }, (extractedText) => {
        // 收集提取的文本
        stdout = extractedText;
    }, (sessionIdFromStream) => {
        // 收集提取的 session_id
        extractedSessionId = sessionIdFromStream;
    }, false); // 首次执行，不是 resume
  } else {
    child.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        
        // 首次输出时显示 Agent 输出开始标记
        if (!agentOutputStarted) {
          logAgentOutputStart(false);
          agentOutputStarted = true;
        }
        
        // 输出内容（带边框前缀）
        const lines = text.split(/\r?\n/);
        const boxPrefix = colorize(symbols.agentBox.vertical + " ", colors.blue);
        for (const line of lines.slice(0, -1)) {
          safeWrite(process.stderr, boxPrefix + line + "\n");
        }
        if (lines[lines.length - 1]) {
          safeWrite(process.stderr, boxPrefix + lines[lines.length - 1]);
        }
        
        // 尝试从输出中提取 session_id
        try {
          const lines = text.split(/\r?\n/);
          for (const line of lines) {
            if (line.trim() && (line.trim().startsWith("{") || line.includes("session_id"))) {
              try {
                const obj = JSON.parse(line.trim());
                const sid = extractSessionId(obj);
                if (sid) {
                  extractedSessionId = sid;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        } catch (e) {
          // 忽略提取错误
        }
      });
    }

    const timeoutMs = timeoutMinutes * 60 * 1000;
    const timeoutId = setTimeout(() => {
      isClosed = true;
      child.kill("SIGTERM");
      reject(new Error(`执行超时(超过 ${timeoutMinutes} 分钟)`));
    }, timeoutMs);

    child.on("close", (code) => {
      isClosed = true;
      clearTimeout(timeoutId);
      
      // 关闭输出边框
      if (agentOutputStarted) {
        logAgentOutputEnd();
      }
      if (agentErrorStarted) {
        logAgentErrorEnd();
      }
      
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs,
        sessionId: extractedSessionId, // 返回提取到的 session_id
      });
    });

    child.on("error", (err) => {
      isClosed = true;
      clearTimeout(timeoutId);
      
      // 关闭输出边框
      if (agentOutputStarted) {
        logAgentOutputEnd();
      }
      if (agentErrorStarted) {
        logAgentErrorEnd();
      }
      
      reject(err);
    });
  });
}

/**
 * 推送日志到 TaskEcho（带错误处理）
 * @param {Object|null} echoConfig - TaskEcho 配置（可选，包含 taskId, taskFile）
 * @param {string} content - 日志内容
 * @param {boolean} silent - 是否静默处理错误（默认: true）
 */
async function pushLogToTaskEcho(echoConfig, content, silent = true) {
  if (!echoConfig || !taskecho.isEnabled()) {
    return;
  }
  
  try {
    const { taskId, taskFile } = echoConfig;
    if (!taskId || !taskFile) {
      return;
    }
    
    const projectInfo = await taskecho.getProjectInfo();
    const queueInfo = taskecho.getQueueInfo(taskFile, { prompts: [] });
    
    await taskecho.addLog(
      projectInfo.project_id,
      queueInfo.queue_id,
      taskId,
      content
    );
    
    if (!silent) {
      logDetail(`日志已推送到 TaskEcho: ${content.substring(0, 50)}...`);
    }
  } catch (err) {
    if (!silent) {
      logDetail(`TaskEcho 日志推送失败: ${err.message}`);
    }
    // 静默处理错误，不影响主流程
  }
}

/**
 * 执行任务循环（首次执行 -> 判定 -> resume -> ...）
 * @param {string} prompt - 初始提示词
 * @param {string} model - 模型名称
 * @param {string} judgeModel - 语义判定模型
 * @param {number} retry - 最大重试次数
 * @param {number} timeoutMinutes - 每次执行的超时时间（分钟）
 * @param {string[]} positionalArgs - 透传参数
 * @param {Object|null} echoConfig - TaskEcho 配置（可选，包含 url, apiKey, taskId, taskFile）
 * @returns {Promise<Object>} 执行结果
 */
async function executeTaskWithRetry(prompt, model, judgeModel, retry, timeoutMinutes, positionalArgs, echoConfig = null) {
  const executions = [];
  let attempts = 0;
  let needsContinue = true;
  let finalStatus = "done";
  let errorMessage = null;
  let lastSemanticsResult = null; // 保存上次的语义判定结果
  let sessionId = null; // 保存 session_id

  logTitle("任务执行循环", `最大重试: ${retry} 次 | 超时: ${timeoutMinutes} 分钟`);

  // 推送任务开始日志
  await pushLogToTaskEcho(
    echoConfig,
    `📋 任务开始执行 | 模型: ${model} | 最大重试: ${retry} 次 | 超时: ${timeoutMinutes} 分钟`
  );

  while (needsContinue && attempts < retry) {
    attempts++;
    logStep(attempts, `执行 ${attempts}/${retry}`);
    
    // 推送执行开始日志
    const executionType = attempts === 1 ? "首次执行" : "Resume";
    await pushLogToTaskEcho(
      echoConfig,
      `▶️ 第 ${attempts} 次执行开始 | 类型: ${executionType}${attempts > 1 && sessionId ? ` | session_id: ${sessionId}` : ""}`
    );

    try {
      let result;
      
      if (attempts === 1) {
        // 首次执行：使用 cursor-agent（非 resume）
        logSubStep("调用 cursor-agent (首次执行)");
        logDetail(`模型: ${model}`);
        result = await runCursorAgentInitial(prompt, model, positionalArgs, timeoutMinutes);
        // 保存首次执行获取的 session_id
        if (result.sessionId) {
          sessionId = result.sessionId;
          logSuccess(`提取到 session_id: ${sessionId}`);
        }
      } else {
        // 后续执行：使用 cursor-agent resume
        if (!sessionId) {
          logError("未找到 session_id，无法继续执行");
          errorMessage = "未找到 session_id，无法继续执行";
          finalStatus = "error";
          break;
        }
        
        // 根据上次语义判定结果决定提示词
        const resumePrompt = lastSemanticsResult && lastSemanticsResult.result === "auto"
          ? "按你的建议执行"
          : "请继续";
        
        logSubStep("调用 cursor-agent resume");
        logDetail(`session_id: ${sessionId}`);
        logDetail(`提示词: "${resumePrompt}"`);
        result = await runCursorAgentResume(model, sessionId, resumePrompt, timeoutMinutes);
        
        // 更新 session_id（可能更新）
        if (result.sessionId && result.sessionId !== sessionId) {
          sessionId = result.sessionId;
          logDetail(`更新 session_id: ${sessionId}`);
        }
      }

      logSubStep(`执行时长: ${(result.durationMs / 1000).toFixed(1)} 秒`);

      // 推送执行完成日志
      const durationText = `${(result.durationMs / 1000).toFixed(1)} 秒`;
      await pushLogToTaskEcho(
        echoConfig,
        `✅ 执行完成 | 时长: ${durationText} | 退出码: ${result.exitCode || 0}`
      );

      // 检查运行时错误
      if (result.exitCode !== 0 || result.stderr) {
        logError(`运行时错误: 退出码 ${result.exitCode}`);
        const fullError = `运行时错误: 退出码 ${result.exitCode}\n${result.stderr || "无错误输出"}\n\n标准输出:\n${result.stdout}`;
        errorMessage = fullError.substring(0, 200);
        finalStatus = "error";
        
        // 推送运行时错误日志
        const errorSummary = result.stderr 
          ? result.stderr.substring(0, 200) + (result.stderr.length > 200 ? "..." : "")
          : "无错误输出";
        await pushLogToTaskEcho(
          echoConfig,
          `❌ 运行时错误 | 退出码: ${result.exitCode} | 错误: ${errorSummary}`
        );
        
        executions.push({
          index: attempts,
          durationMs: result.durationMs,
          conclusion: "运行时错误",
          notes: [fullError.substring(0, 500) + (fullError.length > 500 ? "..." : "")],
        });
        break;
      }

      // 进行语义判定
      logSubStep("进行语义判定");
      const executionSummary = result.stdout.substring(0, 5000);
      const semanticsResult = await interpretSemanticsViaLLM(judgeModel, executionSummary);
      
      // 推送语义判定结果日志
      const resultText = semanticsResult.result === "done" ? "已完成" :
                         semanticsResult.result === "auto" ? "建议继续" : "需要继续";
      const reasonText = semanticsResult.reasons && semanticsResult.reasons.length > 0
        ? semanticsResult.reasons[0].substring(0, 100) + (semanticsResult.reasons[0].length > 100 ? "..." : "")
        : "无原因说明";
      await pushLogToTaskEcho(
        echoConfig,
        `🔍 语义判定 | 结果: ${resultText} | 原因: ${reasonText}`
      );
      
      // 保存语义判定结果，用于下次 resume 时决定提示词
      lastSemanticsResult = semanticsResult;

      // 记录本次执行
      executions.push({
        index: attempts,
        durationMs: result.durationMs,
        conclusion: semanticsResult.result === "done" ? "已完成" : 
                    semanticsResult.result === "auto" ? "建议继续" : "需要继续",
        sessionId: result.sessionId || sessionId || null,
        notes: [
          `判定结果: ${semanticsResult.result}`,
          ...semanticsResult.reasons,
          result.stdout.substring(0, 200) + "...",
        ],
      });

      // 推送 AI 回复到 TaskEcho（如果启用）
      if (echoConfig && taskecho.isEnabled()) {
        try {
          const taskId = echoConfig.taskId;
          const taskFile = echoConfig.taskFile;
          
          if (taskId && taskFile) {
            const projectInfo = await taskecho.getProjectInfo();
            const queueInfo = taskecho.getQueueInfo(taskFile, { prompts: [] });
            
            // 提取 AI 回复内容（result.stdout 包含完整的 AI 回复）
            let aiMessage = result.stdout.trim();
            
            // 如果 stdout 包含 JSON，尝试提取非 JSON 部分
            if (aiMessage) {
              const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const jsonIndex = aiMessage.indexOf(jsonMatch[0]);
                if (jsonIndex > 0) {
                  // JSON 之前的内容
                  aiMessage = aiMessage.substring(0, jsonIndex).trim();
                } else if (jsonIndex === 0) {
                  // JSON 在开头，尝试提取 JSON 之后的内容
                  const afterJson = aiMessage.substring(jsonMatch[0].length).trim();
                  if (afterJson) {
                    aiMessage = afterJson;
                  } else {
                    // 如果 JSON 之后没有内容，跳过推送
                    aiMessage = "";
                  }
                }
              }
            }
            
            // 如果提取到了消息内容，推送消息
            if (aiMessage && aiMessage.length > 0) {
              await taskecho.addMessage(
                projectInfo.project_id,
                queueInfo.queue_id,
                taskId,
                "assistant",
                aiMessage,
                sessionId || null  // 附带 session_id（如果可用）
              );
              logDetail(`AI 回复已推送到 TaskEcho (${aiMessage.length} 字符)${sessionId ? `, session_id: ${sessionId}` : ""}`);
            }
          }
        } catch (err) {
          // 静默处理错误，不影响主流程
          logDetail(`TaskEcho 推送失败: ${err.message}`);
        }
      }

      // 根据结果处理
      if (semanticsResult.result === "done") {
        logSuccess("任务已完成");
        finalStatus = "done";
        needsContinue = false;
        
        // 推送任务完成日志
        await pushLogToTaskEcho(
          echoConfig,
          `🎉 任务已完成 | 总执行次数: ${attempts} 次`
        );
        
        break;
      } else {
        // resume 或 auto：标记需要继续
        needsContinue = true;
        const continueReason = semanticsResult.result === "auto" ? "建议继续" : "需要继续";
        
        if (semanticsResult.result === "auto") {
          logWarning("建议继续执行");
        } else {
          logWarning("需要继续执行");
        }
        
        // 推送需要继续日志
        if (attempts < retry) {
          await pushLogToTaskEcho(
            echoConfig,
            `⏭️ ${continueReason} | 准备第 ${attempts + 1} 次执行`
          );
          logFlow(`准备第 ${attempts + 1} 次执行...`);
        }
      }
    } catch (err) {
      logError(`执行出错: ${err.message}`);
      errorMessage = err.message;
      finalStatus = "error";
      
      // 推送异常错误日志
      await pushLogToTaskEcho(
        echoConfig,
        `💥 执行异常 | 错误: ${err.message.substring(0, 200)}${err.message.length > 200 ? "..." : ""}`
      );
      
      executions.push({
        index: attempts,
        durationMs: 0,
        conclusion: "执行出错",
        notes: [err.message.substring(0, 500) + (err.message.length > 500 ? "..." : "")],
      });
      break;
    }
  }

  // 如果达到重试上限仍未完成
  if (needsContinue && attempts >= retry) {
    logWarning(`达到重试上限(${retry})，标记为部分完成`);
    finalStatus = "partial";
    
    // 推送重试上限日志
    await pushLogToTaskEcho(
      echoConfig,
      `⚠️ 达到重试上限(${retry}) | 标记为部分完成`
    );
  }

  // 推送任务最终状态汇总
  const totalDuration = executions.reduce((sum, e) => sum + e.durationMs, 0);
  const statusText = finalStatus === "done" ? "✅ 成功完成" :
                     finalStatus === "partial" ? "⚠️ 部分完成" :
                     finalStatus === "error" ? "❌ 执行失败" : "❓ 未知状态";
  await pushLogToTaskEcho(
    echoConfig,
    `${statusText} | 总执行次数: ${attempts} 次 | 总耗时: ${(totalDuration / 1000).toFixed(1)} 秒${errorMessage ? ` | 错误: ${errorMessage.substring(0, 100)}${errorMessage.length > 100 ? "..." : ""}` : ""}`
  );

  return {
    success: finalStatus === "done",
    attempts,
    finalStatus,
    executions,
    errorMessage,
  };
}

// 处理未捕获的异常
process.on("uncaughtException", (err) => {
  console.error("未捕获的异常:", err);
  process.exit(1);
});

// 处理未处理的 Promise 拒绝
process.on("unhandledRejection", (reason, promise) => {
  console.error("未处理的 Promise 拒绝:", reason);
  process.exit(1);
});

main().catch((err) => {
  console.error(`错误: 脚本执行失败: ${String((err && err.message) || err)}`);
  process.exit(1);
});
