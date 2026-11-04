# 測試指南

## 概覽

| 項目 | 內容 |
| --- | --- |
| 框架 | Vitest 2.1.9 + Supertest 7.2.2 |
| 類型 | API 整合測試：經過完整 Express middleware，寫入真實 SQLite |
| 未涵蓋 | 頁面路由、前端腳本、獨立的單元測試 |
| 規模 | 7 個測試檔、51 個測試 |
| Mock | 只有 `ecpay.test.js` 以 `vi.spyOn(global, 'fetch')` 模擬綠界回應；其他皆無。測試不會連線到綠界 |
| 覆蓋率 | 未安裝 `@vitest/coverage-*`，目前無法產生覆蓋率報告 |

```bash
npm test                                              # 全部執行一次
npx vitest                                            # 監看模式
npx vitest run tests/cart.test.js                     # 單一檔案
npx vitest run --reporter=verbose                     # 列出每個測試
```

執行時的 `The CJS build of Vite's Node API is deprecated` 警告不影響結果。

## 前置條件

- 需要 `JWT_SECRET`，通常來自 `.env`。`npm test` 不會經過 `server.js` 的啟動檢查，缺少時不是立即報錯，而是大量測試失敗。
- 種子管理員必須是 `admin@hexschool.com`／`12345678`（`tests/setup.js` 與 `tests/auth.test.js` 都寫死）。
- 測試不需要先啟動伺服器，也不占用埠號；Supertest 直接使用 `app`。
- `ECPAY_ENV` 不可為 `production`，`ecpay.test.js` 會檢查表單指向 `payment-stage.ecpay.com.tw`。
## 設定（`vitest.config.js`）

| 設定 | 值 | 實際效果 |
| --- | --- | --- |
| `globals` | `true` | 不用匯入 `describe`、`it`、`expect`、`beforeAll` |
| `fileParallelism` | `false` | 測試檔依序執行，避免同時寫入同一個資料庫 |
| `sequence.files` | 7 個檔案的陣列 | **沒有作用**，見下節 |
| `hookTimeout` | `10000` | `beforeAll` 等 hook 上限 10 秒 |

單一測試的逾時使用 Vitest 預設的 5 秒。測試檔只比對預設的 `*.test.js`，`tests/setup.js` 不會被當成測試執行。

## 測試檔案

| 檔案 | 測試數 | 涵蓋內容 | 使用的輔助函式 |
| --- | --- | --- | --- |
| `auth.test.js` | 6 | 註冊成功／重複 Email、登入成功／密碼錯誤、profile 有無 token | 無（只用 `app`、`request`） |
| `products.test.js` | 4 | 列表、分頁、詳情、不存在 | 無 |
| `cart.test.js` | 6 | 訪客模式新增／查詢／修改／刪除、會員新增、商品不存在 | `registerUser` |
| `orders.test.js` | 6 | 建立、空車、未登入、列表、詳情、不存在 | `registerUser` |
| `adminProducts.test.js` | 6 | 列表、新增、修改、刪除、一般使用者 403、未登入 401 | `getAdminToken`、`registerUser` |
| `adminOrders.test.js` | 4 | 列表、狀態篩選、詳情、一般使用者 403 | `getAdminToken`、`registerUser` |
| `ecpay.test.js` | 19 | CheckMacValue 向量（5 筆，由 JSON 動態產生）與驗證、`MerchantTradeNo` 格式、付款表單的 401／404／200、`check-payment` 的 `PAYMENT_NOT_STARTED`／404／轉為 `paid`／冪等／未付款／金額不符／CMV 不符 | `registerUser` |

### 尚未涵蓋的情境

新增或修改以下區域時，請一併補上測試：

- `PATCH /api/orders/:id/pay`：完全沒有測試
- 綠界：`queryAuth` 的無效 token、對非 `pending` 訂單開啟付款頁、連線失敗或 HTTP 錯誤造成的 502、`failed` 訂單查詢、實際連線綠界的流程
- 下單後庫存實際扣減，以及 `STOCK_INSUFFICIENT`
- 購物車累加與超過庫存
- 會員模式的購物車查詢、修改、刪除，以及無效 token 不退回 session
- 跨使用者存取訂單與購物車
- 刪除商品的 409
- 各 API 的欄位驗證錯誤
- 頁面路由與前端

## 執行順序與依賴關係

### 檔案之間

`vitest.config.js` 的 `sequence.files` 看起來指定了 auth → products → cart → orders → adminProducts → adminOrders → ecpay，但**實際並未照此順序**。加入 `ecpay.test.js` 之前的實測順序為：

```text
orders → cart → adminProducts → auth → adminOrders → products
```

順序由 Vitest 預設的排序機制決定，可能隨檔案大小與快取改變，**不要依賴它**。

檔案之間沒有直接的資料傳遞，每個檔案都自行建立使用者與訂單，可以單獨執行。它們的共同依賴是：

- 匯入 `tests/setup.js` 時自動建立的 schema 與種子資料。
- 同一個 `database.sqlite`，以及其中 `products[0]` 的庫存。

### 檔案之內

