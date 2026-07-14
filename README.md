# 云裳微租 - 微信小程序服装租赁平台

## 项目简介

云裳微租是一个基于微信小程序的校园服装租赁平台。用户可以浏览、搜索、租赁各类服装，支持在线下单、押金管理、收货地址管理、商品收藏、评价等功能。管理后台提供服装管理、订单管理、评价管理、轮播图管理、用户管理、数据看板等功能。

> 说明：小程序端 (`utils/request.js`) 与管理后台均通过 HTTP 直连 `server.js`（Express + SQL Server）运行。`cloudfunctions/` 目录保留了一份基于微信云开发的替代实现，但当前并未接入运行链路，如需使用云开发请另行重构请求层。

## 技术栈

- **小程序端**：微信小程序（原生开发）
- **后端服务**：Node.js + Express 5（RESTful HTTP 接口）
- **数据库**：Microsoft SQL Server（通过 `mssql` 驱动访问）
- **鉴权**：JSON Web Token（JWT）
- **安全**：`cors` + `express-rate-limit` 限流
- **文件上传**：`multer`（本地 `uploads/` 目录）
- **管理后台**：Vue3 + Element Plus 单页面应用（直连后端 HTTP 接口，含登录鉴权）

## 项目结构说明

```
fukusou/
├── admin-system/              # B 端管理后台（Vue3 + Element Plus 单页面，含登录鉴权）
├── assets/                    # 静态资源（图标等）
├── cloudfunctions/            # （备选）微信云开发云函数实现，当前未接入运行链路
├── components/                # 小程序自定义组件
├── packageGoods/              # 商品相关分包（详情、搜索、评价列表组件）
├── packageUser/               # 用户相关分包（结算、订单、评价、地址、押金等）
├── pages/                     # 主包页面（首页、分类、购物车、我的）
├── deprecated/                # 已归档的旧版后端与建库脚本（仅参考）
│   └── SQLQuery1.sql          # SQL Server 建库与初始数据脚本
├── uploads/                   # 运行时上传的图片（由 multer 写入）
├── utils/                     # 工具函数（request 封装 / cloudApi 接口层）
├── server.js                  # ★ 实际运行的后端服务（Express + mssql）
├── app.js / app.json          # 小程序入口与全局配置
├── package.json               # 后端依赖与启动脚本（npm start -> node server.js）
├── .env / .env.example        # 后端环境变量（数据库、JWT、上传地址等）
└── README.md                  # 项目说明文档
```

## 环境准备

1. 安装 Node.js（建议 18+）与 Microsoft SQL Server（本地或远程实例）。
2. 在 SQL Server 中执行 `deprecated/SQLQuery1.sql` 创建数据库 `rental_app` 及全部数据表、初始分类与默认管理员。
3. 复制 `.env.example` 为 `.env`，填入真实的数据库连接信息与 `JWT_SECRET`。
4. 安装微信开发者工具并注册小程序账号，获取 AppID（用于真机预览）。

## 部署步骤

### 一、启动后端服务

```bash
# 1. 安装依赖
npm install

# 2. 配置 .env（DB_USER / DB_PASSWORD / DB_SERVER / DB_DATABASE / JWT_SECRET / UPLOAD_BASE_URL 等）

# 3. 启动服务（默认 http://localhost:3000）
npm start
```

- 接口根路径：`http://<后端IP>:3000/api/...`
- 上传文件可通过 `http://<后端IP>:3000/uploads/...` 静态访问。

### 二、小程序端配置

1. 用微信开发者工具打开项目根目录 `fukusou/`。
2. 编辑 `utils/request.js`，将 `BASE_URL` 修改为后端实际可访问地址（如 `http://192.168.x.x:3000` 或服务器域名）。**该地址需与 `admin-system/index.html` 中的 `baseUrl` 保持一致。**
3. 在微信公众平台将后端域名 / IP 加入小程序「request 合法域名」白名单（开发阶段可勾选「不校验合法域名」）。
4. 点击「编译」并预览。

### 三、管理后台

1. 将 `admin-system/index.html` 中的 `baseUrl` 修改为后端地址（默认 `http://localhost:3000`）。
2. 用浏览器打开 `admin-system/index.html`，使用默认管理员账号登录后即可管理数据。
   - 默认账号：`admin`  /  默认密码：`061009`（对应 `deprecated/SQLQuery1.sql` 中的初始数据）
   - 登录接口：`POST /api/admin/login`，返回 JWT 由前端自动携带于 `Authorization` 头。

## 已知限制

- 当前使用**模拟支付**（`POST /api/pay/mock`，将待支付订单置为待发货），未接入真实微信支付。
- 物流使用管理员手动录入快递单号，未接入物流 API。
- 微信登录当前为简化版（前端 `wx.login` 的 code 直接作为 openid 落库），真实环境应改为后端调用 `code2Session`。`server.js` 的 `/api/login` 已预留接入位置（见文件内 TODO）。
- 管理员密码为明文比对（演示用），生产环境请替换为哈希存储并强制修改默认密码。

## 接口与目录说明

| 路径 | 说明 |
|------|------|
| `server.js` | Express 后端：分类/商品/订单/收藏/评价/地址/押金/管理员 等全部 REST 接口，含 JWT 鉴权与限流 |
| `utils/request.js` | 小程序端统一 HTTP 封装，自动附加 JWT，处理 401 失效 |
| `utils/cloudApi.js` | 接口动作映射层，将语义化 `action` 转为具体 URL/方法，并做字段映射（兼容驼峰/下划线命名） |
| `admin-system/index.html` | 管理后台单页应用，登录后携带 JWT 调用各管理接口 |

## 注意事项

1. **BASE_URL 一致性**：小程序端 `utils/request.js` 与后台 `admin-system/index.html` 的 `baseUrl` 必须指向同一个正在运行的 `server.js` 实例。
2. **JWT_SECRET**：生产环境务必修改为强随机字符串，否则 Token 可被伪造。
3. **管理员默认密码**：请在生产环境通过 SQL 或后台逻辑修改为强密码，并启用密码哈希。
4. **数据库初始化**：首次部署必须先执行 `deprecated/SQLQuery1.sql` 建表，否则服务启动后访问接口会报错。
5. **图片资源**：商品/轮播图可经 `POST /api/upload` 上传，返回 `uploads/xxx` 相对路径，前端已统一拼接待访问地址。
6. **新增功能模块**：除基础租赁流程外，项目还包含帮助中心、联系客服、关于我们、订单物流时间轴、商品/小程序分享、最近浏览历史，以及管理后台的用户管理、分类管理。

### 四、功能模块总览

| 模块 | 入口/接口 |
|------|-----------|
| 帮助中心 / 关于我们 / 联系客服 | `packageUser/pages/help`、`/packageUser/pages/about`、`/packageUser/pages/customer-service` |
| 订单物流时间轴 | 订单详情页（`packageUser/pages/order-detail`） |
| 商品/小程序分享 | 商品详情与首页的 `onShareAppMessage` |
| 最近浏览 | 首页"最近浏览"（基于本地 `recentViews` 缓存） |
| 管理后台-用户/分类 | `admin-system/index.html` 对应菜单 |
