#!/usr/bin/env node

/**
 * Playwright 页面截图脚本
 * 
 * 用途：供 Agent 调用，对指定路由进行截图
 * 
 * 使用方法：
 *   node scripts/screenshot-page.js --route=/parks --output=doc/user-manual/parks/screenshots/parks_01.png
 *   node scripts/screenshot-page.js --route=/parks/[id] --id=1 --waitFor=.stats-cards --fullPage
 * 
 * 参数说明：
 *   --route: 页面路由（必需）
 *   --baseUrl: 应用基础URL（默认：http://localhost:3000）
 *   --output: 截图保存路径（必需）
 *   --waitFor: 等待元素选择器（可选，多个用逗号分隔）
 *   --fullPage: 是否全页面截图（默认：true）
 *   --viewport: 视口尺寸，格式：1920x1080（默认：1920x1080）
 *   --timeout: 页面加载超时时间，毫秒（默认：30000）
 *   --id: 动态路由参数值（如 /parks/[id] 需要提供 id=1）
 *   --storageState: 登录状态文件路径（默认：.playwright/auth.json）
 *   --headless: 是否无头模式（默认：true）
 *   --retries: 重试次数（默认：2）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    route: null,
    baseUrl: 'http://localhost:3000',
    output: null,
    waitFor: null,
    fullPage: true,
    viewport: { width: 1920, height: 1080 },
    timeout: 30000,
    dynamicParams: {},
    storageState: '.playwright/auth.json',
    headless: true,
    retries: 2,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--route=')) {
      config.route = arg.split('=')[1];
    } else if (arg.startsWith('--baseUrl=')) {
      config.baseUrl = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      config.output = arg.split('=')[1];
    } else if (arg.startsWith('--waitFor=')) {
      config.waitFor = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg === '--fullPage') {
      config.fullPage = true;
    } else if (arg === '--no-fullPage') {
      config.fullPage = false;
    } else if (arg.startsWith('--viewport=')) {
      const [width, height] = arg.split('=')[1].split('x').map(Number);
      config.viewport = { width, height };
    } else if (arg.startsWith('--timeout=')) {
      config.timeout = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--id=')) {
      config.dynamicParams.id = arg.split('=')[1];
    } else if (arg.startsWith('--storageState=')) {
      config.storageState = arg.split('=')[1];
    } else if (arg === '--headless') {
      config.headless = true;
    } else if (arg === '--no-headless') {
      config.headless = false;
    } else if (arg.startsWith('--retries=')) {
      config.retries = parseInt(arg.split('=')[1]);
    }
  }

  // 必需参数检查
  if (!config.route) {
    console.error('错误：--route 参数是必需的');
    process.exit(1);
  }
  if (!config.output) {
    console.error('错误：--output 参数是必需的');
    process.exit(1);
  }

  return config;
}

// 解析动态路由参数
function resolveRoute(route, dynamicParams) {
  let resolvedRoute = route;
  
  // 替换 [id] 等动态参数
  Object.keys(dynamicParams).forEach(key => {
    const placeholder = `[${key}]`;
    if (resolvedRoute.includes(placeholder)) {
      resolvedRoute = resolvedRoute.replace(placeholder, dynamicParams[key]);
    }
  });

  return resolvedRoute;
}

// 确保目录存在
function ensureDir(dirPath) {
  const dir = path.dirname(dirPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 等待页面加载完成
async function waitForPageReady(page, waitForSelectors, timeout) {
  // 1. 等待网络空闲
  await page.waitForLoadState('networkidle', { timeout });

  // 2. 如果指定了等待选择器，等待这些元素出现
  if (waitForSelectors && waitForSelectors.length > 0) {
    for (const selector of waitForSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
      } catch (e) {
        console.warn(`警告：等待选择器 "${selector}" 超时，继续执行`);
      }
    }
  }

  // 3. 等待加载动画消失（通用选择器）
  const loadingSelectors = [
    '.loading',
    '.spinner',
    '[data-loading="true"]',
    '.skeleton',
  ];
  
  for (const selector of loadingSelectors) {
    try {
      await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 }).catch(() => {});
    } catch (e) {
      // 忽略，可能不存在
    }
  }

  // 4. 额外等待一小段时间，确保 React 组件渲染完成
  await page.waitForTimeout(500);
}

// 执行截图
async function takeScreenshot(config) {
  const browser = await chromium.launch({ headless: config.headless });
  
  try {
    // 创建浏览器上下文
    const contextOptions = {
      viewport: config.viewport,
    };

    // 如果存在登录状态文件，使用它
    if (fs.existsSync(config.storageState)) {
      contextOptions.storageState = config.storageState;
      console.log(`使用已保存的登录状态：${config.storageState}`);
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // 解析路由（替换动态参数）
    const resolvedRoute = resolveRoute(config.route, config.dynamicParams);
    const fullUrl = `${config.baseUrl}${resolvedRoute}`;
    
    console.log(`访问页面：${fullUrl}`);

    // 导航到页面
    await page.goto(fullUrl, {
      waitUntil: 'networkidle',
      timeout: config.timeout,
    });

    // 等待页面就绪
    await waitForPageReady(page, config.waitFor, config.timeout);

    // 确保输出目录存在
    ensureDir(config.output);

    // 执行截图
    console.log(`截图保存到：${config.output}`);
    await page.screenshot({
      path: config.output,
      fullPage: config.fullPage,
    });

    console.log(`✅ 截图成功：${config.output}`);
    
    await browser.close();
    return { success: true, output: config.output };
  } catch (error) {
    await browser.close();
    console.error(`❌ 截图失败：${error.message}`);
    return { success: false, error: error.message };
  }
}

// 主函数（带重试）
async function main() {
  const config = parseArgs();
  
  console.log('='.repeat(60));
  console.log('Playwright 页面截图脚本');
  console.log('='.repeat(60));
  console.log(`路由：${config.route}`);
  console.log(`基础URL：${config.baseUrl}`);
  console.log(`输出路径：${config.output}`);
  console.log(`全页面截图：${config.fullPage}`);
  console.log(`视口尺寸：${config.viewport.width}x${config.viewport.height}`);
  console.log(`超时时间：${config.timeout}ms`);
  console.log(`重试次数：${config.retries}`);
  console.log('='.repeat(60));

  let lastError = null;
  
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    if (attempt > 0) {
      console.log(`\n重试第 ${attempt} 次...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒后重试
    }

    const result = await takeScreenshot(config);
    
    if (result.success) {
      process.exit(0);
    } else {
      lastError = result.error;
    }
  }

  console.error(`\n❌ 所有重试均失败：${lastError}`);
  process.exit(1);
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    console.error('未处理的错误：', error);
    process.exit(1);
  });
}

// 导出函数供其他模块使用
module.exports = { takeScreenshot, parseArgs, resolveRoute };

