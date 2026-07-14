# 项目信息一键提取（Chrome 插件 + 本地后端）

从网页一键提取立项批复正文，结构化展示并允许人工修改后保存到本机 MySQL 数据库。

## 目录结构

```
project_tracker/
├── backend/              # Node.js + Express 后端
│   ├── package.json
│   ├── server.js
│   ├── db.js
│   ├── extractor.js
│   ├── .env.example
│   └── .gitignore
├── chrome-extension/     # Chrome 扩展（Manifest V3）
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html/js
│   ├── sidepanel.html/js/css
│   └── icons/
└── testfiles/            # 原始 .et 文件与导出数据
```

## 环境要求

- Node.js 18+
- MySQL 8.0（已在本机安装并运行）
- Chrome 114+（支持 Side Panel API）

## 安装步骤

### 1. 配置后端数据库

进入 `backend` 目录，运行交互式配置助手（推荐）：

```bash
cd backend
npm install
npm run setup
```

按提示输入 MySQL 账号密码，脚本会自动生成 `.env` 并初始化数据库。

或者手动配置：复制 `.env.example` 为 `.env` 并编辑：

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的MySQL密码
DB_NAME=project_tracker
```

### 2. 启动后端服务

```bash
cd backend
npm start
```

首次启动会自动创建数据库 `project_tracker` 和 `projects` 表（若已通过 `npm run setup` 初始化则跳过）。

服务默认运行在 `http://localhost:3000`，可通过浏览器访问 `http://localhost:3000/health` 检查状态。

### 3. 安装 Chrome 扩展

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 右上角开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择 `chrome-extension` 文件夹。
4. 扩展图标会出现在 Chrome 工具栏。

## 使用方法

### 方式一：自动提取（推荐先尝试）

1. 在 Chrome 中打开包含立项批复正文的网页。
2. 点击工具栏上的扩展图标。
3. 扩展会依次尝试：当前选中文本 → 主内容区 → article → body 文本。
4. 若提取成功，右侧“侧边栏”会自动填充字段，核对后提交。

### 方式二：选中文本提取（最稳定）

1. 在网页上用鼠标选中立项批复正文。
2. 右键点击，选择“提取选中的立项批复正文”。
3. 侧边栏会基于选中文本自动填充。

### 方式三：手动粘贴

1. 点击扩展图标打开侧边栏。
2. 展开“未提取到？手动粘贴正文”。
3. 将网页上的立项批复正文复制粘贴到文本框，点击“从粘贴文本提取”。

### 保存

核对并手动修改字段后，点击“提交到数据库”保存；或点击“保存为草稿”稍后处理。

## 提取规则说明

| 列 | 规则 |
|---|---|
| C 项目编码 | 从正文中“项目编码为 XXX”提取 |
| D 项目名称 | 从正文中“项目名称为 XXX”提取 |
| E 立项批复日期 | 提取文末汉字日期，如“二〇二四年一月二十五日” |
| L 立项金额 | 提取“投资预算/总投资不超过 X 万元” |
| J 工程责任人 | 提取“项目工程管理责任人为 XXX” |
| K 规划责任人 | 提取“项目投资责任人为 XXX” |
| B/H/I | 由项目编码前缀查表映射 |
| AF 是否研发 | 项目编码首字母 `R`→研发，其他→非研发 |
| AD 上市/非上市 | 项目编码首字母 `T`→非上市，其他→上市 |
| AC/AE/AG | 由建设单位、主送单位、决策依据推断 |
| F/G/M/P~U/V/W/X/AA/AB | 无法从立项批复正文稳定提取，默认留空，在侧边栏手工补录 |

## 常见问题

### 后端提示连接 MySQL 失败

请检查 `.env` 中的 `DB_USER` 和 `DB_PASSWORD` 是否正确，并确认 MySQL 服务已启动。

### 扩展无法打开侧边栏

请确认 Chrome 版本 >= 114，并在 `chrome://extensions/` 中重新加载扩展。

### 提取结果不准确

立项批复格式多样，插件以“可编辑表单”呈现结果，保存前请人工核对。后续可在 `backend/extractor.js` 中补充新的映射或正则规则。

### 打开网页后插件抓不到数据

常见原因：

1. **页面是 SPA（单页应用）**：正文通过 JS 动态加载，自动提取可能失败。请使用“方式二：选中文本提取”。
2. **正文在 iframe 中**：暂不支持 iframe 自动提取，请复制正文后使用“方式三：手动粘贴”。
3. **后端未启动**：确认 `http://localhost:3000/health` 可访问。
4. **VPN/内网限制**：部分内网页面可能限制扩展脚本执行，此时用“手动粘贴”最可靠。

## 开发命令

```bash
# 后端热重载
cd backend
npm run dev

# 手动初始化数据库
cd backend
npm run init-db

# 测试提取器（无需启动 MySQL）
cd backend
npm run test-extractor
```
