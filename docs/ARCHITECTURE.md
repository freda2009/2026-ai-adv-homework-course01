# 架構

## 架構總覽

單一 Express 程序同時提供三種內容，沒有獨立的前端建置或部署：

```text
瀏覽器
  │  GET /products/abc          → 頁面路由：回傳 EJS 渲染的 HTML 外殼（不含業務資料）
  │  GET /js/... /css/...       → express.static：回傳 public/ 靜態檔
  │  fetch /api/...             → API 路由：回傳 JSON
  │  GET /ecpay/payment/:id     → 回傳自動送出的表單，由瀏覽器 POST 至綠界
  ▼
Express（app.js）
  ├─ 全域 middleware：static → cors → json → urlencoded → sessionMiddleware
  ├─ /api/*  → src/routes/*Routes.js → better-sqlite3 → database.sqlite
  │            └─ check-payment → src/services/ecpay.js → 綠界 QueryTradeInfo
  ├─ /ecpay/* → src/routes/ecpayRoutes.js → views/pages/ecpay-redirect.ejs
  ├─ /*      → src/routes/pageRoutes.js → views/*.ejs
  ├─ 404 handler（/api 回 JSON，其餘回 HTML）
  └─ errorHandler（統一 500／解析錯誤回應）
```

三個影響所有模組的設計決策：

1. **頁面不查資料庫**。`pageRoutes.js` 只傳標題、頁面腳本名稱與 URL 參數；所有業務資料都由瀏覽器中的 Vue 呼叫 API 取得。例外是 `/ecpay/payment/:orderId`，它必須在伺服器端讀取訂單並簽章，所以自行驗證 JWT。
2. **權限只在 API 把關**。`pageRoutes.js` 的頁面路由沒有任何認證，`/admin/products` 對未登入者也回 200；`requireAuth`／`requireAdmin` 是前端導頁，不是安全邊界。
3. **沒有 repository 分層**。SQL 直接寫在路由 handler，且全部同步執行。`src/services/ecpay.js` 是唯一的 service，只負責綠界的簽章與 HTTP 呼叫，不碰資料庫。

## 目錄結構