同一檔案的 `it` 依序執行，且**共用變數形成鏈狀依賴**。前面失敗或被跳過，後面也會失敗：

| 檔案 | 依賴鏈 |
| --- | --- |
| `auth.test.js` | 註冊（設定 `registeredEmail`、`userToken`）→ 重複註冊、profile |
| `products.test.js` | 列表（設定 `productId`）→ 詳情 |
| `cart.test.js` | `beforeAll` 取得 `productId`；訪客新增（設定 `cartItemId`）→ 查詢 → 修改為 3 → 刪除 |
| `orders.test.js` | `beforeAll` 註冊並加入購物車；建立訂單（設定 `orderId`，清空車）→ 空車失敗、列表、詳情 |
| `adminProducts.test.js` | 新增（設定 `createdProductId`）→ 修改 → 刪除 |
| `adminOrders.test.js` | `beforeAll` 完整建立一筆訂單 → 所有測試 |
| `ecpay.test.js` | `check-payment` 區塊：巢狀 `beforeAll` 開啟付款頁（寫入 `merchant_trade_no`）→ 轉為 `paid` → 冪等；其餘情境各自建立使用者與訂單 |

因此 `-t` 或 `it.only` 單獨執行鏈中的測試會失敗。實測 `npx vitest run tests/cart.test.js -t "should update cart item"` 會得到 `expected 404 to be 200`，要除錯時請執行整個檔案。

## 輔助函式（`tests/setup.js`）

這是**一般模組**，檔名雖然是 setup，但沒有設定為 Vitest 的 `setupFiles`，要自行 `require`。匯入它會載入 `app`，同時觸發資料庫初始化。

```js
const { app, request, getAdminToken, registerUser } = require('./setup');
```

| 匯出 | 說明 |
| --- | --- |
| `app` | Express app，未監聽埠號 |
| `request` | Supertest，用法 `request(app).get('/api/products')` |
| `getAdminToken()` | 用種子管理員登入，回傳 JWT 字串 |
| `registerUser(overrides?)` | 註冊新使用者，回傳 `{ token, user }` |

`registerUser` 的 `overrides` 可含 `email`、`password`、`name`。預設 Email 是 `test-<時間戳>-<亂數>@example.com`，每次都不同，預設密碼 `password123`。

兩個輔助函式都不檢查回應狀態。登入或註冊失敗時，會在讀取 `res.body.data.token` 時丟出 `TypeError: Cannot read properties of null`，看到這個錯誤請先檢查 `JWT_SECRET` 與管理員帳密。

## 撰寫新測試

1. **決定位置**：既有資源加到對應檔案；新資源建立 `tests/<resource>.test.js`。Vitest 會自動找到新檔案，**不需要**加入 `sequence.files`（加了也沒有作用）。
2. **匯入輔助函式**，不要匯入 Vitest。
3. **準備資料**：每個 `describe` 自行用 `beforeAll` 建立使用者和商品，不要依賴其他檔案留下的資料。
4. **自建需要控制庫存的商品**，不要用 `products[0]`。
5. **同時驗證狀態碼與回應格式**：成功時 `error` 為 `null`；失敗時 `data` 為 `null`，並檢查錯誤碼。
6. **清理**建立的商品與購物車項目。
7. 執行單一檔案確認通過，再執行 `npm test`。

### 範例

下面的測試已實際執行通過。它驗證累加超過庫存時的錯誤，並示範自建商品與正確的清理順序：

```js
const { app, request, getAdminToken, registerUser } = require('./setup');

describe('Cart stock limit', () => {
  let adminToken;
  let userToken;
  let productId;

  beforeAll(async () => {
    adminToken = await getAdminToken();
    ({ token: userToken } = await registerUser());

    // 自建商品，避免依賴會被其他測試消耗庫存的 products[0]
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '庫存上限測試商品', price: 100, stock: 2 });
    productId = res.body.data.id;
  });

  afterAll(async () => {
    // 先清購物車再刪商品，否則 cart_items 的外鍵會讓 DELETE 回 500
    const cart = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userToken}`);
    for (const item of cart.body.data.items) {
      await request(app)
        .delete(`/api/cart/${item.id}`)
        .set('Authorization', `Bearer ${userToken}`);
    }
    await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('should reject quantity accumulated beyond stock', async () => {
    const first = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 2 });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });

    expect(second.status).toBe(400);
    expect(second.body).toEqual({
      data: null,
      error: 'STOCK_INSUFFICIENT',
      message: '庫存不足',
    });
  });
});
```

### 認證 header 寫法

```js
// 會員或管理員
.set('Authorization', `Bearer ${token}`)

// 訪客購物車；sessionId 要唯一，避免與前次執行的資料衝突
.set('X-Session-Id', 'test-session-' + Date.now())
```

### 常用斷言

```js
// 成功
expect(res.status).toBe(200);
expect(res.body).toHaveProperty('error', null);

