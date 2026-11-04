# 測試

Vitest + Supertest，7 檔 92 測試，直接匯入 `app` 並寫入真實 `database.sqlite`。

- `npm test`；單檔 `npx vitest run tests/cart.test.js`
- 需 `JWT_SECRET`；管理員 `admin@hexschool.com`／`12345678`
- 檔案依序執行；檔內 `it` 共用變數，不可單獨 `-t`
- 輔助函式在 `tests/setup.js`：`getAdminToken()`、`registerUser()`
- 僅 `ecpay.test.js` mock `fetch`

詳細：[reference/TESTING.md](./reference/TESTING.md)