```text
.
├── server.js                 # 程序入口：檢查 JWT_SECRET 後 listen；被 require 時不啟動
├── app.js                    # 組裝 Express：dotenv、DB 初始化、middleware、路由、404、錯誤處理
├── generate-openapi.js       # 產生根目錄的 openapi.json（npm run openapi）
├── swagger-config.js         # OpenAPI 基本資訊、securitySchemes、掃描路徑 ./src/routes/*.js
├── vitest.config.js          # 測試設定（ESM 語法）
├── package.json              # 指令與相依套件（name: backend-project）
├── .env.example              # 環境變數範本
├── database.sqlite*          # 執行時產生，git 忽略（含 -wal、-shm）
├── openapi.json              # npm run openapi 才產生；目前未被 git 忽略也未提交
│
├── src/
│   ├── database.js           # 開啟 DB、設定 pragma、建表、種子資料；匯出 db 單例
│   ├── middleware/
│   │   ├── authMiddleware.js     # 驗證 Bearer JWT 與使用者存在，設定 req.user；失敗 401
│   │   ├── adminMiddleware.js    # 檢查 req.user.role === 'admin'；失敗 403
│   │   ├── sessionMiddleware.js  # 全域：把 X-Session-Id 放到 req.sessionId，從不拒絕請求
│   │   └── errorHandler.js       # 全域錯誤處理，隱藏內部訊息
│   ├── services/
│   │   └── ecpay.js              # 綠界 CheckMacValue、MerchantTradeNo、AIO 參數、QueryTradeInfo
│   └── routes/
│       ├── authRoutes.js         # 註冊、登入、個人資料
│       ├── productRoutes.js      # 公開的商品列表與詳情
│       ├── cartRoutes.js         # 購物車 CRUD；內含 dualAuth、getOwnerCondition
│       ├── orderRoutes.js        # 建立訂單、查詢、模擬付款；內含 generateOrderNo
│       ├── adminProductRoutes.js # 後台商品 CRUD
│       ├── adminOrderRoutes.js   # 後台訂單列表與詳情
│       ├── ecpayRoutes.js        # 匯出 pageRouter（/ecpay）與 apiRouter（/api/orders）；內含 queryAuth
│       └── pageRoutes.js         # 所有前台與後台 HTML 頁面；內含 renderFront、renderAdmin
│
├── views/
│   ├── layouts/
│   │   ├── front.ejs         # 前台外框：header + main + footer + toast + 共用腳本
│   │   └── admin.ejs         # 後台外框：含 sidebar，並以 requireAdmin 做前端導頁
│   ├── partials/
│   │   ├── head.ejs          # <head>：標題、字型、/css/output.css
│   │   ├── header.ejs        # 前台導覽（#auth-nav、#cart-badge、#orders-link）
│   │   ├── admin-header.ejs  # 後台頂列（#admin-username、登出）
│   │   ├── admin-sidebar.ejs # 後台側欄，依 currentPath 標示目前頁面
│   │   ├── footer.ejs        # 頁尾
│   │   └── notification.ejs  # toast 容器 #notification-toast
│   └── pages/
│       ├── index.ejs         # 首頁（Hero、精選、品牌故事、商品網格、好評、服務特色）
│       ├── product-detail.ejs# 商品詳情（data-product-id）
│       ├── cart.ejs          # 購物車（含前端運費計算）
│       ├── checkout.ejs      # 結帳表單與摘要（含前端運費計算）
│       ├── login.ejs         # 登入／註冊分頁
│       ├── orders.ejs        # 我的訂單
│       ├── order-detail.ejs  # 訂單詳情與綠界付款按鈕（data-order-id、data-payment-result）
│       ├── ecpay-redirect.ejs# 自動送出至綠界的表單；獨立頁面，不套 layout
│       ├── 404.ejs           # 找不到頁面
│       └── admin/
│           ├── products.ejs  # 後台商品表格、新增／編輯 modal、刪除確認
│           └── orders.ejs    # 後台訂單表格、狀態篩選、詳情 modal
│
├── public/
│   ├── css/
│   │   ├── input.css         # Tailwind 入口與 @theme 色彩
│   │   └── output.css        # 建置產物，git 忽略
│   ├── stylesheets/style.css # Express generator 遺留，沒有任何頁面引用
│   └── js/
│       ├── auth.js           # 全域 Auth：localStorage token／user／session、導頁守衛
│       ├── api.js            # 全域 apiFetch：附帶認證 header、處理 401、丟出錯誤
│       ├── notification.js   # 全域 Notification.show(message, type)
│       ├── header-init.js    # 前台導覽列狀態與購物車徽章（僅 front layout）
│       └── pages/            # 每頁一支 Vue 腳本，由 layout 依 pageScript 載入
│           ├── index.js, product-detail.js, cart.js, checkout.js
│           ├── login.js, orders.js, order-detail.js
│           └── admin-products.js, admin-orders.js
│
├── tests/
│   ├── setup.js              # 測試輔助函式（不是 Vitest setupFiles）
│   ├── fixtures/             # 測試資料：ecpay-checkmacvalue.json（CheckMacValue 向量）
│   └── *.test.js             # auth、products、cart、orders、adminProducts、adminOrders、ecpay
│
└── docs/                     # 專案文件；plans/ 放開發計畫
```

## 啟動流程

`node server.js` 依序執行：

1. `server.js` 第一行 `require('./app')`，以下 2–6 都在這裡發生。
2. `app.js` 執行 `dotenv.config()`，從**目前工作目錄**載入 `.env`；已存在的環境變數不會被覆蓋。
3. 載入 middleware 模組，再 `require('./src/database')`：
   - 開啟（或建立）`<專案根目錄>/database.sqlite`，路徑固定，無法用環境變數改變。
   - 設定 `journal_mode = WAL`、`foreign_keys = ON`。
   - 以 `CREATE TABLE IF NOT EXISTS` 建立 5 張表。
   - 以 `PRAGMA table_info(orders)` 檢查後 `ALTER TABLE` 補上 4 個綠界欄位，既有資料庫不需刪除重建。
   - `seedAdminUser()`：`ADMIN_EMAIL` 不存在才建立管理員。
   - `seedProducts()`：`products` 為空才寫入 8 筆商品。
4. 建立 Express app，設定 EJS 與 `views` 目錄。
5. 依序掛載：`express.static` → `cors` → `express.json` → `express.urlencoded` → `sessionMiddleware`。
6. 依序掛載 API 路由、頁面路由、404 handler、`errorHandler`，並匯出 app。
7. 回到 `server.js`：只有直接執行時（`require.main === module`）才檢查 `JWT_SECRET`，缺少則印 `Fatal: JWT_SECRET is not set` 並 `exit(1)`；通過後 `listen(PORT || 3001)`。

