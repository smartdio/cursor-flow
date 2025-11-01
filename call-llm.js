#!/usr/bin/env node
"use strict";

const https = require("https");
const http = require("http");
const { URL } = require("url");

// ============================================================================
// 命令行参数解析
// ============================================================================

function parseArgs(argv) {
  const config = {
    prompt: null,      // 系统提示词
    content: null,    // 用户内容
    format: "text",   // 输出格式: "json" 或 "text"
    apiKey: null,     // API Key
    baseUrl: null,    // API 基础 URL
    model: null,      // 模型名称
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--prompt" || arg === "-p") && i + 1 < argv.length) {
      config.prompt = argv[++i];
    } else if ((arg === "--content" || arg === "-c") && i + 1 < argv.length) {
      config.content = argv[++i];
    } else if ((arg === "--format" || arg === "-f") && i + 1 < argv.length) {
      const format = argv[++i].toLowerCase();
      if (format !== "json" && format !== "text") {
        console.error(`错误: --format 必须是 "json" 或 "text"，当前为: ${format}`);
        process.exit(1);
      }
      config.format = format;
    } else if ((arg === "--api-key" || arg === "-k") && i + 1 < argv.length) {
      config.apiKey = argv[++i];
    } else if ((arg === "--baseurl" || arg === "-b") && i + 1 < argv.length) {
      config.baseUrl = argv[++i];
    } else if ((arg === "--model" || arg === "-m") && i + 1 < argv.length) {
      config.model = argv[++i];
    } else if (arg === "-h" || arg === "--help") {
      config.help = true;
    } else if (arg.startsWith("-")) {
      console.error(`错误: 未知参数: ${arg}`);
      console.error("使用 --help 查看帮助信息");
      process.exit(1);
    }
  }

  return config;
}

function printHelp() {
  const text = `用法:
  call-llm [选项]

选项:
  -p, --prompt <text>        系统提示词
  -c, --content <text>       用户内容（必需）
  -f, --format <json|text>  返回格式（默认: text）
                               json: 提取并格式化 message.content 中的 JSON 内容
                               text: 直接输出 message.content 的原始文本
  -m, --model <model>        模型名称（必需）
  -k, --api-key <key>        API Key（或使用环境变量 OPENAI_API_KEY）
  -b, --baseurl <url>        API 基础 URL（或使用环境变量 OPENAI_API_BASE，默认: https://api.openai.com/v1）
  -h, --help                显示帮助信息

环境变量:
  OPENAI_API_KEY         API Key（如果未通过 --api-key 提供）
  OPENAI_API_BASE        API 基础 URL（如果未通过 --baseurl 提供）

示例:
  # 基本调用
  call-llm -m gpt-4 -c "请解释什么是 RESTful API"
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
`;
  console.log(text);
}

// ============================================================================
// API 调用
// ============================================================================

/**
 * 调用 OpenAI 兼容 API
 * @param {Object} config - 配置对象
 * @returns {Promise<Object>} API 响应
 */
function callOpenAIAPI(config) {
  return new Promise((resolve, reject) => {
    // 构建请求体
    const messages = [];
    if (config.prompt) {
      messages.push({
        role: "system",
        content: config.prompt,
      });
    }
    messages.push({
      role: "user",
      content: config.content,
    });

    const requestBody = JSON.stringify({
      model: config.model,
      messages: messages,
      temperature: 0.7,
    });

    // 解析 URL
    const apiUrl = config.baseUrl || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    let urlObj;
    try {
      urlObj = new URL(apiUrl);
    } catch (err) {
      reject(new Error(`无效的 API URL: ${apiUrl}`));
      return;
    }

    // 规范化 pathname：去掉末尾斜杠，确保以 /v1 结尾
    let pathname = urlObj.pathname.replace(/\/$/, ""); // 去掉末尾斜杠
    if (!pathname.endsWith("/v1")) {
      // 如果路径为空或不是 /v1，则添加 /v1
      pathname = pathname + (pathname === "" ? "/v1" : "/v1");
    }

    const path = pathname + "/chat/completions";
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        Authorization: `Bearer ${config.apiKey || process.env.OPENAI_API_KEY || ""}`,
      },
    };

    if (!options.headers.Authorization.includes("Bearer ") || options.headers.Authorization === "Bearer ") {
      reject(new Error("API Key 未提供。请使用 --api-key 参数或设置 OPENAI_API_KEY 环境变量"));
      return;
    }

    // 选择 HTTP 模块
    const httpModule = urlObj.protocol === "https:" ? https : http;

    // 发送请求
    const req = httpModule.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errorMsg = `API 请求失败 (状态码: ${res.statusCode})`;
          try {
            const errorObj = JSON.parse(responseData);
            if (errorObj.error && errorObj.error.message) {
              errorMsg += `: ${errorObj.error.message}`;
            }
          } catch (e) {
            errorMsg += `: ${responseData.substring(0, 200)}`;
          }
          reject(new Error(errorMsg));
          return;
        }

        try {
          const response = JSON.parse(responseData);
          resolve(response);
        } catch (err) {
          reject(new Error(`响应解析失败: ${err.message}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`请求失败: ${err.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    req.write(requestBody);
    req.end();
  });
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // 验证必需参数
  if (!args.content) {
    console.error("错误: --content 参数是必需的");
    console.error("使用 --help 查看帮助信息");
    process.exit(1);
  }

  if (!args.model) {
    console.error("错误: --model 参数是必需的");
    console.error("使用 --help 查看帮助信息");
    process.exit(1);
  }

  try {
    // 调用 API
    const response = await callOpenAIAPI(args);

    // 提取 message.content
    if (!response.choices || response.choices.length === 0) {
      console.error("错误: API 响应格式异常");
      console.error(JSON.stringify(response, null, 2));
      process.exit(1);
    }

    const content = response.choices[0].message?.content;
    if (!content) {
      console.error("错误: API 响应中没有找到内容");
      console.error(JSON.stringify(response, null, 2));
      process.exit(1);
    }

    // 根据格式输出
    if (args.format === "json") {
      // JSON 格式：提取并解析 content 中的 JSON
      try {
        // 尝试提取 markdown 代码块中的 JSON
        let jsonText = content.trim();
        
        // 匹配 ```json ... ``` 或 ``` ... ``` 格式
        const jsonBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonBlockMatch) {
          jsonText = jsonBlockMatch[1].trim();
        }
        
        // 尝试解析 JSON
        const jsonObj = JSON.parse(jsonText);
        // 格式化输出 JSON
        console.log(JSON.stringify(jsonObj, null, 2));
      } catch (parseErr) {
        // 如果解析失败，尝试直接查找 JSON 对象
        try {
          // 尝试找到第一个 { ... } 或 [ ... ] 的 JSON 结构
          const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
          if (jsonMatch) {
            const jsonObj = JSON.parse(jsonMatch[1]);
            console.log(JSON.stringify(jsonObj, null, 2));
          } else {
            // 如果找不到 JSON，输出原始内容
            console.log(content);
          }
        } catch (e) {
          // 如果都失败了，输出原始内容
          console.log(content);
        }
      }
    } else {
      // 文本格式：直接输出原始内容
      console.log(content);
    }
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { callOpenAIAPI, parseArgs };

