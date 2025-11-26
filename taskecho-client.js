#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const http = require("http");
const https = require("https");

/**
 * TaskEcho 客户端类
 */
class TaskEchoClient {
  constructor() {
    this.projectIdFile = path.join(".flow", ".taskecho_project_id");
  }

  /**
   * 获取 API URL（动态读取环境变量）
   * @returns {string}
   */
  getApiUrl() {
    return process.env.TASKECHO_API_URL || "http://localhost:3000";
  }

  /**
   * 获取 API Key（动态读取环境变量）
   * @returns {string}
   */
  getApiKey() {
    return process.env.TASKECHO_API_KEY || "";
  }

  /**
   * 检查是否启用 TaskEcho（动态读取环境变量）
   * @returns {boolean}
   */
  isEnabled() {
    const enabledValue = (process.env.TASKECHO_ENABLED || "").toLowerCase();
    const enabled = enabledValue === "true" || enabledValue === "1" || enabledValue === "yes";
    const apiKey = this.getApiKey();
    return enabled && apiKey.length > 0;
  }

  /**
   * 获取或创建项目 UUID
   * @returns {Promise<string>} 项目 UUID
   */
  async getOrCreateProjectId() {
    try {
      if (fs.existsSync(this.projectIdFile)) {
        const config = JSON.parse(await fsp.readFile(this.projectIdFile, "utf8"));
        if (config.project_id) {
          return config.project_id;
        }
      }
    } catch (err) {
      // 文件读取失败，继续创建新的 UUID
    }

    // 创建新的 UUID
    const projectId = randomUUID();
    try {
      await fsp.mkdir(path.dirname(this.projectIdFile), { recursive: true });
      await fsp.writeFile(
        this.projectIdFile,
        JSON.stringify({ project_id: projectId }, null, 2),
        "utf8"
      );
    } catch (err) {
      // 写入失败，但仍然返回 UUID
    }

    return projectId;
  }

  /**
   * 获取客户端信息
   * @returns {Object} 客户端信息对象
   */
  _getClientInfo() {
    const username = os.userInfo().username;
    const hostname = os.hostname();
    let projectPath = process.cwd();

    // 将绝对路径转换为 ~ 缩写
    const home = os.homedir();
    if (projectPath.startsWith(home)) {
      projectPath = projectPath.replace(home, "~");
    }

    return {
      username: username,
      hostname: hostname,
      project_path: projectPath,
    };
  }

  /**
   * 获取项目信息
   * @returns {Promise<Object>} 项目信息对象
   */
  async getProjectInfo() {
    const projectId = await this.getOrCreateProjectId();
    const projectName = path.basename(process.cwd());
    const clientInfo = this._getClientInfo();

    return {
      project_id: projectId,
      project_name: projectName,
      clientInfo: clientInfo,
    };
  }

  /**
   * 从文件路径提取队列信息
   * @param {string} taskFilePath - 任务文件路径
   * @param {Object} taskFile - 任务文件对象（包含 prompts）
   * @returns {Object} 队列信息对象
   */
  getQueueInfo(taskFilePath, taskFile) {
    const fileName = path.basename(taskFilePath);
    const queueId = fileName;
    const queueName = fileName;

    return {
      queue_id: queueId,
      queue_name: queueName,
      meta: {
        prompts: taskFile.prompts || [],
      },
    };
  }

  /**
   * 路径标准化（将绝对路径转换为 ~ 缩写）
   * @param {string} filePath - 文件路径
   * @returns {string} 标准化后的路径
   */
  _normalizePath(filePath) {
    if (!filePath) return filePath;
    const home = os.homedir();
    if (filePath.startsWith(home)) {
      return filePath.replace(home, "~");
    }
    return filePath;
  }

  /**
   * 任务数据转换（转换为 API 格式）
   * @param {Object[]} tasks - 任务数组
   * @returns {Object[]} 转换后的任务数组
   */
  _transformTasks(tasks) {
    return tasks.map((task) => ({
      id: task.id,
      name: task.name,
      prompt: task.prompt || "",
      spec_file: task.spec_file || null,
      status: task.status || "pending",
      report: task.report || null,
      messages: task.messages || [],
      logs: task.logs || [],
    }));
  }

  /**
   * HTTP 请求封装
   * @param {string} method - HTTP 方法
   * @param {string} url - 请求 URL
   * @param {Object} headers - 请求头
   * @param {Object|string} data - 请求数据
   * @returns {Promise<Object>} 响应数据
   */
  async _httpRequest(method, url, headers, data) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === "https:";
      const client = isHttps ? https : http;

      const payload = data ? JSON.stringify(data) : "";
      const requestHeaders = {
        "Content-Type": "application/json",
        "X-API-Key": this.getApiKey(),
        ...headers,
      };