// 失敗（比只檢查 error 不為 null 更精確）
expect(res.status).toBe(400);
expect(res.body).toHaveProperty('data', null);
expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
```

## 常見陷阱

### 1. 測試會修改開發資料庫

`src/database.js` 把路徑固定為 `database.sqlite`，測試**沒有隔離的資料庫**，也沒有清理或回滾。從全新資料庫執行一次 `npm test` 的結果（前 6 個檔案為實測，再加上依程式碼推算的 `ecpay.test.js`）：

| 資料 | 變化 |
| --- | --- |
| `users` | 新增 13 筆（`ecpay.test.js` 佔 7 筆） |
| `orders` | 新增 7 筆（`ecpay.test.js` 佔 5 筆，其中 1 筆為 `paid`） |
| `cart_items` | 留下 1 筆（`cart.test.js` 的會員新增未清理） |
| `products[0]` 庫存 | 減少 7（`orders`、`adminOrders` 各 1 件，`ecpay` 5 件） |

開發時在瀏覽器看到的測試帳號與訂單就是這樣來的。需要乾淨資料時請重置資料庫。

### 2. 重複執行會耗盡庫存

每次執行 `products[0]`（新資料庫上是庫存 30 的「粉色玫瑰花束」）減少 7，而 `cart.test.js` 需要把數量改為 3。依此推算，**大約 4 次後**庫存就不夠，出現與程式無關的失敗。加入 `ecpay.test.js` 之前，實測把所有庫存設為 0 時，`cart`、`orders`、`adminOrders` 三個檔案會失敗（8 個測試失敗、4 個被跳過）；現在 `ecpay.test.js` 同樣會受影響。

遇到時先重置資料庫：

```bash
# 先停止伺服器；這會刪除所有本機資料
rm -f database.sqlite database.sqlite-wal database.sqlite-shm
npm test
```

只刪 `database.sqlite` 而留下 `-wal`、`-shm` 可能造成資料庫狀態不一致，三個檔案要一起刪。

### 3. 不要假設 `products[0]` 是哪個商品

列表依 `created_at DESC` 排序，時間只精確到秒且沒有第二排序鍵。後台新增的商品會排到最前面，因此若測試或手動操作留下新商品，`products[0]` 就會變成它。例如庫存很低的商品會讓其他測試失敗。

### 4. `sequence.files` 沒有作用

如上所述，不要依賴測試檔的順序，也不要讓一個檔案使用另一個檔案產生的資料。

### 5. 缺少 `JWT_SECRET` 的症狀不明顯

測試略過 `server.js` 的檢查。缺少時，實測日誌出現 `Unhandled error: secretOrPrivateKey must have a value`，且 `beforeAll` 內的 `TypeError` 讓多個檔案失敗、大量測試被跳過。**新環境先確認 `.env` 已建立。**

### 6. 修改管理員環境變數會破壞測試

把 `.env` 的 `ADMIN_EMAIL` 或 `ADMIN_PASSWORD` 改成其他值，且資料庫是全新建立時，種子管理員就與寫死的帳密不符，所有用到 `getAdminToken` 的測試都會失敗。已存在的資料庫中，修改 `ADMIN_PASSWORD` 則不會生效。

### 7. 刪除測試商品的順序

商品還在任何購物車中時，刪除會回 **500**（外鍵），而不是 409。要先清購物車，再刪商品。同理，商品在 `pending` 訂單中無法刪除（409），訂單沒有取消功能，因此**下過單的測試商品要先用 `PATCH .../pay` 改變狀態才能刪除**。

### 8. 同一個 Session ID 跨次執行

固定的 `X-Session-Id` 會在資料庫中累積購物車資料，導致累加後超過庫存。請像 `cart.test.js` 一樣加上 `Date.now()`。Email 也一樣，固定值在第二次執行時會得到 409。

### 9. bcrypt 影響執行時間

`NODE_ENV=test` 只把**種子管理員**的 cost 降為 1，`POST /api/auth/register` 固定使用 cost 10。大量呼叫 `registerUser` 會明顯變慢，單一測試預設 5 秒逾時，建議在 `beforeAll` 建立一次後共用。

### 10. 非同步驗證要 `await`

Supertest 的請求必須 `await`，否則測試可能在斷言執行前就結束並顯示通過。

### 11. CheckMacValue 測試向量是複製來的

`tests/fixtures/ecpay-checkmacvalue.json` 複製自 `.claude/skills/ecpay/test-vectors/checkmacvalue.json`，目前內容相同，且兩者都已納入版控。測試只讀 fixture，所以更新或移除 skill 不會影響測試。兩者不會自動同步，skill 的向量更新時要手動重新複製。檔案共 8 筆向量，`ecpay.test.js` 只使用其中 5 筆 `method` 為 `SHA256` 且沒有 `formula` 的向量。

### 12. 模擬綠界回應

`queryTradeInfo` 使用全域 `fetch`，以 `vi.spyOn(global, 'fetch').mockResolvedValueOnce(...)` 模擬，並在測試結束時 `mockRestore()`。回應本體要用 `generateCheckMacValue` 算出正確的 `CheckMacValue`，否則會先在 CMV 驗證回 502，測不到後面的金額或狀態邏輯。`vi` 由 `globals: true` 提供，不需匯入。
