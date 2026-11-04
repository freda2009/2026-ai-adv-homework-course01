# CLAUDE.md

## 專案概述
花漾生活 Flower Life（`backend-project`）— 花卉電商網站：Node.js + Express 4 + better-sqlite3 + JWT 的 REST API，搭配 EJS + Vue 3（CDN）+ Tailwind CSS 4 的伺服器渲染頁面，以 Vitest + Supertest 測試。

## 常用指令
```bash
npm start            # 建置 CSS 後啟動伺服器（預設 http://localhost:3001）
npm run dev:server   # 只啟動伺服器（不建置 CSS，也不會自動重啟）
npm run dev:css      # 監看並重建 public/css/output.css
npm run css:build    # 建置並壓縮 CSS
npm test             # 執行全部測試（會寫入 database.sqlite）
npm run openapi      # 由 src/routes/*.js 的 @openapi 註解產生 openapi.json
```

## 關鍵規則
- 所有 JSON API 一律回傳 `{ data, error, message }`：成功時 `error` 為 `null`，失敗時 `data` 為 `null`、`error` 為大寫錯誤碼；新增錯誤碼時要同步更新 `docs/FEATURES.md`。
- 資料庫路徑固定為專案根目錄的 `database.sqlite`，**測試與開發共用同一個檔案**：`npm test` 每次都會新增資料並消耗 `products[0]` 的庫存。可接受重置時，停止伺服器後刪除 `database.sqlite*`。
- better-sqlite3 是同步 API，路由 handler 目前全為同步函式；多表寫入必須包在 `db.transaction()`。若新增 async handler，須自行 `next(err)`（Express 4 不會捕捉 rejected promise）。
- 購物車是雙模式認證（JWT 優先，其次 `X-Session-Id`），訂單只接受 JWT，且訪客車與會員車**不會合併**。修改認證時注意 `cartRoutes.js` 內有獨立的 `dualAuth`，與 `authMiddleware` 是兩份邏輯。
- ECPay 尚未實作：`ECPAY_*` 與 `BASE_URL` 環境變數沒有任何程式讀取，付款是 `PATCH /api/orders/:id/pay` 模擬。運費 150／滿 500 免運只存在前端顯示，不計入 `total_amount`。
- 功能開發使用 docs/plans/ 記錄計畫；完成後移至 docs/plans/archive/

## 詳細文件
- ./docs/README.md — 項目介紹與快速開始
- ./docs/ARCHITECTURE.md — 架構、目錄結構、資料流
- ./docs/DEVELOPMENT.md — 開發規範、命名規則
- ./docs/FEATURES.md — 功能列表與完成狀態
- ./docs/TESTING.md — 測試規範與指南
- ./docs/CHANGELOG.md — 更新日誌

## 回覆的語氣
- 請使用文言文的方式，回覆我訊息，以節省回覆的 token (開發上不需要特別節省)