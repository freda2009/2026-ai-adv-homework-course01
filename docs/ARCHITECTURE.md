# 架構

單一 Express 程序提供 REST API、EJS 頁面與綠界付款表單，無獨立前端建置。

- `app.js` 組裝路由；`server.js` 檢查 `JWT_SECRET` 後啟動
- `src/routes/` 路由與同步 SQL；`src/services/` 綠界、購物車合併
- `src/middleware/` 認證、session、錯誤處理
- `views/` EJS 外殼；`public/js/pages/` Vue 頁面腳本
- 資料表：users、products、cart_items、orders、order_items、ecpay_trades

**要點**：頁面不查資料庫；權限只在 API 把關。

**API 前綴**：`/api/auth`、`/api/products`、`/api/cart`（JWT 或 Session）、`/api/orders`、`/api/admin/*`；`/ecpay/payment/:id` 以 `?token=` 驗證。

詳細：[reference/ARCHITECTURE.md](./reference/ARCHITECTURE.md)
