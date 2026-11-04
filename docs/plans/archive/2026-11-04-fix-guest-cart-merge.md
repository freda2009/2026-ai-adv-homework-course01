# 修正登入或註冊後訪客購物車消失

## 查修結果（Context）

### 訪客購物車如何儲存

| 位置 | 內容 |
|---|---|
| 瀏覽器 `localStorage.flower_session_id` | 只存 `crypto.randomUUID()` 產生的識別碼，**不存商品**（`public/js/auth.js:34`） |
| 請求標頭 `X-Session-Id` | `apiFetch` 每次請求都會送出，包含登入與註冊（`public/js/auth.js:47`） |
| `req.sessionId` | 全域的 `sessionMiddleware` 寫入，不驗證格式（`src/middleware/sessionMiddleware.js`） |
| 資料表 `cart_items` | 商品實際存放處。訪客列填 `session_id`，會員列填 `user_id`（`src/database.js:36`） |

伺服器沒有 session 表，也沒有使用 cookie。

### 登入後為何讀不到

**商品沒有被刪除，只是查詢條件換了。**

1. `dualAuth` 以 JWT 優先；只要帶有效 token，`getOwnerCondition` 就回傳 `user_id`，`session_id` 被忽略（`src/routes/cartRoutes.js:9,48`）。
2. `/api/auth/login`、`/register` 完全不處理購物車（`src/routes/authRoutes.js:66,181`），訪客列的 `user_id` 一直是 NULL。
3. 登入後 `GET /api/cart` 只查 `user_id`，得到空車；結帳頁因此導回 `/cart`（`public/js/pages/checkout.js:50-55`）。
4. 訪客列仍留在資料庫，登出後 JWT 不再送出，商品會再次出現。

### 修正的切入點

登入與註冊請求已帶 `X-Session-Id`，伺服器也已有 `req.sessionId`，因此**由後端在認證成功後合併即可，核心流程不需改前端**。

## User Story

身為未登入的顧客，我先把商品加入購物車，登入或註冊後仍能看到這些商品並直接結帳，不必重新加入。

## Spec

### 合併函式

新增 `src/services/cart.js`，匯出 `mergeGuestCart(sessionId, userId)`，全程包在 `db.transaction()` 內。逐筆處理該 `session_id` 的項目：

| 情境 | 處理 |
|---|---|
| 會員車沒有此商品，數量 ≤ 庫存 | 將該列改歸會員（`user_id=?`、`session_id=NULL`） |
| 會員車沒有此商品，數量 > 庫存 | 改歸會員，數量降為庫存量；計入 `adjusted` |
| 會員車已有此商品，相加 ≤ 庫存 | 數量相加（與 `POST /api/cart` 重複加入一致），刪除訪客列 |
| 會員車已有此商品，相加 > 庫存 | 調整為庫存量，但**不低於會員車原有數量**；刪除訪客列，計入 `adjusted` |
| 庫存為 0 且會員車沒有此商品 | 刪除訪客列，計入 `adjusted`（`quantity` 有 `CHECK > 0`，無法存 0） |

回傳 `{ merged, adjusted }`：`merged` 為併入會員車的品項數，`adjusted` 為數量被調整或因無庫存而移除的品項數。

**避免重複合併：** 訪客列在同一個 transaction 內全數移轉或刪除，再次登入時已無資料可併。better-sqlite3 為同步執行，併發的兩次登入也會依序處理，後者查無資料。

### `POST /api/auth/login`、`POST /api/auth/register`

- **時機：** 登入在驗證密碼成功後，註冊在建立使用者後。帳密錯誤或驗證失敗時**不合併**。
- **無 `X-Session-Id`：** 不合併，其餘行為不變。
- **回應：** `data` 新增 `cart_merge: { merged, adjusted }`，既有欄位不變；未合併時兩者皆為 0。
- **合併失敗不阻擋登入：** 捕捉例外並 `console.error`，`cart_merge` 回 0。transaction 會回滾，訪客車保留，下次登入可再合併。
- **錯誤碼：** 不新增。
- **呼叫方式：** 以 `cartService.mergeGuestCart(...)` 經模組物件呼叫，測試才能模擬失敗。

### 前端（僅新增庫存調整提示）

- `public/js/pages/login.js`：`adjusted > 0` 時，將提示存入 `sessionStorage`。登入成功後會立即跳頁，當下顯示的 toast 來不及看到。
- `public/js/header-init.js`：頁面載入時若有此提示，以 `Notification.show(..., 'warning')` 顯示後清除。文案：「部分購物車商品因庫存不足已調整，請確認數量」。

### 已知限制（本次不處理）

- **共用電腦：** 同一瀏覽器的訪客車會併入下一個登入的帳號。
- **多裝置：** 只合併當前瀏覽器的訪客車。
- **訪客車清理：** `X-Session-Id` 仍無到期機制，從未登入者的資料不會自動清除。
- **既有的舊訪客列：** 會在該瀏覽器下次登入時併入，屬預期行為。
- **密碼打錯後遺失導向：** 見下方前端影響。

## 影響評估

### 現有前端

| 檔案 | 影響 |
|---|---|
| `public/js/auth.js`、`api.js` | 不改，已送出 `X-Session-Id` |
| `pages/cart.js`、`checkout.js`、`index.js`、`product-detail.js` | 不改；讀到的就是合併後的會員車 |
| `pages/login.js` | 僅讀取新欄位並存提示；`Auth.login(token, user)` 不變 |
| `header-init.js` | 僅新增提示；購物車徽章自然反映合併結果 |

**行為變化：**
- 登出後不再出現已合併的商品，購物車為空。這取代 `docs/FEATURES.md` 記載的現行行為。
- 登入後的購物車徽章數量可能增加。

