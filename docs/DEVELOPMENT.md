# 開發規範

本文件描述專案**目前實際遵循**的慣例。專案沒有設定 ESLint、Prettier 或 commit 規範，請以既有程式碼風格為準：2 空格縮排、單引號、保留分號。

## 命名規則

| 對象 | 規則 | 範例 |
| --- | --- | --- |
| 後端路由檔 | camelCase + `Routes.js` | `cartRoutes.js`、`adminOrderRoutes.js` |
| Middleware 檔 | camelCase + `Middleware.js`（錯誤處理例外） | `authMiddleware.js`、`errorHandler.js` |
| 前端頁面腳本 | kebab-case，與 `pageScript` 相同 | `public/js/pages/order-detail.js` |
| 前端共用腳本 | 小寫，多字用 kebab-case | `auth.js`、`header-init.js` |
| EJS 頁面與 partial | kebab-case | `product-detail.ejs`、`admin-sidebar.ejs` |
| 後台頁面 | `views/pages/admin/` 下用資源名；腳本加 `admin-` 前綴 | `admin/orders.ejs` ↔ `admin-orders.js` |
| 測試檔 | camelCase + `.test.js` | `adminProducts.test.js` |
| 資料表 | snake_case 複數 | `cart_items`、`order_items` |
| 資料庫欄位 | snake_case | `recipient_email`、`created_at` |
| URL 路徑 | 小寫複數資源；後台加 `/admin` | `/api/admin/products` |
| 路徑參數 | camelCase | `:id`、`:itemId` |
| 請求 body 欄位 | camelCase（後台商品的 `image_url` 例外） | `productId`、`recipientName` |
| 回應欄位 | snake_case，對應資料庫欄位 | `order_no`、`total_amount` |
| 分頁物件 | camelCase | `totalPages` |
| 錯誤碼 | UPPER_SNAKE_CASE | `STOCK_INSUFFICIENT` |
| 自訂 header | `X-` 前綴 | `X-Session-Id` |
| 環境變數 | UPPER_SNAKE_CASE；同服務共用前綴 | `ECPAY_HASH_KEY` |
| localStorage key | `flower_` 前綴 | `flower_token` |
| 前端全域物件 | PascalCase | `Auth`、`Notification` |
| JS 函式與變數 | camelCase | `getOwnerCondition`、`loadProducts` |
| Tailwind 自訂色 | `@theme` 中 `--color-*` | `--color-rose-primary` → `bg-rose-primary` |

## 模組系統

專案有三種不同的模組環境，**不可互相套用**：

| 範圍 | 系統 | 語法 | 備註 |
| --- | --- | --- | --- |
| 後端（`server.js`、`app.js`、`src/`） | CommonJS | `require` / `module.exports` | `package.json` 未設定 `"type"` |
| 測試（`tests/`） | CommonJS | `require` | `describe`、`it`、`expect`、`beforeAll` 由 `globals: true` 提供，不需匯入 |
| `vitest.config.js` | ESM | `import` / `export default` | 由 Vitest 載入，是唯一例外 |
| 瀏覽器（`public/js/`） | 傳統 `<script>` | 全域變數 | **不能**使用 `import`／`require` |

前端規則：

- 共用腳本在全域定義 `Auth`、`apiFetch`、`Notification`，並依 layout 的順序載入。
- `const Notification` 會遮蔽瀏覽器原生的 Notification API：直接寫 `Notification` 取得的是專案的 toast 物件。若未來要用桌面通知，須明確寫 `window.Notification`。
- 頁面腳本開頭的 `const { createApp, ref } = Vue;` 位於全域語彙範圍，所以**每頁只能載入一支**頁面腳本，否則會重複宣告而報錯。
- 前端沒有轉譯流程，寫的語法會原樣送到瀏覽器。

## 同步資料存取

better-sqlite3 是同步 API，這決定了後端的寫法：

- 路由 handler 全部是同步函式。同步丟出的例外會被 Express 交給 `errorHandler`。
- 若新增 `async` handler，Express 4 **不會**捕捉 rejected promise，必須自行處理：

  ```js
  router.post('/', async (req, res, next) => {
    try {
      // 呼叫外部服務……
    } catch (err) {
      next(err);
    }
  });
  ```

- 多表寫入一律使用 `db.transaction()`，函式必須是同步的，**不可**在其中 `await`：

  ```js
  const createOrder = db.transaction(() => {
    // 多個 INSERT／UPDATE；任一丟錯就全部回滾
  });
  createOrder();
  ```