**整合影響：**

- 只要 `require('./app')` 就會建表並寫入種子資料，測試也一樣。
- 測試直接匯入 `app`，會**略過第 7 步**。缺少 `JWT_SECRET` 時不會在啟動時失敗，而是在簽發 token 時丟錯，登入與註冊回 500。
- `express.static` 排在最前面，`public/` 內的同名路徑會優先於任何路由。

## API 路由總覽

全部掛載於 `app.js`。逐端點的參數與錯誤見 [FEATURES.md](./FEATURES.md)。

| 前綴 | 檔案 | 認證 | 說明 |
| --- | --- | --- | --- |
| `/api/auth` | `authRoutes.js` | `register`、`login` 公開；`profile` 需 JWT（route-level） | 帳號 |
| `/api/admin/products` | `adminProductRoutes.js` | JWT + admin（`router.use`） | 後台商品 CRUD |
| `/api/admin/orders` | `adminOrderRoutes.js` | JWT + admin（`router.use`） | 後台訂單查詢 |
| `/api/products` | `productRoutes.js` | 公開 | 商品列表與詳情 |
| `/api/cart` | `cartRoutes.js` | `dualAuth`：JWT 或 `X-Session-Id`（route-level） | 購物車 |
| `/api/orders` | `orderRoutes.js` | JWT（`router.use`） | 會員訂單與模擬付款 |
| `/api/orders` | `ecpayRoutes.js` 的 `apiRouter` | JWT（`router.use`） | 綠界付款查詢 |
| `/ecpay` | `ecpayRoutes.js` 的 `pageRouter` | JWT，以查詢參數傳遞（`queryAuth`） | 綠界付款表單，回傳 HTML |

`/api/orders` 掛載了兩個 router。`check-payment` 不符合 `orderRoutes.js` 的任何路由，會先通過它的 `authMiddleware`，再進入 `apiRouter` 驗證第二次，這多一次查詢但不影響結果。

### 全部 API 操作

| 方法 | 路徑 | 認證 | 成功狀態碼 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 無 | 201 |
| POST | `/api/auth/login` | 無 | 200 |
| GET | `/api/auth/profile` | JWT | 200 |
| GET | `/api/products` | 無 | 200 |
| GET | `/api/products/:id` | 無 | 200 |
| GET | `/api/cart` | JWT 或 Session | 200 |
| POST | `/api/cart` | JWT 或 Session | 200（不是 201） |
| PATCH | `/api/cart/:itemId` | JWT 或 Session | 200 |
| DELETE | `/api/cart/:itemId` | JWT 或 Session | 200 |
| POST | `/api/orders` | JWT | 201 |
| GET | `/api/orders` | JWT | 200 |
| GET | `/api/orders/:id` | JWT | 200 |
| PATCH | `/api/orders/:id/pay` | JWT | 200 |
| POST | `/api/orders/:id/check-payment` | JWT | 200 |
| GET | `/api/admin/products` | JWT + admin | 200 |
| POST | `/api/admin/products` | JWT + admin | 201 |
| PUT | `/api/admin/products/:id` | JWT + admin | 200 |
| DELETE | `/api/admin/products/:id` | JWT + admin | 200 |
| GET | `/api/admin/orders` | JWT + admin | 200 |
| GET | `/api/admin/orders/:id` | JWT + admin | 200 |

### 頁面路由

下表全部定義於 `pageRoutes.js`，**伺服器端都不驗證身分**。「前端守衛」是頁面腳本在瀏覽器端的導頁。唯一會驗證身分的 HTML 路由是表格之後的 `/ecpay/payment/:orderId`。

| URL | View | `pageScript` | 前端守衛 | 呼叫的 API |
| --- | --- | --- | --- | --- |
| `/` | `pages/index` | `index` | 無 | `GET /api/products`、`POST /api/cart` |
| `/products/:id` | `pages/product-detail` | `product-detail` | 無 | `GET /api/products/:id`、`POST /api/cart` |
| `/cart` | `pages/cart` | `cart` | 無（結帳按鈕才檢查登入） | `GET/PATCH/DELETE /api/cart` |
| `/checkout` | `pages/checkout` | `checkout` | `requireAuth` | `GET /api/cart`、`POST /api/orders` |
| `/login` | `pages/login` | `login` | 無 | `POST /api/auth/login`、`/register` |
| `/orders` | `pages/orders` | `orders` | `requireAuth` | `GET /api/orders` |
| `/orders/:id` | `pages/order-detail` | `order-detail` | `requireAuth` | `GET /api/orders/:id`、`POST .../check-payment` |
| `/admin/products` | `pages/admin/products` | `admin-products` | `requireAdmin` | `/api/admin/products` 全部 |
| `/admin/orders` | `pages/admin/orders` | `admin-orders` | `requireAdmin` | `/api/admin/orders` 全部 |

