# 处理用户手册截图

- 根据列出的路由列表，处理截图
- 在处理过程中，如果需要获取动态参数，则需要从已访问页面或创建操作中获取
- 在处理过程中，如果需要更新文档，则需要更新文档中的占位符为实际截图路径
- 在处理过程中，如果需要继续下一个路由，则需要继续下一个路由
- 每个路由都对应一个说明文件， doc/user-manual/{module}/{序号}_{页面名}.md , 文件中有一个或多个占位图，根据占位图执行截图
- 占位符格式: ![screenshot-placeholder](screenshot-placeholder.png), 或者带有具体的名称：![screenshot-placeholder](placeholder:projects-detail-page.png)
- 占位符数量: 1个或多个
- 截图后，替换对应的占位图
- 截图文件保存在 doc/user-manual/screenshots/{module} 目录下
- 处理过程:
```
Agent（每个路由调用一次）
  ↓
  1. 解析菜单文件 → 获取路由列表
  ↓
  1. 匹配说明文档 → 提取占位符
  ↓
  1. 获取动态参数（从已访问页面或创建操作）
  ↓
  1. 调用 Playwright 脚本执行截图
     node scripts/screenshot-page.js --route=... --output=...
  ↓
  1. 处理结果 → 更新文档 → 继续下一个路由
```

- 系统的基础url：http://localhost:3000 , 系统已经运行，可以直接访问。
- 如果需要登录，则需要使用登录账号和密码登录
- 登录账号和密码: admin@example.com/admin123456

- 截图脚本: scripts/screenshot-page.js
- 截图脚本参数:
  - --route: 页面路由
  - --output: 截图保存路径
  - --baseUrl: 应用基础URL
  - --waitFor: 等待元素选择器
  - --fullPage: 是否全页面截图
  - --viewport: 视口尺寸
  - --timeout: 页面加载超时时间
  - --id: 动态路由参数值
  - --storageState: 登录状态文件路径

