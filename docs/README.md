# 花漾生活 Flower Life

花卉電商示範專案。單一 Express 應用同時提供 REST API 與伺服器渲染頁面，資料存放於本機 SQLite 檔案，不需要額外的資料庫服務。

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
cp .env.example .env
# 產生隨機 JWT_SECRET（macOS 請改用 sed -i ''）
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
npm start
```

開啟 <http://localhost:3001>。首次啟動會自動建立 `database.sqlite`、所有資料表、管理員帳號與 8 筆種子商品。

**預設管理員**（來自 `.env` 的 `ADMIN_EMAIL`／`ADMIN_PASSWORD`，僅供本機開發）：

| 欄位 | 值 |
| --- | --- |
| Email | `admin@hexschool.com` |
| 密碼 | `12345678` |
| 後台入口 | <http://localhost:3001/admin/products> |

> 測試程式把這組帳密寫死。修改後 `npm test` 會失敗，詳見 [TESTING.md](./TESTING.md#常見陷阱)。

**測試付款**：`.env.example` 已附綠界公開測試帳號，複製後即可使用。在訂單詳情頁按「前往綠界付款」，以測試信用卡 `4311-9522-2222-2222`（3D 驗證碼 `1234`）付款，按「返回商店」後再按「查詢付款狀態」。完整流程見 [FEATURES.md](./FEATURES.md#ecpay-金流aio)。

### 開發模式

伺服器與 CSS 監看要開兩個終端機。`dev:server` 不會自動重啟，修改後端程式後須手動重啟；修改 `.ejs` 與 `public/js` 只要重新整理頁面。

```bash
# 終端機 1
npm run dev:css

# 終端機 2
npm run dev:server
```

### 驗證安裝

```bash
npm test
curl "http://localhost:3001/api/products?limit=1"
```

`npm test` 應顯示 7 個檔案、92 個測試全部通過。測試與開發共用 `database.sqlite`，會留下測試資料。

### 重置資料庫

先停止伺服器，再刪除三個檔案。下次啟動會重新建表並寫入種子資料。**這會刪除所有本機資料。**

```bash
rm -f database.sqlite database.sqlite-wal database.sqlite-shm
```

## 常用指令

| 指令 | 實際執行內容 | 何時使用 |
| --- | --- | --- |
| `npm start` | `css:build` + `node server.js` | 一次完成建置並啟動 |
| `npm run dev:server` | `node server.js` | 開發時啟動伺服器（不建置 CSS） |
| `npm run dev:css` | Tailwind CLI `--watch` | 開發時持續重建 CSS |
| `npm run css:build` | Tailwind CLI `--minify` | 產生壓縮後的 `public/css/output.css` |
| `npm test` | `vitest run` | 執行全部測試 |
| `npm run openapi` | `node generate-openapi.js` | 在專案根目錄產生 `openapi.json` |

單檔測試：`npx vitest run tests/cart.test.js`。變更埠號：`PORT=4000 npm run dev:server`。

## 文件索引

| 文件 | 內容 | 何時閱讀 |
| --- | --- | --- |
| [README.md](./README.md) | 專案介紹、技術棧、快速開始 | 第一次接觸專案 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目錄結構、啟動流程、路由總覽、回應格式、認證、資料庫 schema、資料流、金流 | 需要理解模組如何配合時 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 命名規則、模組系統、新增 API／middleware／DB 步驟、環境變數、JSDoc、計畫歸檔 | 開始寫程式前 |
| [FEATURES.md](./FEATURES.md) | 功能完成狀態、各端點參數與業務邏輯、錯誤碼、已知問題 | 串接 API 或修改業務邏輯時 |
| [TESTING.md](./TESTING.md) | 測試檔案、依賴關係、輔助函式、撰寫步驟、常見陷阱 | 撰寫或除錯測試時 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本更新紀錄 | 了解變更歷史 |
| [plans/](./plans/) | 進行中的開發計畫，完成後移至 [plans/archive/](./plans/archive/) | 開發新功能時 |
