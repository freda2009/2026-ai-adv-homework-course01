# 更新日誌

格式參考 [Keep a Changelog](https://keepachangelog.com/)。版本號對應 `package.json` 的 `version`，目前尚未建立 git tag。

完成功能後依 [計畫歸檔流程](./DEVELOPMENT.md#計畫歸檔流程) 更新本檔。分類使用：新增（Added）、變更（Changed）、修正（Fixed）、移除（Removed）、安全性（Security）。

## [Unreleased]

### 新增

- 專案文件：`CLAUDE.md`、`docs/README.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/FEATURES.md`、`docs/TESTING.md`、`docs/CHANGELOG.md`。
- 開發計畫目錄 `docs/plans/` 與歸檔目錄 `docs/plans/archive/`。
- **ECPay AIO 金流串接**：`GET /ecpay/payment/:orderId` 產生自動送出付款表單；`POST /api/orders/:id/check-payment` 呼叫 QueryTradeInfo 驗證並更新訂單狀態；`src/services/ecpay.js`（CheckMacValue SHA256、buildAioParams、queryTradeInfo）；`orders` 資料表新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at` 四欄；新增錯誤碼 `PAYMENT_NOT_STARTED`、`ECPAY_QUERY_FAILED`；新增測試 `tests/ecpay.test.js`（CMV 向量 + API 整合測試）。
- 頁面 `views/pages/ecpay-redirect.ejs`：載入後自動把付款參數 POST 至綠界。
- **訪客車併入會員車**：登入或註冊成功時合併（`src/services/cart.js`），同商品數量相加並以庫存為上限；回應新增 `data.cart_merge`；庫存調整時於下一頁提示。
- 資料表 `ecpay_trades`：保存每次發起綠界付款的交易編號，啟動時自動回填 `orders` 既有編號（可重複執行）。
- `/orders/:id` 支援 `?payment=pending`，顯示「已從綠界返回」提示；此參數由綠界的 `ClientBackURL` 帶回。

### 變更

- 訂單詳情頁的「付款成功／付款失敗」模擬按鈕改為「前往綠界付款」與「查詢付款狀態」。`PATCH /api/orders/:id/pay` 仍保留，但前端不再呼叫。
- `BASE_URL`、`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`、`ECPAY_ENV` 由預留改為實際使用；`.env.example` 補上說明。
- CheckMacValue 測試向量複製至 `tests/fixtures/ecpay-checkmacvalue.json`，`tests/ecpay.test.js` 不再依賴 `.claude/skills/` 的目錄結構。
- `.claude/skills/ecpay/`（綠界整合 skill）納入版控。
- `GET /ecpay/payment/:orderId`：訂單已 `paid` 時改為 302 導向訂單頁；重入時先對帳，無法確認則回 502 而不產生新編號；每筆訂單最多 10 個編號。
- `POST /api/orders/:id/check-payment`：逐筆查詢全部歷史編號，任一筆已付款即轉 `paid`；`PAYMENT_NOT_STARTED` 改以 `ecpay_trades` 判定；多筆已付款記錄為重複扣款。
- `MerchantTradeNo` 由 16 碼增為 20 碼（末 4 碼隨機）；`queryTradeInfo` 加 10 秒逾時。
- 文件同步 ECPay 現況（`README`、`ARCHITECTURE`、`DEVELOPMENT`、`FEATURES`、`TESTING`），計畫移至 `docs/plans/archive/2026-11-04-ecpay-payment.md`。

### 修正

- **重入付款頁導致已付款訂單卡在 `pending`**：原本每次進入付款頁都覆寫 `merchant_trade_no`，付款後再進入會遺失舊編號而查不到已付款交易，也可能引導重複付款。
- 綠界對未送達編號回 `TradeStatus=10200047`、`TradeAmt=0` 時，誤報 502「交易金額不符」；現只在已付款時比對金額。
- 訂單於查詢期間被改為 `failed` 仍回「付款成功」；現依 `UPDATE` 實際結果回應。
- 修正前已被覆寫的舊編號無法自動復原，須至綠界後台人工比對。

## [1.0.0] - 2026-11-03

初始匯入（commit `f5caeb3`）。此版本的基準狀態如下，逐項行為見 [FEATURES.md](./FEATURES.md)。

### 新增

- **認證**：註冊、登入、個人資料；JWT HS256，有效期 7 天；bcrypt 雜湊密碼。
- **商品**：公開列表（分頁）與詳情。
- **購物車**：JWT 與 `X-Session-Id` 雙模式、數量累加、庫存檢查。
- **訂單**：由購物車建立（transaction 內建立訂單、保存快照、扣庫存、清空車）、列表、詳情、模擬付款。
- **後台**：商品 CRUD、訂單列表（狀態篩選）與詳情。
- **前端**：EJS 搭配 Vue 3 與 Tailwind CSS 4 的前台與後台頁面。
- **資料庫**：SQLite 5 張資料表，自動建立管理員與 8 筆種子商品。
- **API 文件**：以 `@openapi` 註解產生 `openapi.json`。
- **測試**：Vitest + Supertest，6 個檔案、32 個 API 測試。

### 尚未包含

- ~~ECPay 金流：僅有預留的環境變數。~~（已實作）
- 運費：僅前端顯示，不計入訂單金額。
- ~~訪客車併入會員車~~（已實作）、取消訂單、後台修改訂單狀態。