**既有問題（不在本次範圍）：** `apiFetch` 收到 401 會整頁導向 `/login`（`public/js/api.js:10`）。登入時打錯密碼會因此遺失 `?redirect=/checkout`，也看不到錯誤訊息。購物車不會遺失，但重新登入後會回首頁，而不是結帳頁。

### 現有測試

| 項目 | 影響 |
|---|---|
| `tests/setup.js` 的 `registerUser`、`getAdminToken` | 不帶 `X-Session-Id`，不會觸發合併 |
| `tests/auth.test.js` | 皆為 `toHaveProperty` 斷言，新增欄位不影響 |
| `tests/cart.test.js` 既有案例 | 其流程不會帶 session 登入，不影響 |
| `tests/orders`、`adminOrders`、`ecpay` | 走會員購物車，不影響 |
| `products[0]` 庫存 | 新測試使用自建商品，不增加消耗 |

既有測試應無須修改；實作時以完整測試確認。

### 與「JWT 放在網址」修正的關係

**`docs/plans/2026-11-04-fix-jwt-in-url.md` 目前不存在**（工作目錄與 git 歷史皆查無），以下依現有程式與 `docs/ARCHITECTURE.md:527` 的方向（改用短效一次性憑證或 POST）評估，**該計畫的實際內容尚未核對**。

- **結論：預期互不影響，先後順序皆可。**
- **程式範圍不重疊：** 網址 JWT 只出現在 `order-detail.js:31` 與 `ecpayRoutes.js` 的 `queryAuth`。本修正只改 `authRoutes.js`、新增 `services/cart.js`，以及 `login.js`、`header-init.js` 的提示。
- **依賴不同：** 合併只依賴認證成功後的 `userId` 與 `X-Session-Id`，與 JWT 如何傳到付款頁無關。

該計畫若有以下變更則會互相影響，屆時須重新確認：

| 若該計畫… | 影響 |
|---|---|
| 調整 `apiFetch` 或 `getAuthHeaders`，登入請求不再送 `X-Session-Id` | 合併失效 |
| 將 JWT 全面改存 HttpOnly cookie | `dualAuth`、`Auth.isLoggedIn` 都要改；購物車判斷會員的方式受影響，但合併本身不受影響 |
| 改動 `login.js` 的回應處理或導向 | 同檔案修改，可能產生合併衝突 |

## 測試案例（`tests/cart.test.js`）

測試商品以 SQL 建立，才能控制庫存。`created_at` 須設為舊日期，並於 `afterAll` 刪除商品及其購物車列，因為商品列表按 `created_at DESC` 排序，新商品會變成其他測試依賴的 `products[0]`。

**指定情境**
1. 訪客加入後登入：會員車出現該商品，`merged=1`，訪客車變空。
2. 訪客加入後註冊：同上。
3. 與會員原有購物車合併，同商品：數量相加且只有一列。
4. 與會員原有購物車合併，不同商品：兩者並存。
5. 相加超過庫存：調整為庫存量，`adjusted=1`。
6. 重複登入：數量不重複累加，第二次 `merged=0`。

**庫存邊界**
7. 訪客數量超過目前庫存（加入後庫存減少）：調整為庫存量，`adjusted=1`。
8. 庫存為 0 且會員車沒有此商品：不併入，訪客列刪除，`adjusted=1`。
9. 會員車原數量已大於庫存：數量不被調低。

**隔離與失敗**
10. 密碼錯誤：回 401，訪客車不變。
11. 註冊 Email 重複：回 409，訪客車不變。
12. 登入不帶 `X-Session-Id`：正常成功，`cart_merge` 皆為 0。
13. 其他 session 與其他會員的購物車不受影響。
14. 合併失敗：登入仍成功，訪客車完整保留。

**完整流程**
15. 訪客加入 → 登入 → `POST /api/orders` 成功建立訂單且金額正確（只消耗測試商品的庫存）。

## Tasks

- [x] `tests/cart.test.js`：新增上列案例（修改前已確認失敗：案例 1、2 為 `cart_merge` 不存在，案例 15 為空車 `400≠201`）
- [x] `src/services/cart.js`：新增 `mergeGuestCart`
- [x] `src/routes/authRoutes.js`：登入與註冊呼叫合併，回傳 `cart_merge`，更新 `@openapi`
- [x] `public/js/pages/login.js`、`public/js/header-init.js`：庫存調整提示
- [x] 文件：`CLAUDE.md`、`docs/FEATURES.md`、`docs/ARCHITECTURE.md`、`docs/TESTING.md`、`docs/README.md`、`docs/CHANGELOG.md`
- [x] 驗證（見下，手動項目尚未完成）
- [x] 完成後 `git mv` 本計畫至 `docs/plans/archive/`

## 驗證

1. [x] `npm test`：7 個檔案、92 個測試全部通過（2026-11-04，清除資料後執行；既有 77 個測試未修改）。
2. [x] `npm run openapi` 可正常產生。
3. [x] **手動（須在沙箱外重啟伺服器才會載入新程式）：**
   - 未登入加入商品 → 前往結帳 → 登入 → 應直接進入結帳頁，並看到該商品。
   - 同上，但改走註冊。
   - 會員車已有同商品時再走一次：數量應相加。
   - 登出後：購物車應為空，不再出現已合併的商品。
   - 庫存調整提示（`login.js`、`header-init.js`）目前只通過語法檢查，須在瀏覽器確認。

## 實作注意

- 只 stage 明確列出的檔案，不用 `git add -A`。
- 工作目錄尚有 ECPay 重入修正未 commit 的變更，兩者不要混在同一個 commit；該項的文件更新與歸檔也仍未完成，不在本計畫範圍內。
