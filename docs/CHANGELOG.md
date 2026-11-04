# 更新日誌

格式參考 [Keep a Changelog](https://keepachangelog.com/)。版本號對應 `package.json` 的 `version`，目前尚未建立 git tag。

完成功能後依 [計畫歸檔流程](./DEVELOPMENT.md#計畫歸檔流程) 更新本檔。分類使用：新增（Added）、變更（Changed）、修正（Fixed）、移除（Removed）、安全性（Security）。

## [Unreleased]

### 新增

- 專案文件：`CLAUDE.md`、`docs/README.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/FEATURES.md`、`docs/TESTING.md`、`docs/CHANGELOG.md`。
- 開發計畫目錄 `docs/plans/` 與歸檔目錄 `docs/plans/archive/`。
- **ECPay AIO 金流串接**：`GET /ecpay/payment/:orderId` 產生自動送出付款表單；`POST /api/orders/:id/check-payment` 呼叫 QueryTradeInfo 驗證並更新訂單狀態；`src/services/ecpay.js`（CheckMacValue SHA256、buildAioParams、queryTradeInfo）；`orders` 資料表新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at` 四欄；新增錯誤碼 `PAYMENT_NOT_STARTED`、`ECPAY_QUERY_FAILED`；新增測試 `tests/ecpay.test.js`（CMV 向量 + API 整合測試）。

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
- 訪客車併入會員車、取消訂單、後台修改訂單狀態。