- 一律使用 `?` 參數綁定。`cartRoutes.js` 的 `${owner.field}` 是唯一的 SQL 字串插值，其值由 `getOwnerCondition` 固定為 `user_id` 或 `session_id`，不來自使用者輸入；不要仿照這個寫法插入外部值。

## 新增 API 的步驟

以新增「取消訂單」為例。

**1. 決定認證方式。** 依下表選擇掛載方式。

| 需求 | 寫法 | 參考 |
| --- | --- | --- |
| 公開 | 不掛 middleware | `productRoutes.js` |
| 整個 router 需登入 | `router.use(authMiddleware)` | `orderRoutes.js` |
| 整個 router 限管理員 | `router.use(authMiddleware, adminMiddleware)` | `adminProductRoutes.js` |
| 單一路由需登入 | `router.get('/x', authMiddleware, handler)` | `authRoutes.js` 的 `profile` |
| 訪客或會員皆可 | 目前 `dualAuth` 只在 `cartRoutes.js` 內；要共用須先抽到 `src/middleware/` | `cartRoutes.js` |

**2. 寫 handler，遵循回應格式。** 先驗證輸入，再查資料，再寫入。查詢時務必帶入擁有者條件，他人的資源應回 404 而不是 403，避免洩漏資源是否存在。

```js
router.patch('/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);

  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    return res.status(400).json({
      data: null,
      error: 'INVALID_STATUS',
      message: '只有待付款訂單可以取消'
    });
  }

  // 多表寫入使用 db.transaction()

  res.json({ data: { id: order.id }, error: null, message: '訂單已取消' });
});
```

