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
| 模擬付款 | ✅ | ❌ | `PATCH /api/orders/:id/pay`，保留供開發測試 |
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

回傳 `orders` 所有欄位（含 `user_id`）加 `items`，`items` 是 `order_items` 所有欄位：`id`、`order_id`、`product_id`、`product_name`、`product_price`、`quantity`。不存在或非本人回 404 `訂單不存在`。商品被刪除後仍可正常查詢（實測）。

### `PATCH /api/orders/:id/pay`（模擬付款）

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

`/orders/:id` 只在 `pending` 時顯示付款按鈕。`?payment=success|failed|cancel` 會顯示對應提示，但不影響實際狀態。狀態標籤：`pending` 待付款、`paid` 已付款、`failed` 付款失敗。

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
| `PATCH /api/orders/:id/pay` 可由訂單擁有者直接標記為已付款 | 模擬用途可接受；上線前必須替換 |
| 運費只在前端顯示 | 小計未滿 500 時，結帳頁金額與訂單金額不同 |
| 付款失敗不回補庫存、也不能重試，但頁面文字寫「付款失敗，請重試」 | 庫存永久減少；文字與行為不符 |
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

### 安全性

| 問題 | 位置 | 影響 |
| --- | --- | --- |
| `user.name` 未跳脫就寫入 `innerHTML` | `header-init.js` | 註冊姓名含 HTML 時，在該使用者瀏覽器中執行 |
| `redirect` 參數未限制同源 | `pages/login.js` | 可被用於開放重導向 |
| 無速率限制或登入鎖定 | 全域 | 帳密可被暴力嘗試 |
| JWT 存於 localStorage 且無法撤銷 | `auth.js` | XSS 可竊取 token；外洩後最多有效 7 天 |
| Token 中的 `role` 不與資料庫同步 | `authMiddleware.js` | 降級後舊 token 仍有管理員權限，直到到期 |

### 維護性

| 問題 | 位置 |
| --- | --- |
| JWT 驗證邏輯重複 | `authMiddleware.js`、`cartRoutes.js` 的 `dualAuth` |
| 分頁解析重複 | `productRoutes.js`、`adminProductRoutes.js`、`adminOrderRoutes.js` |
| JWT 簽發重複 | `authRoutes.js` 兩處 |
| `statusMap` 重複且配色不同 | `orders.js`、`order-detail.js`、`admin-orders.js` |
| 運費規則重複 | `cart.ejs`、`checkout.ejs` |
| 測試與開發共用資料庫 | `src/database.js` 路徑固定 |
| Vue CDN 未鎖定版本 | `layouts/*.ejs` |
| 未使用的檔案 | `public/stylesheets/style.css` |
