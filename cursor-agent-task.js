#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");

// 注意: 已移除浏览器关闭相关功能

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
如果只是建议下一步要做什么，那么就返回"auto"。
要仔细分辨建议部分的内容。如果总结已经说明任务已经完成,只是建议任务外的其他工作。也判定为:已经完成任务。返回"done"。
------------------------------------------------------
返回的内容以JSON格式返回，例如: 
\`\`\`json
{"result":"done"}。
\`\`\`
`;

// 日志输出函数（输出到 stderr，避免影响 stdout）
function log(message, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;
  console.error(prefix, message, ...args);
}

function logStep(step, message, ...args) {
  log(`[步骤 ${step}]`, message, ...args);
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
    logStep(0, `环境变量文件不存在: ${envFilePath}`);
    return;
  }

  logStep(0, `从文件加载环境变量: ${envFilePath}`);
  
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
          logStep(0, `已加载: ${key} = ${value.substring(0, 20)}${value.length > 20 ? "..." : ""}`);
        }
      }
    }

    logStep(0, `环境变量加载完成，共加载 ${loadedCount} 个变量`);
  } catch (err) {
    logStep(0, `读取环境变量文件失败: ${err.message}`);
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
    logStep(2, `开始读取 ${promptFiles.length} 个文件`);
    let stdinUsed = false;
    let first = true;
    for (let i = 0; i < promptFiles.length; i++) {
      const f = promptFiles[i];
      let content = "";
      if (f === "-") {
        if (stdinUsed) {
          die(2, "错误: 标准输入 (-) 只能使用一次");
        }
        logStep(2, `文件 ${i + 1}/${promptFiles.length}: 从标准输入读取`);
        stdinUsed = true;
        content = await readAll(process.stdin);
        logStep(
          2,
          `文件 ${i + 1}/${promptFiles.length}: 从标准输入读取完成，长度:`,
          content.length,
          "字符"
        );
      } else {
        if (!fs.existsSync(f)) {
          die(2, `错误: 文件不存在: ${f}`);
        }
        logStep(2, `文件 ${i + 1}/${promptFiles.length}: 读取文件 ${f}`);
        content = await fsp.readFile(f, "utf8");
        logStep(
          2,
          `文件 ${i + 1}/${promptFiles.length}: 读取完成，长度:`,
          content.length,
          "字符"
        );
      }
      if (first) {
        out += content;
        first = false;
      } else {
        out += "\n\n" + content;
      }
      hasContent = true;
    }
    logStep(2, "所有文件读取完成");
  }

  // 第二步：追加 prompt（-p 参数）
  if (prompt) {
    if (hasContent) {
      out += "\n\n" + prompt;
      logStep(2, "已追加直接提示词，合并后总长度:", out.length, "字符");
    } else {
      out = prompt;
      logStep(2, "使用直接提示词，长度:", prompt.length, "字符");
    }
  } else {
    logStep(2, "合并后总长度:", out.length, "字符");
  }

  return out;
}