      if (payload) {
        requestHeaders["Content-Length"] = Buffer.byteLength(payload);
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: requestHeaders,
        timeout: 10000, // 10 秒超时
      };

      // 如果 API Key 为空，抛出错误
      if (!this.getApiKey()) {
        reject(new Error("TASKECHO_API_KEY 未设置"));
        return;
      }

      const req = client.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          try {
            const result = JSON.parse(responseData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(result);
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode}: ${result.error?.message || result.message || "请求失败"}`
                )
              );
            }
          } catch (err) {
            reject(new Error(`解析响应失败: ${err.message}`));
          }
        });
      });

      req.on("error", (err) => {
        reject(new Error(`请求失败: ${err.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("请求超时"));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * 提交队列到 TaskEcho
   * @param {Object} projectInfo - 项目信息
   * @param {Object} queueInfo - 队列信息
   * @param {Object} taskFile - 任务文件对象
   * @returns {Promise<Object>} 响应数据
   */
  async submitQueue(projectInfo, queueInfo, taskFile) {
    if (!this.isEnabled()) {
      throw new Error("TaskEcho 未启用");
    }

    try {
      const transformedTasks = this._transformTasks(taskFile.tasks || []);

      const payload = {
        project_id: projectInfo.project_id,
        project_name: projectInfo.project_name,
        clientInfo: projectInfo.clientInfo,
        queue_id: queueInfo.queue_id,
        queue_name: queueInfo.queue_name,
        meta: queueInfo.meta,
        tasks: transformedTasks,
      };

      const url = `${this.getApiUrl()}/api/v1/submit`;
      return await this._httpRequest("POST", url, {}, payload);
    } catch (err) {
      throw new Error(`TaskEcho 提交队列失败: ${err.message}`);
    }
  }

  /**
   * 追加消息到任务
   * @param {string} projectId - 项目 ID
   * @param {string} queueId - 队列 ID
   * @param {string} taskId - 任务 ID
   * @param {string} role - 消息角色（user 或 assistant）
   * @param {string} content - 消息内容
   * @param {string|null} sessionId - 对话会话ID（可选）
   * @returns {Promise<Object>} 响应数据
   */
  async addMessage(projectId, queueId, taskId, role, content, sessionId = null) {
    if (!this.isEnabled()) {
      throw new Error("TaskEcho 未启用");
    }

    try {
      const payload = {
        project_id: projectId,
        queue_id: queueId,
        task_id: taskId,
        role: role.toLowerCase(),
        content: content,
      };

      // 如果提供了 sessionId，添加到请求体中
      if (sessionId) {
        payload.session_id = sessionId;
      }

      const url = `${this.getApiUrl()}/api/v1/tasks/message`;
      return await this._httpRequest("POST", url, {}, payload);
    } catch (err) {
      throw new Error(`TaskEcho 追加消息失败: ${err.message}`);
    }
  }

  /**
   * 追加执行日志到任务
   * @param {string} projectId - 项目 ID
   * @param {string} queueId - 队列 ID
   * @param {string} taskId - 任务 ID
   * @param {string} content - 日志内容
   * @returns {Promise<Object>} 响应数据
   */
  async addLog(projectId, queueId, taskId, content) {
    if (!this.isEnabled()) {
      throw new Error("TaskEcho 未启用");
    }

    try {
      const payload = {
        project_id: projectId,
        queue_id: queueId,
        task_id: taskId,
        content: content,
      };

      const url = `${this.getApiUrl()}/api/v1/tasks/log`;
      return await this._httpRequest("POST", url, {}, payload);
    } catch (err) {
      throw new Error(`TaskEcho 追加日志失败: ${err.message}`);
    }
  }

  /**
   * 更新任务状态
   * @param {string} projectId - 项目 ID
   * @param {string} queueId - 队列 ID
   * @param {string} taskId - 任务 ID
   * @param {string} status - 任务状态（pending、done、error）
   * @returns {Promise<Object>} 响应数据
   */
  async updateStatus(projectId, queueId, taskId, status) {
    if (!this.isEnabled()) {
      throw new Error("TaskEcho 未启用");
    }

    try {
      const payload = {
        project_id: projectId,
        queue_id: queueId,
        task_id: taskId,
        status: status.toLowerCase(),
      };

      const url = `${this.getApiUrl()}/api/v1/tasks/status`;
      return await this._httpRequest("PATCH", url, {}, payload);
    } catch (err) {
      throw new Error(`TaskEcho 更新状态失败: ${err.message}`);
    }
  }
}

// 导出单例实例
module.exports = new TaskEchoClient();

