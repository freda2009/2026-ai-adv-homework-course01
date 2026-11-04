# 功能清單

本文件依原始碼撰寫，邊界行為（標示「實測」）已用 Supertest 驗證。前端行為是依程式碼描述，未在瀏覽器逐一操作。

## 完成狀態總覽

狀態：✅ 已完成｜⚠️ 部分完成或僅模擬｜❌ 未實作。「測試」欄表示 `tests/` 是否涵蓋該功能的主要路徑。

| 功能 | 狀態 | 測試 | 備註 |
| --- | --- | --- | --- |
| 註冊、登入、個人資料 API | ✅ | ✅ | 無修改資料、改密碼、忘記密碼功能 |
| 商品列表與詳情 API | ✅ | ✅ | 無搜尋、分類、排序參數 |
| 訪客購物車 | ✅ | ✅ | `X-Session-Id` |
| 會員購物車 | ✅ | ⚠️ | 測試僅涵蓋加入 |
| 訪客車併入會員車 | ❌ | — | 登入後看不到訪客車 |
| 建立訂單（扣庫存、清空車） | ✅ | ⚠️ | 未驗證庫存實際扣減與庫存不足 |
| 訂單列表與詳情 | ✅ | ✅ | 列表無分頁 |
| 模擬付款 | ✅ | ❌ | `PATCH /api/orders/:id/pay`，保留供開發測試；頁面已無按鈕 |
| ECPay 金流 AIO | ✅ | ✅ | `GET /ecpay/payment/:orderId`（付款）、`POST /api/orders/:id/check-payment`（查詢） |
| 運費 | ⚠️ | ❌ | 僅前端顯示，不計入訂單金額 |
| 後台商品 CRUD | ✅ | ✅ | 未測試 409 與驗證錯誤 |
| 後台訂單列表與詳情 | ✅ | ✅ | 無法變更狀態 |
| 取消訂單、出貨流程 | ❌ | — | 狀態只有 pending／paid／failed |
| 前台頁面 | ✅ | ❌ | 測試只涵蓋 API |
| 後台頁面 | ✅ | ❌ | 同上 |
| OpenAPI 規格產生 | ✅ | — | 無 Swagger UI |
| 速率限制、登入鎖定 | ❌ | — | |

## 錯誤碼總表

| 錯誤碼 | HTTP | 情境 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 欄位缺失或格式錯誤 |
| `CART_EMPTY` | 400 | 以空購物車建立訂單 |
| `STOCK_INSUFFICIENT` | 400 | 加入、修改購物車或下單時超過庫存 |
| `INVALID_STATUS` | 400 | 對非 `pending` 訂單付款 |
| `UNAUTHORIZED` | 401 | 未登入、token 無效或過期、使用者不存在、帳密錯誤 |
| `FORBIDDEN` | 403 | 非管理員存取後台 API |
| `NOT_FOUND` | 404 | 資源不存在或不屬於本人；未定義的 `/api` 路徑 |
| `CONFLICT` | 409 | Email 已註冊；刪除有 `pending` 訂單的商品 |
| `INTERNAL_ERROR` | 500 或其他 | `errorHandler` 的固定錯誤碼；無效 JSON 時狀態碼是 400 但錯誤碼仍是這個 |
| `PAYMENT_NOT_STARTED` | 400 | 尚未發起綠界付款即查詢（`merchant_trade_no` 為 null） |
| `ECPAY_QUERY_FAILED` | 502 | 綠界連線失敗、CheckMacValue 不符或交易金額不符 |

## 認證

### 行為描述

註冊成功後直接回傳 token，等同自動登入，前端不需要再呼叫登入 API。新帳號的角色固定為 `user`，body 中的 `role` 會被忽略；系統沒有提升權限的 API，管理員只來自種子資料。Token 有效期 7 天，沒有 refresh 機制，也沒有伺服器端登出，登出就是前端刪除 token。

登入時「Email 不存在」與「密碼錯誤」回傳相同訊息，避免洩漏帳號是否存在。Email 比對區分大小寫，`A@x.co` 和 `a@x.co` 是兩個帳號。