**3. 驗證時檢查型別。** 只用 `!value` 或直接呼叫字串方法，遇到數字、`null`、物件時會變成 500（見 [FEATURES.md 已知問題](./FEATURES.md#已知問題與限制)）。新程式碼請加上 `typeof value === 'string'` 檢查。

**4. 使用既有錯誤碼。** 完整列表在 [FEATURES.md](./FEATURES.md#錯誤碼總表)。真的需要新錯誤碼時，要同步更新該表。

**5. 新路由檔要掛到 `app.js`。** 放在 `pageRoutes` 之前，因為頁面路由掛在 `/`。

```js
app.use('/api/coupons', require('./src/routes/couponRoutes'));
```

同一個 router 內，固定路徑要寫在 `/:id` 之前。

**6. 加上 `@openapi` 註解**，執行 `npm run openapi` 確認能產生。

**7. 寫測試**，步驟見 [TESTING.md](./TESTING.md#撰寫新測試)。

**8. 更新文件**：`FEATURES.md`、`CHANGELOG.md`；若新增路由前綴或資料表，也要更新 `ARCHITECTURE.md`。

## 新增 Middleware 的步驟

1. 在 `src/middleware/` 建立 `xxxMiddleware.js`，匯出單一函式：

   ```js
   function requireMember(req, res, next) {
     if (!req.user) {
       return res.status(401).json({ data: null, error: 'UNAUTHORIZED', message: '請先登入' });
     }
     next();
   }

   module.exports = requireMember;
   ```

2. 決定掛載層級：

   | 層級 | 位置 | 注意 |
   | --- | --- | --- |
   | 全域 | `app.js`，API 路由之前 | 排在 `express.static` 之後，不會作用於靜態檔；頁面路由也會經過 |
   | Router | `router.use(...)` | 影響該 router 所有路由 |
   | 單一路由 | `router.get('/x', mw, handler)` | 最精確 |

3. 拒絕請求時回傳統一格式，且要 `return` 避免繼續執行。
4. 依賴 `req.user` 的 middleware 要排在 `authMiddleware` 之後；`dualAuth` 的路由在訪客模式下 `req.user` 不存在。
5. 錯誤處理 middleware 必須有**四個參數**，Express 才會識別，並掛在所有路由之後。
6. 目前設定到 `req` 的欄位是 `req.user`（`{ userId, email, role }`）與 `req.sessionId`。注意欄位名是 `userId`，不是資料庫的 `id`。

## 修改資料庫的步驟

專案**沒有 migration 機制**。Schema 只在 `src/database.js` 的 `CREATE TABLE IF NOT EXISTS` 中定義，這句對已存在的資料表不起作用。

### 新增資料表

在 `initializeDatabase()` 的 `db.exec` 中加入 `CREATE TABLE IF NOT EXISTS`。重啟後自動建立，遵循這些慣例：

```sql
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,                               -- 應用程式產生的 UUID
  code TEXT UNIQUE NOT NULL,
  discount INTEGER NOT NULL CHECK(discount > 0),     -- 金額用整數
  created_at TEXT NOT NULL DEFAULT (datetime('now')) -- UTC 文字
);
```

### 修改既有資料表

只改 `CREATE TABLE` **不會影響已存在的資料庫**，其他開發者也不會自動取得變更。可選做法：

| 情況 | 做法 |
| --- | --- |
| 資料可丟棄（本機開發） | 修改 `CREATE TABLE`，停止伺服器後刪除 `database.sqlite`、`-wal`、`-shm` |
| 需要保留資料 | 修改 `CREATE TABLE`，並在 `initializeDatabase()` 加入具冪等性的 `ALTER TABLE`（先以 `PRAGMA table_info` 檢查欄位） |

SQLite 無法直接修改既有的 CHECK 約束，例如要新增訂單狀態 `cancelled` 時，保留資料就必須重建資料表。

### 修改時的連帶檢查

- 新增外鍵會影響刪除行為：外鍵預設 `NO ACTION`，違反時丟出例外，路由未處理就成為 500。
- 訂單相關資料要保留快照，不要讓歷史訂單依賴可變動的商品資料。
- 新增訂單狀態時，還要修改：`adminOrderRoutes.js` 的白名單陣列、`orderRoutes.js` 的狀態檢查、前端三處 `statusMap`（`orders.js`、`order-detail.js`、`admin-orders.js`）、`views/pages/admin/orders.ejs` 的篩選選項。
- 種子資料只在特定條件下寫入，修改 `seedProducts` 內容不會影響已有商品的資料庫。

## 新增頁面的步驟

1. 建立 `views/pages/foo.ejs`，根元素為 `<div id="app">`。伺服器資料用 `data-*` 搭配 `<%= %>` 傳遞。
2. 建立 `public/js/pages/foo.js`：

   ```js
   const { createApp, ref, onMounted } = Vue;

   createApp({
     setup() {
       if (!Auth.requireAuth()) return {}; // 需要登入時才加

       const items = ref([]);
       const loading = ref(true);

       onMounted(async function () {
         try {
           const res = await apiFetch('/api/foo');
           items.value = res.data.items;
         } catch (e) {
           Notification.show('載入失敗', 'error');
         } finally {
           loading.value = false;
         }
       });

       return { items, loading };
     }
   }).mount('#app');
   ```

3. 在 `pageRoutes.js` 註冊，`pageScript` 必須與檔名相同：

   ```js
   router.get('/foo', function (req, res) {
     renderFront(res, 'foo', { title: '標題', pageScript: 'foo' });
   });
   ```

4. 後台頁面改用 `renderAdmin`、放在 `views/pages/admin/`，傳入 `currentPath`，並在 `admin-sidebar.ejs` 加入連結。
5. 用到新的 Tailwind class 時要重新建置 CSS（`npm run dev:css` 會自動處理）。
6. 頁面的「權限檢查」只是導頁，敏感資料必須由 API 把關。

Toast 類型：`Notification.show(message, 'success' | 'error' | 'warning' | 'info')`。

品牌色定義在 `public/css/input.css` 的 `@theme`：`rose-primary`、`rose-dark`、`rose-light`、`apricot`、`sage`、`cream`、`blush`、`rose-bg`、`text-primary`、`text-secondary`、`text-muted`。

## 環境變數

`.env` 由 `app.js` 第一行的 `dotenv.config()` 從目前工作目錄載入，已存在的系統環境變數優先。`.env.example` 是範本。

| 變數 | 用途 | 必要性 | 預設值 | 注意事項 |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | 簽發與驗證 JWT | **必要** | 無 | `server.js` 缺少時拒絕啟動；測試不做此檢查，會在簽發時得到 500。更換後所有 token 失效 |
| `PORT` | 監聽埠號 | 選填 | `3001` | 不在 `.env.example` 中。`swagger-config.js` 寫死 3001 |
| `FRONTEND_URL` | CORS 允許的單一來源 | 選填 | `http://localhost:3001` | 內建頁面同源，不受影響 |
| `ADMIN_EMAIL` | 種子管理員 Email | 選填 | `admin@hexschool.com` | 只在此 Email 不存在時建立；改值會**新增**管理員，舊的仍存在。測試寫死預設值 |
| `ADMIN_PASSWORD` | 種子管理員密碼 | 選填 | `12345678` | 只在建立時生效，帳號已存在後修改**無效**。測試寫死預設值 |
| `NODE_ENV` | 只影響種子管理員的 bcrypt cost | 選填 | 未設定 | `test` 時 cost 為 1，否則 10。Vitest 會自動設為 `test`。註冊的 cost 固定為 10 |
| `BASE_URL` | 預留 | 目前未使用 | 無 | 沒有程式讀取 |
| `ECPAY_MERCHANT_ID` | 預留給 ECPay | 目前未使用 | 無 | 沒有程式讀取 |
| `ECPAY_HASH_KEY` | 預留給 ECPay | 目前未使用 | 無 | 沒有程式讀取 |
| `ECPAY_HASH_IV` | 預留給 ECPay | 目前未使用 | 無 | 沒有程式讀取 |
| `ECPAY_ENV` | 預留給 ECPay | 目前未使用 | 無 | 沒有程式讀取 |

新增環境變數時：更新 `.env.example` 與上表，敏感值不要提交到 git（`.gitignore` 已忽略 `.env` 與 `.env.*`，並保留 `.env.example`）。

## JSDoc 格式

專案有兩種註解。

### `@openapi` 區塊（路由必備）

每個 API 路由正上方一個區塊，內容是 YAML，由 `swagger-jsdoc` 解析。專案目前 19 個操作都有。

```js
/**
 * @openapi
 * /api/orders/{id}/cancel:
 *   patch:
 *     summary: 取消訂單
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 訂單已取消
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.patch('/:id/cancel', (req, res) => { /* ... */ });
```

規則：

- 第一層路徑要寫**完整路徑**（含掛載前綴），參數用 `{id}`，不是 Express 的 `:id`。
- 註解不會自動與實作同步，修改行為時要一起修改。
- YAML 對縮排敏感；改完執行 `npm run openapi` 確認。
- `tags` 使用既有名稱：`Auth`、`Products`、`Cart`、`Orders`、`Admin Products`、`Admin Orders`。
- `security` 使用 `swagger-config.js` 定義的名稱：`bearerAuth`、`sessionId`。兩者列為陣列的不同項目代表「擇一」，如 `cartRoutes.js`。
- 公開 API 省略 `security`。
- 只有 `src/routes/*.js` 會被掃描；放在 middleware 檔中的 `@openapi` 不會生效。

### 一般 JSDoc（共用輔助函式）

目前用於 `tests/setup.js`。匯出給其他檔案使用的輔助函式，請說明用途、參數與回傳值；路由內的私有小函式可省略（既有程式碼如 `dualAuth`、`generateOrderNo` 也沒有寫）。

```js
/**
 * Register a new user and return { token, user }.
 *
 * @param {{ email?: string, password?: string, name?: string }} [overrides]
 * @returns {Promise<{ token: string, user: { id: string, email: string, name: string, role: string } }>}
 */
async function registerUser(overrides = {}) { /* ... */ }
```

## 計畫歸檔流程

1. 計畫檔案命名格式：YYYY-MM-DD-<feature-name>.md
2. 計畫文件結構：User Story → Spec → Tasks
3. 功能完成後：移至 docs/plans/archive/
4. 更新 docs/FEATURES.md 和 docs/CHANGELOG.md

### 計畫文件範本

新計畫放在 `docs/plans/`，例如 `docs/plans/2026-11-10-order-cancel.md`：

```markdown
# 取消訂單

## User Story
身為已下單的會員，我想取消尚未付款的訂單，讓庫存釋出且不必付款。

## Spec
- 端點：PATCH /api/orders/:id/cancel（JWT）
- 只有 pending 可取消，否則 400 INVALID_STATUS；非本人或不存在回 404 NOT_FOUND
- 在 transaction 內更新狀態並回補庫存
- Schema：orders.status 的 CHECK 需新增 cancelled（須重建資料表）

## Tasks
- [ ] 修改 schema 與資料遷移方式
- [ ] 實作 API 與 @openapi 註解
- [ ] 更新前端 statusMap 與訂單詳情頁
- [ ] 撰寫測試
- [ ] 更新 FEATURES.md、CHANGELOG.md
```

完成後用 `git mv` 移動，保留歷史：

```bash
git mv docs/plans/2026-11-10-order-cancel.md docs/plans/archive/
```

`docs/plans/` 與 `docs/plans/archive/` 內的 `.gitkeep` 用來讓 git 追蹤空目錄。
