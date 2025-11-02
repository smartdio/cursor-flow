#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");

// 全局标志：标记浏览器是否已关闭
let browserClosed = false;

// 日志输出函数（输出到 stderr，避免影响 stdout）
function log(message, ...args) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;
  console.error(prefix, message, ...args);
}

function logStep(step, message, ...args) {
  log(`[步骤 ${step}]`, message, ...args);
}

/**
 * 关闭 MCP 浏览器
 * 尝试关闭所有相关的浏览器进程
 */
async function closeMCPBrowser() {
  logStep(9, "开始关闭 MCP 浏览器");

  try {
    // 尝试通过 MCP chrome-devtools 的方式关闭
    // 首先尝试查找并关闭相关的浏览器进程
    const browserProcessNames = [
      "chrome",
      "chromium",
      "google-chrome",
      "Google Chrome",
      "Chromium",
    ];

    let closedAny = false;

    // 在 macOS/Linux 上使用 ps 和 kill
    if (process.platform === "darwin" || process.platform === "linux") {
      for (const browserName of browserProcessNames) {
        try {
          // 查找进程
          const psResult = spawnSync("ps", ["aux"], { encoding: "utf8" });
          if (psResult.stdout) {
            const lines = psResult.stdout.split("\n");
            const browserProcesses = lines.filter(
              (line) =>
                line.includes(browserName) &&
                (line.includes("--remote-debugging-port") ||
                  line.includes("chromedriver") ||
                  line.includes("headless"))
            );

            for (const processLine of browserProcesses) {
              const parts = processLine.trim().split(/\s+/);
              if (parts.length > 1) {
                const pid = parts[1];
                if (pid && /^\d+$/.test(pid)) {
                  try {
                    spawnSync("kill", ["-9", pid], { encoding: "utf8" });
                    logStep(9, `已关闭浏览器进程 PID: ${pid}`);
                    closedAny = true;
                  } catch (e) {
                    // 忽略错误，进程可能已经关闭
                  }
                }
              }
            }
          }
        } catch (e) {
          // 忽略错误，继续尝试其他方法
        }
      }
    }

    // 尝试通过 pkill 命令（如果在 Linux/macOS 上可用）
    if (process.platform === "darwin" || process.platform === "linux") {
      try {
        // 查找带有 MCP 相关标志的 Chrome 进程
        const pkillResult = spawnSync(
          "pkill",
          ["-f", "--remote-debugging-port"],
          { encoding: "utf8" }
        );
        if (pkillResult.status === 0) {
          logStep(9, "通过 pkill 关闭了浏览器进程");
          closedAny = true;
        }
      } catch (e) {
        // pkill 可能不存在或失败，忽略
      }
    }

    if (!closedAny) {
      logStep(9, "未找到需要关闭的浏览器进程，或浏览器已关闭");
    } else {
      logStep(9, "浏览器关闭操作完成");
    }
  } catch (err) {
    logStep(9, `关闭浏览器时出错: ${err.message}`);
    // 不抛出错误，确保脚本能正常退出
  }
}

function printUsage() {
  const text = `用法:
  cursor-agent-task.js [-s "系统提示词"] [-p "提示词"] [-f 提示词文件(可多次)] [-- 其他参数]

参数:
  -s, --system   系统提示词（可选）
  -p, --prompt   普通提示词（可选，可与 -f 同时使用）
  -f, --file     从文件读取提示词（可多次；可与 -p 同时使用；传 - 表示从 stdin 读取）
  -m, --model    指定 cursor-agent 模型名称（默认: auto）
  -h, --help     显示帮助

说明:
  - 若提供系统提示词，则按 "系统提示词 + 两个换行 + 普通提示词" 合并；若未提供，则仅使用普通提示词。
  - 多个 --file 时，按传入顺序拼接内容，文件之间以两个换行分隔。
  - 若同时提供 -p 和 -f，合并顺序为：先合并所有 -f 文件内容，最后追加 -p 内容（之间用两个换行分隔）。
  - 脚本将尝试自动探测 cursor-agent 的可用调用方式:
      1) cursor-agent --prompt "..."
      2) cursor-agent run --prompt "..."
      3) cursor-agent --file tmpfile
      4) 回退: 通过管道将合并后的提示词写入 cursor-agent 标准输入
  - 可在 "--" 之后追加要透传给 cursor-agent 的其他参数。`;
  console.log(text);
}