### `POST /api/auth/register`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `email` | 是 | 符合 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`，且未被註冊 |
| `password` | 是 | 至少 6 字元；須為字串 |
| `name` | 是 | 非空；不去除前後空白 |

驗證順序：必填 → Email 格式 → 密碼長度 → Email 重複。密碼以 bcrypt cost 10 雜湊。

成功回 201：

```json
{
  "data": {
    "user": { "id": "uuid", "email": "a@example.com", "name": "小明", "role": "user" },
    "token": "eyJ..."
  },
  "error": null,
  "message": "註冊成功"
}
```

| 狀態 | 錯誤碼 | 訊息 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `email、password、name 為必填欄位` |
| 400 | `VALIDATION_ERROR` | `Email 格式不正確` |
| 400 | `VALIDATION_ERROR` | `密碼至少需要 6 個字元` |
| 409 | `CONFLICT` | `Email 已被註冊` |

### `POST /api/auth/login`

Body：`email`、`password` 皆必填。登入不檢查 Email 格式，也不檢查密碼長度。成功回 200，`data` 結構與註冊相同，訊息為 `登入成功`。

| 狀態 | 錯誤碼 | 訊息 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `email 和 password 為必填欄位` |
| 401 | `UNAUTHORIZED` | `Email 或密碼錯誤` |

### `GET /api/auth/profile`