前台頁面另由 `header-init.js` 呼叫 `GET /api/cart` 更新徽章（`/checkout`、`/login` 等所有 front layout 頁面都會呼叫）。

| URL | 定義位置 | View | 認證 | 失敗時 |
| --- | --- | --- | --- | --- |
| `/ecpay/payment/:orderId` | `ecpayRoutes.js` 的 `pageRouter` | `pages/ecpay-redirect` | `queryAuth`（`?token=<JWT>`） | 純文字 400／401／404 |

這個路由直接 `res.render`，不走兩階段 render，也不載入 Vue 或任何共用腳本。

### 頁面渲染機制（兩階段 render）

專案沒有使用 layout 套件。`renderFront`／`renderAdmin` 先把頁面渲染成字串，再當作 `body` 傳給 layout：

```js
res.render('pages/' + page, { layout: 'front', ...locals }, function (err, body) {
  if (err) return res.status(500).send(err.message);
  res.render('layouts/front', { body, ...locals });
});
```

- `layout: 'front'` 這個 local 沒有作用。
- 伺服器資料透過 `data-*` 屬性交給 Vue，例如 `<div id="app" data-order-id="<%= orderId %>">`；必須用會跳脫的 `<%= %>`。
- 頁面中的 `{{ }}` 由瀏覽器的 Vue 編譯（in-DOM template），EJS 只處理 `<% %>`。
- layout 的腳本順序固定：Vue → `auth.js` → `api.js` → `notification.js` →（前台）`header-init.js` → `pages/<pageScript>.js`。後面的腳本可以直接使用前面定義的全域變數。
- `/orders/:id` 把 `?payment=` 查詢參數透過 `data-payment-result` 傳給前端，用來顯示 `success`／`failed`／`cancel`／`pending` 訊息。

### 404 行為

未匹配的路徑若以 `/api` 開頭回 JSON（`NOT_FOUND`、`找不到該路徑`），其餘回 HTML 404 頁。注意 `/products/不存在` 這類頁面路由仍回 200，由前端 API 回 404 後顯示「找不到此商品」。

## 統一回應格式

每個 JSON 回應都恰好有三個欄位：

| 欄位 | 成功 | 失敗 |
| --- | --- | --- |
| `data` | 物件；刪除操作為 `null` | 永遠 `null` |
| `error` | `null` | 大寫錯誤碼字串 |
| `message` | 中文訊息 | 中文訊息，可顯示給使用者 |

成功（單筆）：

```json
{
  "data": { "id": "1611998f-9188-4431-801e-60e6240951ac", "name": "粉色玫瑰花束", "price": 1680, "stock": 30 },
  "error": null,
  "message": "成功"
}
```

成功（分頁列表）：

```json
{
  "data": {
    "products": [],
    "pagination": { "total": 8, "page": 1, "limit": 10, "totalPages": 1 }
  },
  "error": null,
  "message": "成功"
}
```

失敗：

```json
{
  "data": null,
  "error": "STOCK_INSUFFICIENT",
  "message": "庫存不足"
}
```

### 全域錯誤處理

`errorHandler.js` 只處理路由未自行回應的例外：

- 狀態碼取 `err.status || err.statusCode || 500`。
- 500 一律回 `伺服器內部錯誤`；其他狀態碼若 `err.isOperational` 為真則回 `err.message`，否則回內建安全訊息（400 為 `請求格式錯誤`）。專案目前沒有設定 `isOperational` 的錯誤類別。
- **`error` 欄位永遠是 `INTERNAL_ERROR`**，連無效 JSON 造成的 400 也是，所以不能只靠 `error` 判斷是否為伺服器故障。
- 原始訊息會透過 `console.error` 記錄。

路由中所有未處理的同步例外（SQLite 外鍵錯誤、對非字串呼叫 `.trim()` 等）都會變成這個 500。