function ensureCursorAgentInstalled() {
  logStep(3, "检查 cursor-agent 是否已安装");
  try {
    const r = spawnSync("cursor-agent", ["--help"], { encoding: "utf8" });
    if (r.error && r.error.code === "ENOENT") {
      die(127, "错误: 未找到 cursor-agent 命令，请确认已安装并在 PATH 中");
    }
    logStep(3, "cursor-agent 检测成功");
    return (r.stdout || "") + (r.stderr || "");
  } catch (e) {
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
    logStep(10, `执行 call-llm: ${(isCommand ? "call-llm" : `node ${scriptPathOrCommand}`) + " " + args.join(" ")}`);

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

    logStep(10, `[语义判定] 使用模型: ${judgeModel}`);
    
    const result = await runCallLLMOnce(args, 60); // 60秒超时

    if (result.exitCode !== 0 || result.stderr) {
      logStep(10, `[语义判定] call-llm 返回非零退出码或错误输出`);
      logStep(10, `[语义判定] 退出码: ${result.exitCode}`);
      if (result.stderr) {
        logStep(10, `[语义判定] 错误输出: ${result.stderr}`);
      }
      if (result.stdout) {
        logStep(10, `[语义判定] 标准输出: ${result.stdout.substring(0, 500)}${result.stdout.length > 500 ? "..." : ""}`);
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
    logStep(10, `[语义判定] 结果: ${parsed.result}`);
    
    return parsed;
  } catch (err) {
    logStep(10, `语义判定调用失败: ${err.message}`);
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

    logStep(11, `调用 cursor-agent resume: cursor-agent --model ${model} --resume=${sessionId} --print --output-format stream-json --force "${prompt}"`);

    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],  // stdin 不使用
      encoding: "utf8",
    });

    let stdout = "";
    let stderr = "";
    let isClosed = false;
    let extractedSessionId = sessionId; // 初始化为传入的 session_id

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
      });
    } else {
      // 非流式模式：直接收集输出，同时尝试提取 session_id
      child.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        // 输出到 stderr，避免污染 stdout（JSON 输出）
        safeWrite(process.stderr, data);
        
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
      // 实时输出到控制台
      safeWrite(process.stderr, text);
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
        sessionId: extractedSessionId, // 返回提取到的 session_id
      });
    });

    child.on("error", (err) => {
      isClosed = true;
      clearTimeout(timeoutId);
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

  const parts = [];
  const seen = new Set(); // 用于去重，避免重复添加相同的内容

  // Cursor Agent 实际格式：message.content[].text
  // 这是最优先的格式，因为这是 cursor-agent 实际使用的格式
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
  if (
    jsonObj.message &&
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

  // 如果是其他类型但有 content 字段，也提取（但跳过 system 类型的初始化消息）
  if (
    jsonObj.type !== "system" &&
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
 */
function pipeThroughAssistantFilter(stream, onEnd, onText, onSessionId) {
  logStep(7, "初始化流式输出过滤器");

  let printedAny = false;
  let rawBuffer = ""; // 原始数据缓冲
  let chunkCount = 0;
  let lastOutput = ""; // 记录上次输出的完整内容，用于流式输出的增量提取
  let sessionId = null; // 保存提取到的 session_id

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

          // 如果提取到内容，处理流式输出的增量更新
          if (extracted && extracted !== "null" && extracted.length > 0) {
            // cursor-agent 流式输出通常是累积式的：每个 JSON 包含完整的累积内容
            // 如果新内容以旧内容开头，说明是增量更新，只输出新增部分
            if (extracted.startsWith(lastOutput)) {
              // 增量更新：只输出新增的部分
              const newPart = extracted.slice(lastOutput.length);
              if (newPart.length > 0) {
                // 输出到 stderr，避免污染 stdout（JSON 输出）
                process.stderr.write(newPart, "utf8");
                printedAny = true;
                lastOutput = extracted; // 更新记录的完整内容
              }
            } else if (extracted !== lastOutput) {
              // 内容完全不一样（这种情况很少），输出全部
              process.stderr.write(extracted, "utf8");
              printedAny = true;
              lastOutput = extracted;
            }
            // 如果 extracted === lastOutput，说明内容没有变化，不输出
          }

          // DEBUG模式下输出详细信息
          if (process.env.DEBUG === "1") {
            const objType = obj.type || "unknown";
            logStep(
              7,
              `处理JSON: type=${objType}, 提取长度=${extracted.length}, 上次长度=${lastOutput.length}`
            );
            if (extracted.length > 0) {
              const newPart = extracted.startsWith(lastOutput)
                ? extracted.slice(lastOutput.length)
                : extracted;
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
              // 输出到 stderr，避免污染 stdout（JSON 输出）
              process.stderr.write(extracted, "utf8");
              printedAny = true;
            }
          } catch (_) {
            // 忽略解析错误
          }
        }
      }
    }

    // 如果输出了任何内容，添加换行符
    if (printedAny) {
      process.stderr.write("\n");
    }

    // 调用文本收集回调（如果提供）
    if (onText && lastOutput) {
      onText(lastOutput);
    }
    
    // 最后回调 session_id（如果提取到了）
    if (onSessionId && sessionId) {
      onSessionId(sessionId);
    }

    // 仅在DEBUG模式下输出统计信息
    if (process.env.DEBUG === "1") {
      logStep(7, `流式处理完成: 接收 ${chunkCount} 个数据块, session_id: ${sessionId || "未找到"}`);
    }

    if (onEnd) {
      onEnd();
    }
  });

  stream.on("error", (err) => {
    logStep(7, `流式处理错误: ${err.message}`);
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

  log("=".repeat(60));
  log("脚本开始执行");
  log("=".repeat(60));

  logStep(1, "解析命令行参数");
  
  // 如果未提供 --judge-model，尝试从环境变量读取
  if (!args.judgeModel && process.env.CURSOR_TASKS_JUDGE_MODEL) {
    args.judgeModel = process.env.CURSOR_TASKS_JUDGE_MODEL;
    logStep(1, `从环境变量读取 judge-model: ${args.judgeModel}`);
  }
  
  logStep(1, "参数解析完成:", {
    model: args.model,
    hasPrompt: !!args.prompt,
    promptFilesCount: args.promptFiles.length,
    hasSystemPrompt: !!args.systemPrompt,
    judgeModel: args.judgeModel || "(未设置)",
    positionalArgsCount: args.positional.length,
  });

  // 验证必需参数
  if (!args.prompt && args.promptFiles.length === 0) {
    die(2, "错误: 必须提供 --prompt 或 --file 其中之一");
  }

  if (!args.judgeModel) {
    die(2, "错误: 必须提供 --judge-model 参数（用于语义判定），或设置环境变量 CURSOR_TASKS_JUDGE_MODEL");
  }

  const userPrompt = await buildUserPrompt(args.prompt, args.promptFiles);

  logStep(4, "合并提示词");
  const combinedPrompt = args.systemPrompt
    ? `${args.systemPrompt}\n\n${userPrompt}`
    : userPrompt;
  logStep(4, "提示词合并完成，总长度:", combinedPrompt.length, "字符");

  // 执行任务循环
  const result = await executeTaskWithRetry(
    combinedPrompt,
    args.model,
    args.judgeModel,
    args.retry,
    args.timeoutMinutes,
    args.positional
  );

  // 输出 JSON 格式的执行结果到 stdout
  console.log(JSON.stringify(result, null, 2));

  // 根据结果设置退出码
  const exitCode = result.success ? 0 : 1;
  log("=".repeat(60));
  log("脚本执行完成");
  log("=".repeat(60));
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

    logStep(7, "启动 cursor-agent 子进程（首次执行）");
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
      safeWrite(process.stderr, d);
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
    });
  } else {
    child.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        // 输出到 stderr，避免污染 stdout（JSON 输出）
        safeWrite(process.stderr, d);
        
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
      reject(err);
    });
  });
}