需 JWT。回傳 `id`、`email`、`name`、`role`、`created_at`，不含密碼雜湊。401 情境見 [ARCHITECTURE.md](./ARCHITECTURE.md#middleware-行為)。程式碼有 404 分支，但 `authMiddleware` 已先確認使用者存在，正常流程不會觸發。

### 前端登入頁

`/login` 以分頁切換登入與註冊，前端先驗證必填與密碼長度。成功後把 token 與 user 存入 localStorage，並導向 `?redirect=` 指定的網址，預設 `/`。

## 商品（公開）

### 行為描述

商品 API 不需要認證。售完商品（`stock = 0`）仍會出現在列表與詳情中，由前端顯示「已售完」並停用按鈕。回傳的是完整資料表欄位。

### `GET /api/products`

| 查詢參數 | 預設 | 規則（實測） |
| --- | --- | --- |
| `page` | 1 | 非數字或 ≤ 0 視為 1 |
| `limit` | 10 | 上限 100；`0` 或非數字視為 10；負數變成 1 |

參數無效時不回錯誤，而是修正後繼續處理，實際採用的值會在 `pagination` 中回傳。依 `created_at DESC` 排序。

```json
{
  "data": {
    "products": [
      {
        "id": "uuid",
        "name": "粉色玫瑰花束",
        "description": "...",
        "price": 1680,
        "stock": 30,
        "image_url": "https://...",
        "created_at": "2026-11-03 15:33:16",
        "updated_at": "2026-11-03 15:33:16"
      }
    ],
    "pagination": { "total": 8, "page": 1, "limit": 10, "totalPages": 1 }
  },
  "error": null,
  "message": "成功"
}
```

### `GET /api/products/:id`

`data` 為單一商品物件。不存在回 404 `NOT_FOUND`：`商品不存在`。

### 前端行為

首頁固定用 `limit=9`。「精選推薦」取**目前分頁**的前 4 筆，所以換頁時精選區也會改變，並不是真正的精選清單。商品詳情頁的數量選擇器上限是庫存，下限是 1。

## 購物車

### 雙模式認證

購物車是專案中唯一允許未登入使用的寫入功能，擁有者由 `dualAuth` 決定：

| 請求內容 | 模式 | 擁有者欄位 |
| --- | --- | --- |
| 有效的 Bearer token | 會員 | `user_id` |
| 有效的 Bearer token + `X-Session-Id` | 會員（session 被忽略） | `user_id` |
| 無效或過期的 Bearer token + `X-Session-Id` | **401**（不退回訪客模式） | — |
| 只有 `X-Session-Id`（或非 Bearer 的 Authorization） | 訪客 | `session_id` |
| 都沒有 | 401 | — |

前端永遠同時送出兩者，所以登入中一定走會員模式。

**訪客車與會員車完全分離，且沒有合併邏輯：**

1. 訪客把商品加入購物車（存於 `session_id`）。
2. 訪客點「前往結帳」，導向 `/login?redirect=/checkout`。
3. 登入後導回 `/checkout`，會員車是空的，於是被導向 `/cart` 並顯示空車。
4. 登出後 `flower_session_id` 仍保留，原本的訪客車商品會再次出現。

串接前端或實作合併功能時要特別注意這個流程。

`X-Session-Id` 不綁定使用者，也沒有到期機制，知道 ID 就能存取該購物車；訪客車資料不會自動清除。

### `GET /api/cart`

```json
{
  "data": {
    "items": [
      {
        "id": "cart-item-uuid",
        "product_id": "product-uuid",
        "quantity": 2,
        "product": { "name": "粉色玫瑰花束", "price": 1680, "stock": 30, "image_url": "https://..." }
      }
    ],
    "total": 3360
  },
  "error": null,
  "message": "成功"
}
```

`total` 是商品小計，**不含運費**，並以目前價格計算。沒有 `ORDER BY`，項目順序不保證。此 API 不會標示數量已超過目前庫存的項目。

### `POST /api/cart`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `productId` | 是 | 商品必須存在 |
| `quantity` | 否，預設 1 | 經 `parseInt` 後須 ≥ 1 |

**累加邏輯：** 同一擁有者已有此商品時，`新數量 = 現有數量 + quantity`，且檢查的是**累加後的總數**是否超過庫存；否則新增一列。加入購物車**不會**扣庫存或保留庫存。

成功一律回 **200**（新增時也不是 201），訊息 `已加入購物車`；`data` 為 `{ id, product_id, quantity }`，`quantity` 是累加後的總數。

`parseInt` 造成的寬鬆行為（實測）：`"2abc"` 視為 2，`1.9` 視為 1。

| 狀態 | 錯誤碼 | 訊息 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `productId 為必填欄位` |
| 400 | `VALIDATION_ERROR` | `quantity 必須為正整數` |
| 400 | `STOCK_INSUFFICIENT` | `庫存不足` |
| 404 | `NOT_FOUND` | `商品不存在` |

### `PATCH /api/cart/:itemId`

Body：`quantity` 必填，規則同上。這裡是**直接設定**數量，不是累加。項目不存在或不屬於目前擁有者都回 404 `購物車項目不存在`。超過庫存回 400 `STOCK_INSUFFICIENT`。不能用來設為 0，移除要用 DELETE。

### `DELETE /api/cart/:itemId`

成功時 `data` 為 `null`，訊息 `已從購物車移除`。其他擁有者的項目回 404。

### 前端運費顯示

`/cart` 與 `/checkout` 各自在模板中寫死：小計 ≥ 500 免運，否則運費 150，並顯示含運總計。**後端完全沒有運費概念**，訂單的 `total_amount` 不含運費。例如小計 300 的訂單，結帳頁顯示 NT$ 450，訂單頁顯示 NT$ 300。種子商品最低價 580 所以不會遇到，但後台新增低價商品就會出現。

## 訂單

### 行為描述

訂單只有會員能建立，**資料來源永遠是該會員的購物車**，不接受在 body 中指定商品或金額，價格由後端依資料庫計算。所有訂單 API 都限制只能存取本人訂單，他人訂單回 404。

### `POST /api/orders`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `recipientName` | 是 | 非空 |
| `recipientEmail` | 是 | 符合 Email 格式 |
| `recipientAddress` | 是 | 非空 |

執行步驟：

1. 驗證收件資訊。
2. 讀取會員購物車，JOIN 商品的目前名稱、價格、庫存。
3. 車為空回 `CART_EMPTY`。
4. 任一項數量超過庫存就回 `STOCK_INSUFFICIENT`，訊息列出所有不足的商品名稱。
5. 計算 `total_amount = Σ(目前價格 × 數量)`。
6. 產生訂單編號 `ORD-YYYYMMDD-XXXXX`（UTC 日期 + UUID 前 5 碼大寫）。
7. **在單一 transaction 內：**
   - 新增 `orders`，狀態預設 `pending`
   - 逐項新增 `order_items`，保存名稱與價格快照
   - 逐項 `UPDATE products SET stock = stock - ?`
   - 刪除該會員全部購物車項目

任一步失敗都會全部回滾。庫存在此時扣除，不是付款時；`products.updated_at` 不會更新。

訂單編號的隨機部分只有 5 個十六進位字元（同日約 100 萬種組合），若碰撞會違反 UNIQUE 而回 500，程式沒有重試。

成功回 201，訊息 `訂單建立成功`：

```json
{
  "data": {
    "id": "uuid",
    "order_no": "ORD-20261103-77DF3",
    "total_amount": 3360,
    "status": "pending",
    "items": [
      { "product_name": "粉色玫瑰花束", "product_price": 1680, "quantity": 2 }
    ],
    "created_at": "2026-11-03 15:32:34"
  },
  "error": null,
  "message": "訂單建立成功"
}
```

注意這裡的 `items` 只有 3 個欄位，與詳情 API 不同。

| 狀態 | 錯誤碼 | 訊息 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `收件人姓名、Email 和地址為必填欄位` |
| 400 | `VALIDATION_ERROR` | `Email 格式不正確` |
| 400 | `CART_EMPTY` | `購物車為空` |
| 400 | `STOCK_INSUFFICIENT` | `以下商品庫存不足：A, B` |
| 401 | `UNAUTHORIZED` | 只帶 `X-Session-Id` 也是 401（實測） |

### `GET /api/orders`

回傳本人訂單，依 `created_at DESC` 排序，**沒有分頁**。`data.orders[]` 欄位：`id`、`order_no`、`total_amount`、`status`、`created_at`。

### `GET /api/orders/:id`

回傳 `orders` 所有欄位（含 `user_id` 與綠界的 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at`）加 `items`，`items` 是 `order_items` 所有欄位：`id`、`order_id`、`product_id`、`product_name`、`product_price`、`quantity`。不存在或非本人回 404 `訂單不存在`。商品被刪除後仍可正常查詢（實測）。

### `PATCH /api/orders/:id/pay`（模擬付款）

保留供開發與測試使用，**前端已不再呼叫**，只能直接打 API。實際付款流程見 [ECPay 金流](#ecpay-金流aio)。

Body：`action` 必填，`success` 或 `fail`。

| action | 新狀態 | 訊息 |
| --- | --- | --- |
| `success` | `paid` | `付款成功` |
| `fail` | `failed` | `付款失敗` |

只有 `pending` 訂單可操作。`paid` 與 `failed` 都是終態，再次呼叫回 `INVALID_STATUS`（實測）。**付款失敗不會回補庫存**（實測）。回傳結構與訂單詳情相同。

| 狀態 | 錯誤碼 | 訊息 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | `action 必須為 success 或 fail` |
| 400 | `INVALID_STATUS` | `訂單狀態不是 pending，無法付款` |
| 404 | `NOT_FOUND` | `訂單不存在` |

### 前端行為

`/orders/:id` 只在 `pending` 時顯示「前往綠界付款」與「查詢付款狀態」。`?payment=success|failed|cancel|pending` 會顯示對應提示，但不影響實際狀態。狀態標籤：`pending` 待付款、`paid` 已付款、`failed` 付款失敗。

## ECPay 金流（AIO）

### 行為描述

使用綠界 AIO（全方位金流）付款頁，信用卡等付款資料都在綠界頁面輸入，本站不經手。本專案設計為在 localhost 執行，綠界無法連回，因此**沒有實作 Server Notify**：訂單狀態只會在使用者按「查詢付款狀態」時，由後端呼叫 `QueryTradeInfo` 驗證後更新。付完款但沒有查詢的訂單，會一直停在 `pending`。

本節依程式碼與 `tests/ecpay.test.js` 描述；自動化測試以 mock 取代綠界回應，沒有連線到綠界。實際連線只做過手動驗證：2026-11-04 在測試環境以信用卡一次付清完成訂單 `ORD-20261104-1133E`（NT$ 580），綠界顯示付款成功，查詢後訂單轉為 `paid`。正式環境尚未驗證。

完整流程：

1. 結帳建立訂單（`pending`），庫存在此時已扣除。
2. 訂單詳情頁按「前往綠界付款」，瀏覽器前往 `/ecpay/payment/:orderId?token=<JWT>`。
3. 伺服器產生新的 `MerchantTradeNo` 並存入訂單，回傳自動送出的表單，瀏覽器 POST 至綠界。
4. 使用者在綠界完成付款，按「返回商店」，導回 `/orders/:orderId?payment=pending`。
5. 使用者按「查詢付款狀態」，前端呼叫 `POST /api/orders/:id/check-payment`。
6. 後端驗證通過後把訂單改為 `paid`。

測試環境可用信用卡 `4311-9522-2222-2222`，3D 驗證碼 `1234`。

### `GET /ecpay/payment/:orderId`

由瀏覽器直接前往，所以無法帶 `Authorization` header，改用查詢參數 `?token=<JWT>` 傳遞，由 `ecpayRoutes.js` 內的 `queryAuth` 驗證。這個路由回傳的是 HTML，**錯誤也是純文字，不是 `{ data, error, message }`**。

成功時回傳 `views/pages/ecpay-redirect.ejs`，頁面載入後自動把表單 POST 至綠界。**每次呼叫都會產生新的 `MerchantTradeNo` 並覆寫訂單上的舊值**。

| 狀態 | 回應文字 | 情境 |
| --- | --- | --- |
| 401 | `未授權，請重新登入` | 沒有 `token` |
| 401 | `Token 無效或已過期，請重新登入` | 驗證失敗或過期 |
| 401 | `使用者不存在` | token 有效但使用者已不存在 |
| 404 | `訂單不存在` | 訂單不存在或非本人 |
| 400 | `訂單狀態不是 pending，無法付款` | 訂單已是 `paid` 或 `failed` |

送交綠界的主要參數（`src/services/ecpay.js` 的 `buildAioParams`）：

| 參數 | 值 | 說明 |
| --- | --- | --- |
| `MerchantTradeNo` | 16 碼大寫英數 | 訂單 UUID 去掉連字號後的前 8 碼 + 毫秒時間戳十六進位的末 8 碼。訂單編號 `ORD-...` 含 `-`，不能直接使用 |
| `MerchantTradeDate` | `yyyy/MM/dd HH:mm:ss` | 固定為 UTC+8，與伺服器時區無關 |
| `TotalAmount` | `orders.total_amount` | **不含前端顯示的運費**，見下方已知限制 |
| `ItemName` | `名稱 x數量`，以 `#` 連接 | 名稱中的控制字元與 `#` 會被移除；超過 400 字時截斷為 397 字加 `...` |
| `ChoosePayment` | `ALL` | 由使用者在綠界頁面選擇付款方式 |
| `ReturnURL` | `${BASE_URL}/api/ecpay/notify` | 綠界規定必填；**本專案沒有這個路由**，若真的收到請求會得到 404 |
| `ClientBackURL` | `${BASE_URL}/orders/:id?payment=pending` | 「返回商店」的目的地 |
| `CheckMacValue` | SHA256 大寫 | `EncryptType=1`；以 `ECPAY_HASH_KEY`、`ECPAY_HASH_IV` 計算 |

### `POST /api/orders/:id/check-payment`

需 JWT，不需要 body。依下表**由上而下**判斷，所以訂單若從未發起綠界付款，即使已用模擬付款標成 `paid`，也會得到 `PAYMENT_NOT_STARTED`。

| 情境 | 狀態 | 錯誤碼 | `data` | 訊息 |
| --- | --- | --- | --- | --- |
| 訂單不存在或非本人 | 404 | `NOT_FOUND` | `null` | `訂單不存在` |
| `merchant_trade_no` 為空 | 400 | `PAYMENT_NOT_STARTED` | `null` | `尚未發起綠界付款` |
| 訂單已是 `paid` | 200 | — | `{ status: 'paid' }` | `訂單已付款`（不呼叫綠界） |
| 訂單已是 `failed` | 200 | — | `{ status: 'failed' }` | `訂單狀態異常`（不呼叫綠界） |
| 連線失敗或綠界回非 2xx | 502 | `ECPAY_QUERY_FAILED` | `null` | `綠界查詢失敗：<原因>` |
| 回傳的 CheckMacValue 不符 | 502 | `ECPAY_QUERY_FAILED` | `null` | `回傳 CheckMacValue 驗證失敗` |
| `TradeAmt` 不等於 `total_amount` | 502 | `ECPAY_QUERY_FAILED` | `null` | `交易金額不符` |
| `TradeStatus` 不是 `'1'` | 200 | — | `{ status: 'pending', trade_status }` | `尚未完成付款` |
| `TradeStatus` 是 `'1'` | 200 | — | `{ status: 'paid' }` | `付款成功` |

注意事項：

- 非 `pending` 訂單回 200 而不是 `INVALID_STATUS`，因此重複查詢是安全的，呼叫端要讀 `data.status` 判斷結果。
- 金額比對排在 `TradeStatus` 之前，即使交易尚未付款，金額不符也會回 502。
- 信用卡付款後銀行尚未回覆時，`TradeStatus` 可能暫時是 `0`，稍後再查即可。
- 更新在 `db.transaction()` 內以 `UPDATE ... WHERE status='pending'` 執行，並寫入 `ecpay_trade_no`（`TradeNo`）、`payment_type`（`PaymentType`）、`paid_at`（`PaymentDate`）。
- 這是專案唯一的 `async` handler，例外由 handler 自行 `next(err)`。

### 前端行為

「前往綠界付款」是帶 token 的連結。「查詢付款狀態」查詢中會停用；結果為 `paid` 時更新畫面並顯示成功訊息，其他 200 回應以 toast 顯示 API 的 `message`。**任何非 2xx 錯誤都只顯示固定文字** `查詢失敗，請稍後再試`，看不到 `PAYMENT_NOT_STARTED` 等具體原因。頁面不會在返回時自動查詢。

### 環境切換

`ECPAY_ENV=production` 使用 `payment.ecpay.com.tw`，其他值或未設定都使用 `payment-stage.ecpay.com.tw`。此值在載入 `src/services/ecpay.js` 時讀取，修改後要重啟伺服器。其他變數見 [DEVELOPMENT.md](./DEVELOPMENT.md#環境變數)。

## 後台商品管理

### 行為描述

全部需要 JWT + admin。沒有 token 回 401，非管理員回 403（`權限不足`）。驗證比購物車嚴格：`price`、`stock` 必須是 JSON 整數，字串 `"100"` 會被拒絕（實測）。修改價格不影響已成立的訂單（快照），但會影響購物車的顯示與之後的下單金額。

### `GET /api/admin/products`

查詢參數、排序與回應結構都與 `GET /api/products` 相同，目前沒有額外的管理欄位。後台頁面固定使用 `limit=10`。

### `POST /api/admin/products`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `name` | 是 | 不可為空字串；僅含空白會被接受（實測） |
| `price` | 是 | 正整數 |
| `stock` | 是 | 非負整數 |
| `description` | 否 | 空字串存為 `NULL` |
| `image_url` | 否 | 空字串存為 `NULL`；不驗證 URL 格式 |

成功回 201，`data` 為完整商品物件，訊息 `商品新增成功`。錯誤：400 `name 為必填欄位`、`price 必須為正整數`、`stock 必須為非負整數`。

### `PUT /api/admin/products/:id`

**部分更新**：所有欄位皆選填，未提供的（`undefined`）保留原值，並更新 `updated_at`。先檢查商品是否存在（404），再驗證欄位。

與 POST 的差異：

| 情況 | POST | PUT |
| --- | --- | --- |
| `name` 僅含空白 | 接受 | 400 `商品名稱不能為空` |
| `description` 為空字串 | 存 `NULL` | 存空字串 |
| `description: null` | 存 `NULL` | 清成 `NULL` |

把 `stock` 改到低於某購物車的數量時，購物車不會被調整，該使用者下單時才會得到 `STOCK_INSUFFICIENT`。

### `DELETE /api/admin/products/:id`

檢查順序：存在（404）→ 是否在 `pending` 訂單（409 `此商品存在未完成的訂單，無法刪除`）→ 刪除。結果對照表見 [ARCHITECTURE.md](./ARCHITECTURE.md#關聯與刪除行為)。商品若在任何人的購物車中會得到 **500**，這不是刻意的業務規則。

### 前端行為

新增與編輯共用 modal。前端要求名稱非空且價格 > 0。所有儲存與刪除失敗都顯示固定文字（`儲存失敗`、`刪除失敗`），不會顯示 API 的 `message`，所以 409 的原因看不到。

## 後台訂單管理

### `GET /api/admin/orders`

| 查詢參數 | 預設 | 規則 |
| --- | --- | --- |
| `page` | 1 | 同商品列表 |
| `limit` | 10 | 同商品列表 |
| `status` | 無 | `pending`／`paid`／`failed`；其他值**被忽略並回傳全部**，不回錯誤（實測） |

依 `created_at DESC` 排序。`data.orders[]` 是 `orders` 全部欄位（含 `user_id`、`recipient_address`），不含 `items`。

### `GET /api/admin/orders/:id`

回傳訂單所有欄位，加上 `items`（`order_items` 所有欄位）與 `user`（`{ name, email }`）。可查看任何使用者的訂單。不存在回 404 `訂單不存在`。

### 前端行為

列表的「買家」欄顯示的是 `recipient_name`（收件人），不是帳號名稱；點表格列開啟的詳情 modal 中，「買家」才是帳號的姓名與 Email。切換狀態篩選會回到第 1 頁。

**後台沒有修改訂單的能力**，訂單 API 全部唯讀。

## 頁面導覽（前台共用）

`header-init.js` 在每個前台頁面執行：

- 依登入狀態顯示「登入」或「姓名＋登出」，管理員多一個「後台管理」連結。
- 「我的訂單」僅登入時顯示。
- 呼叫 `GET /api/cart`，徽章顯示**項目數**（`items.length`），不是總件數。

後台 layout 有前端 `requireAdmin` 檢查。它在 `DOMContentLoaded` 時執行，晚於頁面腳本掛載，所以未授權者仍會先送出一次 API 請求，再被導頁。

## 已知問題與限制

以下是目前程式碼的實際狀況，文件只記錄，未修改程式。新功能若碰到相關區塊，應順便評估修正。

### 業務邏輯

| 問題 | 影響 |
| --- | --- |
| `PATCH /api/orders/:id/pay` 可由訂單擁有者直接標記為已付款 | 可完全繞過綠界；模擬用途可接受，上線前必須移除或限制 |
| 運費只在前端顯示 | 小計未滿 500 時，結帳頁金額與訂單金額不同，**實際向綠界請款的是不含運費的 `total_amount`** |
| 付款失敗不回補庫存、也不能重試，但 `?payment=failed` 的文字寫「付款失敗，請重試」 | 庫存永久減少；文字與行為不符。目前只有直接呼叫模擬付款 API 才會產生 `failed` |
| 重新進入 `/ecpay/payment/:orderId` 會覆寫 `merchant_trade_no` | 付款完成後若再次進入（例如按上一頁），之後只會查詢新編號，已付款的舊交易查不到，訂單停在 `pending` |
| 沒有實作 `ReturnURL` 的 Server Notify | 使用者付款後沒按查詢，訂單就不會更新；部署到公開網址前應補上 |
| 訪客車不會併入會員車 | 訪客登入結帳時購物車看似消失 |
| 後台無法變更訂單狀態，也無取消功能 | `pending` 訂單會持續占用庫存並阻擋商品刪除 |

### 錯誤處理

輸入型別未檢查時會回 500 而不是 400（均為實測）：

| 請求 | 結果 | 原因 |
| --- | --- | --- |
| 註冊或登入時 `password` 為數字 | 500 | bcrypt 只接受字串 |
| `PUT` 商品時 `name: null` | 500 | 對 `null` 呼叫 `.trim()` |
| `POST` 商品時 `name` 為物件 | 500 | better-sqlite3 綁定失敗 |
| `PATCH .../pay` 時 `action: "constructor"` | 500 | `actionMap[action]` 取到繼承自 `Object` 的屬性 |
| 刪除在購物車中的商品 | 500 | 外鍵錯誤未轉換 |

其他驗證寬鬆之處：`POST` 商品的 `name: 123` 會存成 `"123.0"`；無效 JSON 回 400 但錯誤碼是 `INTERNAL_ERROR`。

### 前端

| 問題 | 影響 |
| --- | --- |
| `apiFetch` 對所有 401 一律導向 `/login` | **登入密碼錯誤時，頁面重新載入，`Email 或密碼錯誤` 不會顯示**，`?redirect=` 也會遺失 |
| Token 過期後瀏覽任何前台頁面 | `header-init.js` 的購物車請求得到 401，訪客式瀏覽會被導向登入頁 |
| 商品加入購物車後徽章固定 +1 | 重複加入同商品時與 `items.length` 不一致，重新整理後才修正 |
| `created_at` 是無時區的 UTC 字串，`new Date()` 會當成本地時間 | 台灣時間 00:00–08:00 下單的日期會顯示為前一天 |
| 訂單編號日期是 UTC | 同上，編號日期可能比本地日期早一天 |
| `check-payment` 的錯誤訊息固定為 `查詢失敗，請稍後再試` | 使用者無法區分尚未發起付款、綠界連線失敗或金額不符 |

### 安全性

| 問題 | 位置 | 影響 |
| --- | --- | --- |
| `user.name` 未跳脫就寫入 `innerHTML` | `header-init.js` | 註冊姓名含 HTML 時，在該使用者瀏覽器中執行 |
| `redirect` 參數未限制同源 | `pages/login.js` | 可被用於開放重導向 |
| 無速率限制或登入鎖定 | 全域 | 帳密可被暴力嘗試 |
| JWT 存於 localStorage 且無法撤銷 | `auth.js` | XSS 可竊取 token；外洩後最多有效 7 天 |
| Token 中的 `role` 不與資料庫同步 | `authMiddleware.js` | 降級後舊 token 仍有管理員權限，直到到期 |
| JWT 放在網址查詢參數 | `order-detail.js`、`ecpayRoutes.js` | 7 天有效的 token 會留在瀏覽器歷史與伺服器存取紀錄 |

### 維護性

| 問題 | 位置 |
| --- | --- |
| JWT 驗證邏輯重複 | `authMiddleware.js`、`cartRoutes.js` 的 `dualAuth`、`ecpayRoutes.js` 的 `queryAuth` |
| 分頁解析重複 | `productRoutes.js`、`adminProductRoutes.js`、`adminOrderRoutes.js` |
| JWT 簽發重複 | `authRoutes.js` 兩處 |
| `statusMap` 重複且配色不同 | `orders.js`、`order-detail.js`、`admin-orders.js` |
| 運費規則重複 | `cart.ejs`、`checkout.ejs` |
| 測試與開發共用資料庫 | `src/database.js` 路徑固定 |
| Vue CDN 未鎖定版本 | `layouts/*.ejs` |
| 未使用的檔案 | `public/stylesheets/style.css` |