### 欄位大小寫

請求 body 主要用 camelCase（`productId`、`recipientName`），回應與資料庫用 snake_case（`product_id`、`recipient_name`、`order_no`）。例外：後台商品的請求 body 用 `image_url`。

## 認證與授權

### JWT 參數

| 項目 | 值 |
| --- | --- |
| 演算法 | HS256（簽發用 jsonwebtoken 預設；驗證限定 `algorithms: ['HS256']`） |
| 密鑰 | `process.env.JWT_SECRET` |
| 有效期 | `7d` |
| Payload | `userId`、`email`、`role`、`iat`、`exp` |
| 傳遞方式 | `Authorization: Bearer <token>`；`/ecpay/payment/:orderId` 例外，用 `?token=` |
| 簽發位置 | `authRoutes.js` 的 register 與 login（兩處重複程式碼） |
| 撤銷機制 | 無；登出只是前端刪除 token。更換 `JWT_SECRET` 會讓所有 token 失效 |

### Middleware 行為

**`authMiddleware`**

| 情況 | 結果 |
| --- | --- |
| 沒有 header 或不以 `Bearer ` 開頭 | 401 `UNAUTHORIZED`：`請先登入` |
| 驗證失敗或過期 | 401 `UNAUTHORIZED`：`Token 無效或已過期` |
| token 有效但使用者已不存在 | 401 `UNAUTHORIZED`：`使用者不存在，請重新登入` |
| 通過 | 設定 `req.user = { userId, email, role }` |

只查使用者是否存在。**`role` 來自 token 而不是資料庫**，直接修改資料庫的角色後，舊 token 在到期前（最多 7 天）仍保有舊權限。

**`adminMiddleware`**：`req.user` 不存在或 `role !== 'admin'` 時回 403 `FORBIDDEN`：`權限不足`。必須排在 `authMiddleware` 之後。

**`sessionMiddleware`**：全域執行，把 `X-Session-Id` 放到 `req.sessionId`。不驗證格式，也不拒絕請求。任意非空字串都是合法 session，且伺服器不儲存 session 紀錄。

**`dualAuth`**（定義在 `cartRoutes.js`，未匯出）：

```text
Authorization 以 "Bearer " 開頭？
├─ 是 → 驗證 JWT
│   ├─ 有效且使用者存在 → req.user 設定完成，以 user_id 為擁有者
│   └─ 無效／過期／使用者不存在 → 立即 401（即使同時帶了有效的 X-Session-Id 也不退回）
└─ 否 → req.sessionId 存在？
    ├─ 是 → 以 session_id 為擁有者（req.user 不設定）
    └─ 否 → 401：請提供有效的登入 Token 或 X-Session-Id
```

`Authorization: Basic ...` 這類非 Bearer header 會被視為沒有帶 token，退回 session 模式。

**`queryAuth`**（定義在 `ecpayRoutes.js`，未匯出）：瀏覽器導向無法帶 header，所以從 `req.query.token` 讀取 JWT。驗證內容與 `authMiddleware` 相同（HS256、使用者存在），並設定相同的 `req.user`，但失敗時回**純文字**，不是 JSON。修改認證邏輯時，要同時檢查 `authMiddleware`、`dualAuth`、`queryAuth` 這三份。

### 前端認證（`public/js/auth.js`、`api.js`）

| localStorage key | 內容 | 何時清除 |
| --- | --- | --- |
| `flower_token` | JWT | 登出、任何 API 回 401 |
| `flower_user` | `{ id, email, name, role }` JSON | 登出、任何 API 回 401 |
| `flower_session_id` | `crypto.randomUUID()` | **不會清除**（登出後仍保留） |

`apiFetch(url, options)` 的固定行為：

1. 一律加上 `Content-Type: application/json`。
2. 有 token 就加 `Authorization`；**永遠**加 `X-Session-Id`。因此登入狀態下兩者都會送出，由 `dualAuth` 依 JWT 優先處理。
3. 回應 401：刪除 token 與 user，導向 `/login`，回傳 `undefined`。
4. 其他非 2xx：丟出 `{ status, data }`，錯誤訊息在 `err.data.message`。
5. 成功：回傳整個 `{ data, error, message }`。