/**
 * 执行任务循环（首次执行 -> 判定 -> resume -> ...）
 * @param {string} prompt - 初始提示词
 * @param {string} model - 模型名称
 * @param {string} judgeModel - 语义判定模型
 * @param {number} retry - 最大重试次数
 * @param {number} timeoutMinutes - 每次执行的超时时间（分钟）
 * @param {string[]} positionalArgs - 透传参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeTaskWithRetry(prompt, model, judgeModel, retry, timeoutMinutes, positionalArgs) {
  const executions = [];
  let attempts = 0;
  let needsContinue = true;
  let finalStatus = "done";
  let errorMessage = null;
  let lastSemanticsResult = null; // 保存上次的语义判定结果
  let sessionId = null; // 保存 session_id

  logStep(12, "开始任务执行循环");
  logStep(12, `最大重试次数: ${retry}, 每次超时: ${timeoutMinutes} 分钟`);

  while (needsContinue && attempts < retry) {
    attempts++;
    logStep(12, `第 ${attempts} 次执行开始`);

    try {
      let result;
      
      if (attempts === 1) {
        // 首次执行：使用 cursor-agent（非 resume）
        result = await runCursorAgentInitial(prompt, model, positionalArgs, timeoutMinutes);
        // 保存首次执行获取的 session_id
        if (result.sessionId) {
          sessionId = result.sessionId;
          logStep(12, `提取到 session_id: ${sessionId}`);
        }
      } else {
        // 后续执行：使用 cursor-agent resume
        if (!sessionId) {
          logStep(12, "错误: 未找到 session_id，无法继续执行");
          errorMessage = "未找到 session_id，无法继续执行";
          finalStatus = "error";
          break;
        }
        
        // 根据上次语义判定结果决定提示词
        const resumePrompt = lastSemanticsResult && lastSemanticsResult.result === "auto"
          ? "按你的建议执行"
          : "请继续";
        
        logStep(12, `使用 resume 模式继续执行: session_id=${sessionId}, prompt="${resumePrompt}"`);
        result = await runCursorAgentResume(model, sessionId, resumePrompt, timeoutMinutes);
        
        // 更新 session_id（可能更新）
        if (result.sessionId) {
          sessionId = result.sessionId;
          logStep(12, `更新 session_id: ${sessionId}`);
        }
      }

      // 检查运行时错误
      if (result.exitCode !== 0 || result.stderr) {
        logStep(12, `检测到运行时错误: 退出码 ${result.exitCode}`);
        const fullError = `运行时错误: 退出码 ${result.exitCode}\n${result.stderr || "无错误输出"}\n\n标准输出:\n${result.stdout}`;
        errorMessage = fullError.substring(0, 200);
        finalStatus = "error";
        executions.push({
          index: attempts,
          durationMs: result.durationMs,
          conclusion: "运行时错误",
          notes: [fullError.substring(0, 500) + (fullError.length > 500 ? "..." : "")],
        });
        break;
      }

      // 进行语义判定
      logStep(12, "进行语义判定");
      const executionSummary = result.stdout.substring(0, 5000);
      const semanticsResult = await interpretSemanticsViaLLM(judgeModel, executionSummary);
      
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

      // 根据结果处理
      if (semanticsResult.result === "done") {
        logStep(12, "任务已完成");
        finalStatus = "done";
        needsContinue = false;
        break;
      } else {
        // resume 或 auto：标记需要继续
        needsContinue = true;
        logStep(12, `需要继续执行 (${semanticsResult.result})`);
      }
    } catch (err) {
      logStep(12, `执行出错: ${err.message}`);
      errorMessage = err.message;
      finalStatus = "error";
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
    logStep(12, `达到重试上限(${retry}),标记为部分完成`);
    finalStatus = "partial";
  }

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
