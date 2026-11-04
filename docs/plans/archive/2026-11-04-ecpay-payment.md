# 綠界 ECPay 金流串接

## User Story
身為已下單的會員，我想在訂單頁以綠界 AIO 付款頁完成付款，並於返回商店後讓系統自動向綠界查詢結果、將訂單改為已付款，取代目前的模擬付款按鈕。
本專案僅運行於 localhost，無法接收綠界 Server Notify，故付款結果一律由本地後端主動呼叫 `QueryTradeInfo/V5` 驗證。

## Spec

### 流程
1. 結帳頁填寫收件資訊 → `POST /api/orders` 建立訂單（既有），狀態 `pending`。
2. 按「前往綠界付款」→ 前端導向 `/ecpay/payment/:orderId`。
3. Server 產生新 `MerchantTradeNo`、簽 CheckMacValue → 回傳自動送出的 HTML 表單 → 瀏覽器 POST 至綠界付款頁。
4. 以測試卡 `4311-9522-2222-2222`（3D 驗證碼 `1234`）完成付款，按「返回商店」→ 綠界透過 `ClientBackURL` 導回 `/orders/:orderId?payment=pending`。
5. 使用者點擊「查詢付款狀態」→ `POST /api/orders/:id/check-payment`（JWT）→ 呼叫 QueryTradeInfo，驗回傳 CMV、`TradeAmt === total_amount`、`TradeStatus === '1'` 後，於 `db.transaction()` 內 `UPDATE … WHERE status='pending'` 設為 `paid`（冪等）。
6. `ReturnURL` 為綠界必填，填 `${BASE_URL}/api/ecpay/notify`，本地收不到，不實作 handler；不使用 `OrderResultURL`（非標準 port 風險）。

### API
- `GET /ecpay/payment/:orderId`（JWT）：Server 產生 ECPay 參數 + CheckMacValue，回傳含自動送出 `<form>` 的 HTML 頁面；每次產生新 `MerchantTradeNo` 並存入訂單。
- `POST /api/orders/:id/check-payment`（JWT）：呼叫 QueryTradeInfo 驗證，已付款時更新訂單。
- `PATCH /api/orders/:id/pay`：既有模擬付款，保留不動。
- JSON 端點回應一律 `{ data, error, message }`。

### 錯誤碼（須同步更新 docs/FEATURES.md）
| 錯誤碼 | HTTP | 情境 |
|---|---|---|
| `NOT_FOUND` | 404 | 訂單不存在或非本人 |
| `INVALID_STATUS` | 400 | 訂單非 pending |
| `PAYMENT_NOT_STARTED`（新） | 400 | 尚未發起綠界付款即查詢 |
| `ECPAY_QUERY_FAILED`（新） | 502 | 綠界連線失敗／CMV 不符／金額不符 |

TradeStatus 為 `0`（未付款）→ 200，訂單仍 pending，message 說明尚未付款。

### Schema
`orders` 新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at`（皆 TEXT，可為 NULL）。`database.js` 僅有 `CREATE TABLE IF NOT EXISTS`，故於 `initializeDatabase()` 以 `PRAGMA table_info(orders)` 檢查後冪等 `ALTER TABLE ADD COLUMN`；不動 `status` CHECK。

### 綠界參數重點
- `src/services/ecpay.js`：僅用內建 `crypto` 與原生 `fetch`；CMV 採 skill `guides/13` Node.js 版（`ecpayUrlEncode`、SHA256、`timingSafeEqual`）。
- `MerchantTradeNo`：英數、≤20 字、永久唯一（訂單編號 `ORD-…` 含 `-`，不可直用）。
- `MerchantTradeDate`：UTC+8，`yyyy/MM/dd HH:mm:ss`。
- `TotalAmount` = `orders.total_amount`（運費僅前端顯示、不計入，維持現狀）。
- `ItemName`：以 `#` 連接、過濾控制字元、≤400 字。
- `ChoosePayment=ALL`、`EncryptType=1`。
- QueryTradeInfo：`TimeStamp` 為 Unix 秒，3 分鐘有效，每次重取；回傳須驗 CMV。
- `ECPAY_ENV=staging` → `payment-stage.ecpay.com.tw`；測試帳號 3002607 為公開值，正式 HashKey/IV 不得入版控。

### 前端
`views/pages/order-detail.ejs`＋`public/js/pages/order-detail.js`：pending 時以「前往綠界付款」（導向 `/ecpay/payment/:orderId`）與「查詢付款狀態」（呼叫 `POST /api/orders/:id/check-payment`）取代兩顆模擬按鈕；`?payment=pending` 時顯示提示文字但不自動查詢。
新增 `views/pages/ecpay-redirect.ejs`：僅含自動送出的 `<form>`，Server 填入所有 ECPay 參數。

### 風險／備註
- 實作時依 ecpay skill 規定 web_fetch 官方 AIO／QueryTradeInfo 規格核對欄位；失敗則以 guides 為備並告知。
- 信用卡付款後銀行未回覆時 TradeStatus 可能暫為 0，可再按查詢。
- 付款失敗不回補庫存為既有行為，本次不改。
- 共用 `database.sqlite`：以遷移處理新欄位，不需刪庫。

## Tasks
- [x] `src/database.js`：冪等遷移新增 4 個 orders 欄位
- [x] 新增 `src/services/ecpay.js`（CMV、MerchantTradeNo、buildAioParams、queryTradeInfo）
- [x] 新增 `src/routes/ecpayRoutes.js`（`GET /ecpay/payment/:orderId` 回傳 HTML、`POST /api/orders/:id/check-payment` 查詢，含 `@openapi` 註解）並於 `app.js` 掛載
- [x] 前端：訂單詳情頁改為綠界付款／查詢流程；新增 `views/pages/ecpay-redirect.ejs` 自動送出表單頁
- [x] 更新 `.env.example` 之 ECPAY 註解
- [x] 撰寫 `tests/ecpay.test.js` 並加入 `vitest.config.js` 的 `sequence.files`：CMV 以 `test-vectors/checkmacvalue.json` 驗證；`GET /ecpay/payment/:orderId` 回傳含 `<form action="…">` 的 HTML、MerchantTradeNo ≤20 且英數、他人訂單 404；`POST /api/orders/:id/check-payment` 以 `vi.spyOn(global,'fetch')` 模擬 TradeStatus 1／0、金額不符、CMV 錯，驗證狀態轉移與冪等
- [x] 更新 `docs/FEATURES.md`（端點、錯誤碼）、`CHANGELOG.md`（移除「尚未包含：ECPay」）、`ARCHITECTURE.md`、`TESTING.md`、`CLAUDE.md` 第 18 行
- [ ] 驗證：`npm test` 全綠（歸檔時尚無紀錄可確認）
- [x] 驗證：`npm start` 後以測試卡實際走完付款並確認訂單轉為已付款（2026-11-04 手動完成：`ORD-20261104-1133E`，`MerchantTradeNo` `DE02F825A4B7CDFB`，NT$ 580，綠界顯示付款成功，資料庫 `status=paid`）
- [x] 完成後 `git mv docs/plans/2026-11-04-ecpay-payment.md docs/plans/archive/`

## 實作與 Spec 的差異
- `GET /ecpay/payment/:orderId` 的 JWT 由查詢參數 `?token=` 傳遞（`queryAuth`），不是 `Authorization` header；錯誤回純文字。
- `POST /api/orders/:id/check-payment` 對非 `pending` 訂單回 200 與 `data.status`，**沒有**使用 Spec 列出的 `INVALID_STATUS`。