第 3 點對所有 401 都生效，包含登入密碼錯誤，見 [FEATURES.md 已知問題](./FEATURES.md#已知問題與限制)。

## 資料庫 Schema

共 5 張表，定義於 `src/database.js`。慣例：

- 主鍵都是應用程式產生的 UUID v4（`TEXT`）。
- 金額與數量是 `INTEGER`（新台幣整數）。
- 時間是 `datetime('now')` 產生的 **UTC** 文字，格式 `YYYY-MM-DD HH:MM:SS`，不含時區標記。
- 除主鍵與 UNIQUE 的自動索引外，沒有其他索引。
- 外鍵的 `ON DELETE` 全為預設 `NO ACTION`，也就是有參照時刪除會失敗。

### `users`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID |
| `email` | TEXT | UNIQUE, NOT NULL | 比對區分大小寫 |
| `password_hash` | TEXT | NOT NULL | bcrypt |
| `name` | TEXT | NOT NULL | |
| `role` | TEXT | NOT NULL, DEFAULT `'user'`, CHECK IN (`user`, `admin`) | 註冊時固定為 `user` |
| `created_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` | |

### `products`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | |
| `description` | TEXT | 可為 NULL | |
| `price` | INTEGER | NOT NULL, CHECK `price > 0` | |
| `stock` | INTEGER | NOT NULL, DEFAULT 0, CHECK `stock >= 0` | 庫存超賣的最後防線 |
| `image_url` | TEXT | 可為 NULL | 前端有預設圖 |
| `created_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` | 列表排序依據 |
| `updated_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` | **只有** `PUT /api/admin/products/:id` 會更新；訂單扣庫存不會 |

### `cart_items`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | 可為 NULL | 訪客擁有者；無外鍵 |
| `user_id` | TEXT | FK → `users.id`，可為 NULL | 會員擁有者 |
| `product_id` | TEXT | NOT NULL, FK → `products.id` | |
| `quantity` | INTEGER | NOT NULL, DEFAULT 1, CHECK `quantity > 0` | |

應用程式保證 `session_id`／`user_id` 只填一個，資料庫沒有 CHECK。`(owner, product_id)` 也沒有唯一約束，靠「先查再更新」維持一商品一列。

### `orders`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID |
| `order_no` | TEXT | UNIQUE, NOT NULL | `ORD-YYYYMMDD-XXXXX`，日期為 UTC，後綴取自 UUID 前 5 碼並轉大寫 |
| `user_id` | TEXT | NOT NULL, FK → `users.id` | |
| `recipient_name` | TEXT | NOT NULL | |
| `recipient_email` | TEXT | NOT NULL | |
| `recipient_address` | TEXT | NOT NULL | |
| `total_amount` | INTEGER | NOT NULL | 商品小計；**不含運費** |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK IN (`pending`, `paid`, `failed`) | |
| `created_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` | 沒有 `updated_at` |
| `merchant_trade_no` | TEXT | 可為 NULL | 送交綠界的交易編號；每次進入付款頁都會覆寫。NULL 表示尚未發起綠界付款。無 UNIQUE 約束 |
| `ecpay_trade_no` | TEXT | 可為 NULL | 綠界的 `TradeNo`，付款確認時寫入 |
| `payment_type` | TEXT | 可為 NULL | 綠界回傳的 `PaymentType`，也就是實際使用的付款方式，例如 `Credit_CreditCard`、`WebATM_LAND` |
| `paid_at` | TEXT | 可為 NULL | 綠界回傳的 `PaymentDate` 原始字串，格式 `yyyy/MM/dd HH:mm:ss`。**與其他時間欄位不同，不是 `datetime('now')` 產生的 UTC 格式**，不要直接混用比較 |

後 4 欄是後來以遷移加入，所以在 `initializeDatabase()` 的 `ALTER TABLE` 而不是 `CREATE TABLE` 內。透過 `PATCH /api/orders/:id/pay` 模擬付款的訂單，這 4 欄都維持 NULL。

### `order_items`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | UUID |
| `order_id` | TEXT | NOT NULL, FK → `orders.id` | |
| `product_id` | TEXT | NOT NULL，**無外鍵** | 商品刪除後會成為懸空值 |
| `product_name` | TEXT | NOT NULL | 下單時的名稱快照 |
| `product_price` | INTEGER | NOT NULL | 下單時的價格快照 |
| `quantity` | INTEGER | NOT NULL | |

顯示歷史訂單時要使用快照欄位，**不要 JOIN `products`**，商品可能已改價或被刪除。

### 關聯與刪除行為

```text
users 1─* orders 1─* order_items ┄┄ products（僅邏輯關聯，無外鍵）
users 1─* cart_items *─1 products
session_id（無資料表）1─* cart_items
```

刪除商品時（實測）：

| 商品目前狀態 | 結果 |
| --- | --- |
| 在 `pending` 訂單中 | 409 `CONFLICT`（應用程式檢查） |
| 在任何人的購物車中 | 500 `INTERNAL_ERROR`（`FOREIGN KEY constraint failed`，未轉換成業務錯誤） |
| 只在 `paid`／`failed` 訂單中 | 成功；訂單詳情仍可用快照顯示 |

### 種子資料

| 資料 | 條件 | 內容 |
| --- | --- | --- |
| 管理員 | `ADMIN_EMAIL` 不存在 | 名稱 `Admin`、角色 `admin`；bcrypt cost 為 10，`NODE_ENV=test` 時為 1 |
| 商品 | `products` 為空 | 8 筆花卉商品，價格 580–3980，庫存 15–100 |

種子商品在同一秒內寫入，`created_at` 相同。列表用 `ORDER BY created_at DESC` 且沒有第二排序鍵，因此這些商品之間的順序 SQL 並不保證；實測是插入順序，第一筆為「粉色玫瑰花束」。

## 資料流

### 訪客瀏覽與加入購物車

1. 瀏覽器請求 `/`，Express 回傳 HTML 外殼。
2. `auth.js` 第一次呼叫 `getSessionId()` 時產生 UUID 並存入 localStorage。
3. `pages/index.js` 掛載後呼叫 `GET /api/products?page=1&limit=9`。
4. 點「加入購物車」呼叫 `POST /api/cart`，帶 `X-Session-Id`。
5. `sessionMiddleware` 設定 `req.sessionId`；`dualAuth` 放行；`getOwnerCondition` 回傳 `{ field: 'session_id', value }`。
6. 同商品已在車內就累加，否則新增一列，兩種情況都檢查庫存。

### 結帳建立訂單

1. `/cart` 點「前往結帳」：未登入導向 `/login?redirect=/checkout`。
2. 登入後導回 `/checkout`，此時 `GET /api/cart` 以 **`user_id`** 查詢。訪客車不會出現；車為空則導回 `/cart`。
3. 送出時呼叫 `POST /api/orders`。後端依序：驗證欄位 → 讀取會員購物車 → 檢查空車 → 檢查每項庫存 → 計算總額。
4. 在 `db.transaction` 中：建立 `orders` → 逐項建立 `order_items` 並扣庫存 → 清空該會員購物車。
5. 回 201，前端導向 `/orders/:id`。

**併發說明：** 庫存檢查在 transaction 之外，但 better-sqlite3 是同步的，整個 handler 在單一程序中不會被其他請求插入。若未來改為多程序部署，第 3 步與第 4 步之間會有競爭；屆時 `CHECK(stock >= 0)` 會讓 transaction 回滾，但使用者收到的是 500。

### 綠界付款

```text
瀏覽器                         Express                          綠界
  │ GET /ecpay/payment/:id?token=  │                               │
  ├───────────────────────────────▶│ 驗證、存新 merchant_trade_no、簽章
  │◀── 自動送出的 HTML 表單 ────────┤                               │
  │ POST AioCheckOut/V5 ───────────┼──────────────────────────────▶│
  │◀── 付款頁，使用者完成付款 ───────┼───────────────────────────────┤
  │ 返回商店 /orders/:id?payment=pending（ClientBackURL）           │
  │ POST /api/orders/:id/check-payment                              │
  ├───────────────────────────────▶│ POST QueryTradeInfo/V5 ──────▶│
  │                                │◀── 交易狀態與 CheckMacValue ───┤
  │                                │ 驗 CMV → 驗金額 → 驗 TradeStatus
  │◀── { status: 'paid' } ─────────┤ transaction 內更新為 paid      │
```

綠界不會連回本站，瀏覽器帶回的 `?payment=` 也只影響提示文字；**唯一能把訂單改為已付款的綠界路徑，是通過驗證的 `QueryTradeInfo` 回應**。逐步行為與錯誤見 [FEATURES.md](./FEATURES.md#ecpay-金流aio)。

### 模擬付款

頁面已不再提供按鈕，只能直接呼叫 API，供開發與測試使用：

1. 呼叫 `PATCH /api/orders/:id/pay`，body `{ "action": "success" | "fail" }`。
2. 後端確認訂單屬於本人且為 `pending`，更新狀態並回傳完整訂單。

### 訂單狀態機

```text
           check-payment 驗證通過，或 action=success
pending ───────────────────────────────────────────▶ paid（終態）
   │
   └───── action=fail（僅模擬付款 API）──────────────▶ failed（終態，不回補庫存）
```

庫存在**建立訂單時**就已扣除，不是付款時。後台沒有變更訂單狀態的 API。綠界流程不會產生 `failed`：查詢結果未付款時，訂單維持 `pending`，可以重新付款。

## 金流與第三方整合

### 金流現況

**已串接綠界 ECPay AIO。** 程式分為兩層：

| 模組 | 職責 |
| --- | --- |
| `src/services/ecpay.js` | 純粹的綠界邏輯：`generateCheckMacValue`、`verifyCheckMacValue`（`timingSafeEqual`）、`generateMerchantTradeNo`、`buildAioParams`、`queryTradeInfo`。只用內建 `crypto` 與原生 `fetch`，沒有新增相依套件，也不碰資料庫 |
| `src/routes/ecpayRoutes.js` | 認證、訂單存取、狀態更新與回應格式 |

**為什麼用主動查詢：** 專案在 localhost 執行，綠界無法呼叫 `ReturnURL`。`ReturnURL` 是綠界必填欄位，所以仍填 `${BASE_URL}/api/ecpay/notify`，但這個路由刻意沒有實作。同樣的原因，也沒有使用 `OrderResultURL`。

`?payment=` 只影響提示文字，不代表實際付款狀態，任何人都能手動輸入。

上線到公開環境前必須處理（這是整合注意事項，不是現有功能）：

- `PATCH /api/orders/:id/pay` 必須移除或限制在非正式環境，否則使用者可繞過金流。
- 實作 `ReturnURL` 的伺服器對伺服器通知，驗證 CheckMacValue 後更新訂單，避免使用者沒按查詢時訂單停在 `pending`。
- `/ecpay/payment/:orderId` 不要再用查詢參數傳 JWT，改用短效的一次性憑證或 POST。
- 使用專屬商店帳號，`ECPAY_HASH_KEY`、`ECPAY_HASH_IV` 不得進版控，並設定 `ECPAY_ENV=production`。
- `total_amount` 不含運費，但前端顯示的總計含運費。目前向綠界請款的是**不含運費**的金額，要先統一。
- `merchant_trade_no` 只保留最新一筆，付款後重新進入付款頁會查不到舊交易，正式環境應保存每次發起的編號。

### 其他外部資源

| 資源 | 使用位置 | 失效影響 |
| --- | --- | --- |
| 綠界 `payment-stage.ecpay.com.tw`（`ECPAY_ENV=production` 時為 `payment.ecpay.com.tw`） | 付款頁表單、`QueryTradeInfo` | 無法付款；`check-payment` 回 502 `ECPAY_QUERY_FAILED`，訂單維持 `pending`，恢復後可再查詢 |
| `unpkg.com/vue@3`（未鎖版本） | 兩個 layout | 所有互動頁面停止運作；主版本內的更新會直接生效 |
| Google Fonts | `partials/head.ejs` | 退回 `sans-serif`／`serif` 字型 |
| `images.unsplash.com` | 種子商品與頁面預設圖 | 圖片破圖 |

### CORS

`cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3001' })` 只允許單一來源。內建頁面與 API 同源，不受影響；只有獨立前端（例如 `.env.example` 的 `http://localhost:5173`）才需要設定。

### OpenAPI

`npm run openapi` 掃描 `./src/routes/*.js` 的 `@openapi` 註解並輸出 `openapi.json`，須在專案根目錄執行。規格是手寫註解，不會由程式碼推導，目前有幾處與實作不一致：

- `POST /api/cart` 註解把 `quantity` 列為必填，實作預設為 1。
- `GET /api/admin/orders` 註解未列 `recipient_address`，實作用 `SELECT *` 會回傳；`GET /api/orders/:id` 同樣會多回 `user_id`。
- `/ecpay/payment/{orderId}` 回傳 HTML 而不是 JSON，但因為寫在 `src/routes/` 的 `@openapi` 區塊內，同樣會出現在規格中；它的註解只列 200，未列 400／401／404。
