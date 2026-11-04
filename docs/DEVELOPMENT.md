# 開發規範

風格：2 空格、單引號、分號。後端 CommonJS；瀏覽器用全域 `<script>`，不可 `import`。

**命名**：路由檔 `xxxRoutes.js`、資料表 snake_case 複數、錯誤碼 UPPER_SNAKE_CASE。

**規則**
- 多表寫入用 `db.transaction()`，內不可 `await`
- async handler 須自行 `next(err)`
- SQL 一律 `?` 綁定
- 他人資源回 404

**新增 API**：選認證 → 寫 handler → 掛到 `app.js` → `@openapi` 註解 → 測試 → 更新文件。完成的計畫移至 `docs/plans/archive/`。

詳細：[reference/DEVELOPMENT.md](./reference/DEVELOPMENT.md)