function parseArgs(argv) {
  const state = {
    prompt: "",
    promptFiles: [],
    systemPrompt: "",
    model: "auto",
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
  // 关闭浏览器（使用异步但不等待，因为即将退出）
  closeMCPBrowser()
    .then(() => {
      browserClosed = true;
      process.exit(code);
    })
    .catch(() => {
      browserClosed = true;
      process.exit(code);
    });
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

function hasPromptLong(helpText) {
  return helpText.includes("--prompt");
}

function hasPromptShort(helpText) {
  return /(^|\s)-p([\s,=]|$)/.test(helpText);
}

function hasRunAndPrompt(helpText) {
  return /\brun\b/.test(helpText) && helpText.includes("--prompt");
}

function hasFileOption(helpText) {
  return /(\s--file\b|\s-f\b)/.test(helpText);
}

function hasStreamFlag(helpText) {
  return helpText.includes("--stream-partial-output");
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
 *   }
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
 */
function pipeThroughAssistantFilter(stream, onEnd) {
  logStep(7, "初始化流式输出过滤器");

  let printedAny = false;
  let rawBuffer = ""; // 原始数据缓冲
  let chunkCount = 0;
  let lastOutput = ""; // 记录上次输出的完整内容，用于流式输出的增量提取

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

          // 如果提取到内容，处理流式输出的增量更新
          if (extracted && extracted !== "null" && extracted.length > 0) {
            // cursor-agent 流式输出通常是累积式的：每个 JSON 包含完整的累积内容
            // 如果新内容以旧内容开头，说明是增量更新，只输出新增部分
            if (extracted.startsWith(lastOutput)) {
              // 增量更新：只输出新增的部分
              const newPart = extracted.slice(lastOutput.length);
              if (newPart.length > 0) {
                process.stdout.write(newPart, "utf8");
                printedAny = true;
                lastOutput = extracted; // 更新记录的完整内容
              }
            } else if (extracted !== lastOutput) {
              // 内容完全不一样（这种情况很少），输出全部
              process.stdout.write(extracted, "utf8");
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
            if (extracted && extracted !== "null" && extracted.length > 0) {
              process.stdout.write(extracted, "utf8");
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
      process.stdout.write("\n");
    }

    // 仅在DEBUG模式下输出统计信息
    if (process.env.DEBUG === "1") {
      logStep(7, `流式处理完成: 接收 ${chunkCount} 个数据块`);
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
  logStep(1, "参数解析完成:", {
    model: args.model,
    hasPrompt: !!args.prompt,
    promptFilesCount: args.promptFiles.length,
    hasSystemPrompt: !!args.systemPrompt,
    positionalArgsCount: args.positional.length,
  });

  if (!args.prompt && args.promptFiles.length === 0) {
    die(2, "错误: 必须提供 --prompt 或 --file 其中之一");
  }

  const userPrompt = await buildUserPrompt(args.prompt, args.promptFiles);

  logStep(4, "合并提示词");
  const combinedPrompt = args.systemPrompt
    ? `${args.systemPrompt}\n\n${userPrompt}`
    : userPrompt;
  logStep(4, "提示词合并完成，总长度:", combinedPrompt.length, "字符");

  const helpText = ensureCursorAgentInstalled();

  logStep(5, "探测 cursor-agent 支持的调用方式");
  const streamPartial = hasStreamFlag(helpText);
  logStep(5, "流式输出支持:", streamPartial ? "是" : "否");

  let tmpfile = "";
  let runArgs = [];
  let useStdinFallback = false;
  let callMethod = "";

  logStep(6, "选择 cursor-agent 调用方式");
  if (hasPromptLong(helpText)) {
    // cursor-agent -p --model <model> --force --print [--stream-partial-output] --prompt <text>
    callMethod = "方法1: --prompt 长选项";
    runArgs = ["-p", "--model", args.model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
    runArgs.push("--prompt", combinedPrompt);
  } else if (hasPromptShort(helpText)) {
    // cursor-agent --model <model> --force --print [--stream-partial-output] -p <text>
    callMethod = "方法2: -p 短选项";
    runArgs = ["--model", args.model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
    runArgs.push("-p", combinedPrompt);
  } else if (hasRunAndPrompt(helpText)) {
    // cursor-agent -p --model <model> --force --print [--stream-partial-output] run --prompt <text>
    callMethod = "方法3: run --prompt";
    runArgs = ["-p", "--model", args.model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
    runArgs.push("run", "--prompt", combinedPrompt);
  } else if (hasFileOption(helpText)) {
    // cursor-agent -p --model <model> --force --print [--stream-partial-output] --file <tmpfile>
    callMethod = "方法4: --file 临时文件";
    const name = `cursor_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
    tmpfile = path.join(os.tmpdir(), name);
    logStep(6, `创建临时文件: ${tmpfile}`);
    await fsp.writeFile(tmpfile, combinedPrompt, "utf8");
    logStep(6, "临时文件写入完成");
    runArgs = ["-p", "--model", args.model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
    runArgs.push("--file", tmpfile);
  } else {
    // 回退: 通过 stdin 传递
    callMethod = "方法5: stdin 回退模式";
    useStdinFallback = true;
    runArgs = ["-p", "--model", args.model, "--force", "--print"];
    if (streamPartial) runArgs.push("--stream-partial-output");
  }
  logStep(6, `选择的调用方式: ${callMethod}`);

  // 检查是否已经包含 --output-format 参数
  // 检查 positional 参数中是否有 --output-format 或其变体
  const hasOutputFormat = args.positional.some((arg, idx) => {
    // 检查 --output-format 或 --output-format=xxx 格式
    if (arg === "--output-format" || arg.startsWith("--output-format=")) {
      return true;
    }
    // 检查前一个参数是否是 --output-format（说明下一个参数是值）
    if (idx > 0 && args.positional[idx - 1] === "--output-format") {
      return true;
    }
    return false;
  });

  // 如果没有指定 --output-format，添加默认值 stream-json
  if (!hasOutputFormat) {
    logStep(6, "添加默认参数: --output-format stream-json");
    runArgs.push("--output-format", "stream-json");
  } else {
    logStep(6, "检测到用户已指定 --output-format 参数，使用用户指定的值");
  }

  // 追加透传参数
  if (args.positional.length > 0) {
    logStep(6, `追加透传参数: ${args.positional.join(" ")}`);
    runArgs = runArgs.concat(args.positional);
  }

  logStep(6, "完整命令参数:", runArgs.join(" "));

  logStep(7, "启动 cursor-agent 子进程");
  // 设置编码并创建子进程
  const child = spawn("cursor-agent", runArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
  logStep(7, "子进程已启动，PID:", child.pid);

  // 设置 stdout/stderr 编码
  if (child.stdout) child.stdout.setEncoding("utf8");
  if (child.stderr) child.stderr.setEncoding("utf8");

  let exitHandled = false;
  const cleanup = async () => {
    if (tmpfile) {
      logStep(8, `清理临时文件: ${tmpfile}`);
      try {
        await fsp.unlink(tmpfile);
        logStep(8, "临时文件已删除");
      } catch (_) {
        logStep(8, "删除临时文件失败（可能已不存在）");
      }
    }
  };

  // 处理 stderr（错误输出直接透传）
  child.stderr.on("data", (d) => {
    process.stderr.write(d);
  });

  // 处理 stdin：只在 fallback 模式下写入数据，否则直接关闭
  logStep(
    7,
    `stdin 处理: ${useStdinFallback ? "写入提示词并关闭" : "直接关闭"}`
  );
  if (useStdinFallback) {
    // 通过 stdin 写入合并后的提示词
    child.stdin.write(combinedPrompt + "\n", "utf8");
    child.stdin.end();
    logStep(7, "stdin 提示词已写入并关闭");
  } else {
    // 非 fallback 模式：直接关闭 stdin，避免 cursor-agent 等待输入
    child.stdin.end();
    logStep(7, "stdin 已关闭");
  }

  // 处理 stdout：根据是否启用流式输出选择不同的处理方式
  if (streamPartial) {
    logStep(7, "启用流式输出过滤模式");
    // 流式模式：使用过滤函数提取 assistant 文本
    pipeThroughAssistantFilter(child.stdout, () => {
      logStep(7, "流式输出过滤完成（readline 关闭）");
      // stdout 流式过滤完成（readline 关闭）
      // 注意：这里不退出，等待子进程的 close 事件
    });
  } else {
    logStep(7, "使用非流式模式（直接透传输出）");
    // 非流式模式：直接透传输出
    let outputSize = 0;
    child.stdout.on("data", (d) => {
      outputSize += d.length;
      process.stdout.write(d);
    });
    child.stdout.on("end", () => {
      logStep(7, `stdout 流结束，总输出大小: ${outputSize} 字节`);
      // stdout 结束时确保输出刷新
      // 注意：这里不退出，等待子进程的 close 事件
    });
  }

  // 子进程关闭事件（统一处理退出逻辑）
  child.on("close", async (code) => {
    if (exitHandled) return;
    exitHandled = true;
    logStep(8, `子进程已关闭，退出码: ${code ?? 0}`);
    await cleanup();
    // 关闭浏览器
    await closeMCPBrowser();
    browserClosed = true;
    // 确保 stdout 刷新
    process.stdout.write("");
    log("=".repeat(60));
    log("脚本执行完成");
    log("=".repeat(60));
    process.exit(code ?? 0);
  });

  // 子进程错误事件
  child.on("error", async (err) => {
    if (exitHandled) return;
    exitHandled = true;
    logStep(8, `子进程错误: ${String((err && err.message) || err)}`);
    await cleanup();
    // 关闭浏览器
    await closeMCPBrowser();
    browserClosed = true;
    console.error(
      `错误: 执行 cursor-agent 失败: ${String((err && err.message) || err)}`
    );
    process.exit(1);
  });
}

// 注册进程退出处理程序，确保任何时候退出都关闭浏览器
process.on("exit", () => {
  if (!browserClosed) {
    // exit 事件不支持异步操作，使用同步方式关闭浏览器
    try {
      // 尝试同步关闭浏览器进程
      if (process.platform === "darwin" || process.platform === "linux") {
        try {
          spawnSync("pkill", ["-f", "--remote-debugging-port"], {
            encoding: "utf8",
            timeout: 1000,
          });
        } catch (e) {
          // 忽略错误
        }
      }
    } catch (e) {
      // 忽略所有错误，确保能正常退出
    }
  }
});

// 处理未捕获的异常
process.on("uncaughtException", async (err) => {
  console.error("未捕获的异常:", err);
  await closeMCPBrowser();
  browserClosed = true;
  process.exit(1);
});

// 处理未处理的 Promise 拒绝
process.on("unhandledRejection", async (reason, promise) => {
  console.error("未处理的 Promise 拒绝:", reason);
  await closeMCPBrowser();
  browserClosed = true;
  process.exit(1);
});

main().catch(async (err) => {
  await closeMCPBrowser();
  browserClosed = true;
  console.error(`错误: 脚本执行失败: ${String((err && err.message) || err)}`);
  process.exit(1);
});
