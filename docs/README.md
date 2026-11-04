# [ 此專案是AI開發進化營的作業]花漾生活 Flower Life

花卉電商示範專案：Express 提供 REST API 與 EJS 頁面，資料存於 SQLite。付款採綠界 ECPay AIO；localhost 收不到通知，須手動查詢付款狀態。

**技術棧**：Node 20+、Express 4、better-sqlite3、JWT、EJS、Vue 3、Tailwind 4、Vitest。
- **前台**：商品瀏覽、訪客／會員購物車、結帳、訂單查詢、綠界 ECPay 付款
- **後台**：商品 CRUD、訂單查詢與狀態篩選
- **API**：20 個 REST 操作（15 個路徑），另有 1 個產生綠界付款表單的瀏覽器導向路由，可由註解產生 OpenAPI 3.0.3 規格

> 付款使用**綠界 ECPay AIO**。本專案設計為在 localhost 執行，收不到綠界的 Server Notify，因此付款結果由使用者按「查詢付款狀態」後，後端主動呼叫 `QueryTradeInfo` 驗證。舊的模擬付款 API `PATCH /api/orders/:id/pay` 仍保留，但頁面已不再提供按鈕。詳見 [ARCHITECTURE.md](./ARCHITECTURE.md#金流與第三方整合)。

## 技術棧

版本為目前 `node_modules` 實際安裝的版本。

| 層級 | 技術 | 版本 | 用途與備註 |
| --- | --- | --- | --- |
| 執行環境 | Node.js | 20 / 22 / 23 / 24 / 25 | 範圍來自 better-sqlite3 的 `engines`；本文件在 v25.9.0 上驗證 |
| Web 框架 | Express | 4.16.4 | `package.json` 鎖定 `~4.16.1` |
| 資料庫 | better-sqlite3 | 12.8.0 | **同步** API，WAL 模式，啟用外鍵 |
| 認證 | jsonwebtoken | 9.0.3 | HS256，有效期 7 天 |
| 密碼雜湊 | bcrypt | 6.0.0 | cost 10 |
| 模板 | EJS | 5.0.1 | 無 layout 套件，以「兩階段 render」套版 |
| 前端互動 | Vue 3 | CDN，未鎖版本 | `unpkg.com/vue@3`，免建置的全域版本 |
| 樣式 | Tailwind CSS | 4.2.2 | 透過 `@tailwindcss/cli` 由 `input.css` 產生 `output.css` |
| 其他 | cors 2.8.6、dotenv 16.6.1、uuid 11.1.0 | | |
| API 文件 | swagger-jsdoc | 6.2.8 | 只產生 JSON，**未提供** Swagger UI |
| 測試 | Vitest 2.1.9、Supertest 7.2.2 | | 使用全域 `describe/it/expect` |

頁面另需連網載入：Vue（unpkg）、Google Fonts（Noto Sans TC／Noto Serif TC）、商品圖片（Unsplash）。

## 快速開始

```bash
npm install
cp .env.example .env   # 設定 JWT_SECRET
npm start              # localhost:3001
npm test
```

管理員：`admin@hexschool.com`／`12345678`。測試與開發共用 `database.sqlite`，重置請刪除之。

## 文件

[詳細版](./reference/README.md)・[架構](./ARCHITECTURE.md)・[開發](./DEVELOPMENT.md)・[功能](./FEATURES.md)・[測試](./TESTING.md)・[日誌](./CHANGELOG.md)・[計畫](./plans/)
