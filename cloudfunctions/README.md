# 云函数说明

本目录包含云裳微租项目使用的所有微信云开发云函数。

## 目录结构

```
cloudfunctions/
├── admin-api/              # B 端管理接口（HTTP 触发）
├── cloud-api/              # C 端业务接口
├── common/                 # 公共工具函数
│   └── utils.js            # token、分页、日期、密码等公共方法
├── getAccessibleImageUrl/  # 云存储图片共享访问
├── initDatabase/           # 数据库初始化
└── wxLogin/                # 真实微信登录
```

---

## admin-api

B 端管理后台接口，需开启 **HTTP 触发**。

### 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/login` | 管理员登录 |
| GET | `/dashboard` | 数据看板统计 |
| GET | `/categories` | 获取分类列表 |
| POST | `/categories` | 新增分类 |
| PUT | `/categories/:id` | 编辑分类 |
| DELETE | `/categories/:id` | 删除分类 |
| GET | `/clothings` | 获取服装列表（支持分页、搜索） |
| GET | `/clothings/:id` | 获取服装详情 |
| POST | `/clothings` | 新增服装 |
| PUT | `/clothings/:id` | 编辑服装 |
| DELETE | `/clothings/:id` | 删除服装 |
| GET | `/orders` | 获取订单列表 |
| GET | `/orders/:orderNo` | 获取订单详情 |
| PUT | `/orders/:orderNo/status` | 更新订单状态 |
| POST | `/orders/:orderNo/ship` | 订单发货（录入快递单号） |
| GET | `/banners` | 获取轮播图列表 |
| POST | `/banners` | 新增轮播图 |
| PUT | `/banners/:id` | 编辑轮播图 |
| DELETE | `/banners/:id` | 删除轮播图 |
| GET | `/reviews` | 获取评价列表 |
| DELETE | `/reviews/:id` | 删除评价 |
| PUT | `/reviews/:id/reply` | 回复评价 |
| GET | `/users` | 获取用户列表（支持分页、搜索） |
| PUT | `/users/:id/status` | 启用/禁用用户 |
| POST | `/upload` | 上传 Base64 图片到云存储 |
| POST | `/resolve-image` | 单张 cloud:// 图片转临时 URL |
| POST | `/resolve-image/batch` | 批量 cloud:// 图片转临时 URL |

> 除 `/login` 外，所有接口需在请求头中携带 `Authorization: Bearer <token>`。

---

## cloud-api

C 端小程序业务接口，通过 `wx.cloud.callFunction` 调用。

### 主要 action

| action | 说明 | 登录要求 |
|--------|------|----------|
| `getCategories` | 获取分类列表 | 否 |
| `getClothingList` | 获取商品列表 | 否 |
| `getClothingDetail` | 获取商品详情 | 否 |
| `getBanners` | 获取首页轮播图 | 否 |
| `updateUserInfo` | 更新用户信息 | 是 |
| `getUserInfo` | 获取当前用户信息 | 是 |
| `getAddresses` | 获取收货地址列表 | 是 |
| `addAddress` | 新增收货地址 | 是 |
| `updateAddress` | 编辑收货地址 | 是 |
| `deleteAddress` | 删除收货地址 | 是 |
| `setDefaultAddress` | 设置默认地址 | 是 |
| `getFavorites` | 获取收藏列表 | 是 |
| `addFavorite` | 添加收藏 | 是 |
| `deleteFavorite` | 取消收藏 | 是 |
| `createOrder` | 创建订单 | 是 |
| `getOrders` | 获取订单列表 | 是 |
| `getOrderDetail` | 获取订单详情 | 是 |
| `cancelOrder` | 取消订单 | 是 |
| `payOrder` | 模拟支付 | 是 |
| `confirmReceive` | 确认收货 | 是 |
| `confirmReturn` | 确认归还 | 是 |
| `submitReview` | 提交评价 | 是 |
| `getReviews` | 获取商品评价列表 | 否 |

---

## wxLogin

真实微信登录云函数。

### 调用参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 小程序 `wx.login` 获取的临时登录凭证 |
| `userInfo` | object | 可选，用户基础信息 |

### 返回

- `token`：服务端签发的 JWT，有效期 7 天
- `openid`：用户唯一标识
- `userInfo`：用户数据库记录

### 主要逻辑

1. 调用微信 `auth.code2Session` 换取 `openid`。
2. 查询或创建 `users` 集合中的用户记录。
3. 签发 token 并返回给前端。

---

## getAccessibleImageUrl

将 `cloud://` 协议云存储文件 ID 转换为临时可访问 URL。

### 调用参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | `single`（默认）或 `batch` |
| `cloudUrl` | string | `action=single` 时使用 |
| `cloudUrls` | array | `action=batch` 时使用 |

### 返回

- `single`：返回 `{ url }`
- `batch`：返回 `{ urlMap: { cloudUrl: tempUrl } }`

---

## initDatabase

数据库初始化云函数，建议在首次部署时手动运行一次。

### 功能

1. 创建以下集合（若不存在）：
   - `categories`：分类
   - `clothings`：服装商品
   - `banners`：首页轮播
   - `users`：用户
   - `addresses`：收货地址
   - `favorites`：收藏
   - `orders`：订单
   - `reviews`：评价
   - `admins`：管理员

2. 初始化默认分类：女装、男装、童装、汉服、礼服。
3. 初始化默认管理员账号：
   - 账号：`admin`
   - 密码：`admin123`

---

## common/utils.js

公共工具函数，供多个云函数引用。

| 函数 | 说明 |
|------|------|
| `success(data)` | 构造成功响应 |
| `fail(message, code)` | 构造失败响应 |
| `signToken(payload, secret, expiresIn)` | 签发 JWT |
| `verifyToken(token, secret)` | 验证 JWT |
| `getOpenId(context)` | 从云函数上下文获取 OPENID |
| `paginate(db, collection, where, page, pageSize, orderField, orderDirection)` | 通用分页查询 |
| `formatDate(date)` | 格式化日期时间 |
| `hashPassword(password)` | SHA256 密码哈希 |
| `verifyPassword(password, hash)` | 验证密码 |
