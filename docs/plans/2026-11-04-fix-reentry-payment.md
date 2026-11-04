# 修正重入付款頁導致已付款訂單卡在 pending

## 查修結果（Context）

### 編號在哪裡產生與覆寫

| 位置 | 行為 |
|---|---|
| `src/services/ecpay.js:53` `generateMerchantTradeNo` | 訂單 UUID 前 8 碼＋`Date.now()` 後 8 碼 hex。同一毫秒會產生相同編號 |
| `src/routes/ecpayRoutes.js:60-62` | **每次** GET 付款頁都產生新編號，並直接 `UPDATE orders SET merchant_trade_no`，舊值沒有留在任何地方 |
| `src/routes/ecpayRoutes.js:120` | `check-payment` 只查 `orders.merchant_trade_no` 這一筆 |
| `src/database.js:74` | `orders` 只有單一欄位，沒有歷史 |

### 根因

1. **本地編號遺失，不是綠界查不到。** 實測綠界測試環境，舊編號 `DE02F825A4B7CDFB` 仍可查到 `TradeStatus=1`。交易一直在綠界端，只是本地已丟失編號。
2. **`paid` 守衛早已存在，但擋不住這個問題。** `ecpayRoutes.js:57` 已拒絕非 `pending` 訂單。然而本專案收不到綠界通知，訂單只有在使用者按「查詢付款狀態」後才會轉 `paid`。付款後、查詢前，本地仍是 `pending`，守衛不會生效。**因此只加 paid 守衛無法修好此問題。**
3. **未送達綠界的編號會中斷查詢。** 實測綠界對不存在的編號回 HTTP 200、`TradeStatus=10200047`、`TradeAmt=0`，且 CheckMacValue 有效。現行程式先比金額（`ecpayRoutes.js:135`），因此回 502「交易金額不符」。若只是把查詢改成迴圈，這個回應會讓整輪查詢失敗。

### 重現

以 `:memory:` 資料庫和模擬的 `fetch` 執行真實路由，未寫入任何檔案；綠界回應格式取自上述測試環境實測。

| 操作順序 | 結果 |
|---|---|
| 付款 t1 → 重入付款頁（t2 抵達綠界，未付）→ 查詢 | 只查 t2；回 200 `pending`、「尚未完成付款」，**t1 的付款遺失** |
| 承上，使用者再付 t2 → 查詢 | 轉 `paid`，但**綠界端已扣款 2 筆**，本地只記錄 t2，t1 沒有任何紀錄 |
| 付款 t1 → 重入，但 t2 未送達綠界 → 查詢 | 502「交易金額不符」，訊息誤導，且重查仍失敗 |
| 付款中途離開：t1 未付 → 重入 t2 未付 → 回舊分頁付 t1 → 查詢 | 只查 t2；回 `pending` |
| 對照：付款 t1 → 查詢 → 重入 | 轉 `paid`；重入回 400，守衛正常 |

各使用情境的觸發條件：

- **付款後重入（最常見）：** 返回訂單頁後，「前往綠界付款」與「查詢付款狀態」並列（`order-detail.ejs:75-88`），按錯前者即觸發。瀏覽器上一頁可能重新載入自動送出頁，同樣觸發；此路徑由程式推論，未在瀏覽器實測。
- **重複點擊：** 伺服器處理兩次 GET，瀏覽器通常只送出最後一張表單，此時最新編號正好是實際付款者，**不會出錯**。只有用多個分頁開啟，或付了較早產生的表單時才會觸發。
- **中途離開再回來：** 只要舊分頁仍可付款就會觸發。

### 無法自動復原的部分

已被覆寫的舊編號從未保存，本修正**救不回**既有的卡單，須到綠界後台比對後人工處理。

## User Story

身為已付款的會員，即使我曾再次進入付款頁，訂單仍要能正確轉為已付款，而且不會被引導去重複付款。

## Spec

### 資料表 `ecpay_trades`（新增）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 產生順序 |
| `merchant_trade_no` | TEXT UNIQUE NOT NULL | 送交綠界的編號 |
| `order_id` | TEXT NOT NULL，FK `orders(id)`，建索引 | |
| `trade_status` | TEXT | 最後查得的 `TradeStatus`；未查過為 NULL |
| `checked_at` | TEXT | 最後查詢時間 |
| `created_at` | TEXT NOT NULL DEFAULT now | |

- **遷移：** `initializeDatabase()` 以 `CREATE TABLE IF NOT EXISTS` 建表，再以 `INSERT OR IGNORE ... SELECT` 回填 `orders` 現有的 `merchant_trade_no`，可重複執行，不需刪庫。
- **`orders.merchant_trade_no` 保留：** 語意改為「最新發起的編號；已付款時為實際付款的編號」。

### 編號產生

`generateMerchantTradeNo` 末尾加 4 碼隨機 hex（`crypto.randomBytes`），總長 20、仍為英數，避免同毫秒撞號後違反 UNIQUE。

### 共用函式 `reconcileOrderPayment(order)`（`ecpayRoutes.js`）

依 `id` 逐筆查詢該訂單的**所有**編號，每筆間隔 200ms（綠界對高頻查詢回 403，須等 30 分鐘）。

| 單筆結果 | 判定 |
|---|---|
| 連線錯誤、非 2xx | 記為失敗，繼續查下一筆；**403 則立即停止** |
| CheckMacValue 不符，或回傳的 `MerchantTradeNo` 與查詢值不符 | 記為失敗 |
| `TradeStatus=1` 且金額相符 | 已付款 |
| `TradeStatus=1` 但金額不符 | 記為失敗，不得轉 `paid` |
| 其他（`0`、`10200047`、`10200095`…） | 未付款；**不比對金額**（修正根因 3） |

每筆通過簽章驗證的結果都寫回 `trade_status`、`checked_at`。

整輪結果：

- **有已付款：** 在 `db.transaction()` 內執行 `UPDATE orders ... WHERE status='pending'`，以最早一筆寫入 `ecpay_trade_no`、`payment_type`、`paid_at`、`merchant_trade_no`。已付款優先於其他筆的失敗。
- **多筆已付款：** 判定為重複扣款，`console.error` 記錄訂單與編號；`trade_status` 留作退款依據。這也是不在第一筆已付款時提前停止的原因。
- **無已付款但有失敗：** 不可斷言未付款，回報失敗。
- **全部未付款：** 回報未付款。

### `GET /ecpay/payment/:orderId`

由上而下判斷：

| 情境 | 回應 | 寫入新編號 |
|---|---|---|
| 訂單不存在或非本人 | 404（不變） | 否 |
| 已是 `paid` | **302 導向 `/orders/:id`**，不呼叫綠界 | 否 |
| 已是 `failed` | 400（不變） | 否 |
| `pending` 且有歷史編號，對帳發現已付款 | 轉 `paid`，302 導向 `/orders/:id` | 否 |
| `pending` 且有歷史編號，對帳失敗 | **502 純文字；不放行** | 否 |
| `pending` 且未付款編號已達 10 筆 | 400 純文字，提示重新下單或聯繫客服 | 否 |
| 其他（含首次進入，不呼叫綠界） | 200 付款表單（不變） | 是 |

- handler 改為 `async`，自行 `next(err)`。
- 對帳的 `await` 結束後**重新讀取訂單狀態**，再於同一個同步 transaction 內寫入 `ecpay_trades` 與 `orders`。

> **超出原需求的新增（請確認）：**
> - **重入前先對帳：** 需求只要求 `check-payment` 查歷史，但若付款頁不先查，使用者付款後重入仍會被帶到新表單，造成上表的重複扣款。代價是綠界異常時無法發起新付款；不過此時綠界付款頁本身也很可能不可用。
> - **每筆訂單 10 個編號上限：** 每次重入都會查全部歷史，若無上限，反覆重整可能觸發綠界 403，導致全站查詢停擺 30 分鐘（限流依 IP＋MerchantID）。

### `POST /api/orders/:id/check-payment`

判斷順序沿用現有文件（404 → `PAYMENT_NOT_STARTED` → 非 `pending` 直接回覆且**不呼叫綠界** → 對帳）；`PAYMENT_NOT_STARTED` 改以該訂單無 `ecpay_trades` 判定。

| 對帳結果 | 回應 |
|---|---|
| 已付款 | 200 `{ status:'paid' }` |
| 無已付款但有失敗 | 502 `ECPAY_QUERY_FAILED` |
| 全部未付款 | 200 `{ status:'pending', trade_status:<最新一筆> }`，`尚未完成付款` |

- **冪等：** 訊息依 `UPDATE` 的 `changes` 與更新後狀態決定。修正現況中訂單同時間被改為 `failed` 仍回「付款成功」的問題。
- **錯誤碼：** 不新增。
- **連線逾時：** `queryTradeInfo` 加 `AbortSignal.timeout(10000)`，避免單筆卡住整輪；失敗時帶上 HTTP status 以辨識 403。

### 已知限制（本次不處理）

- **銀行回覆延遲：** 綠界說明付款後約 10 分鐘內可能仍為 `TradeStatus=0`，此期間重入仍可能重複付款。
- **離線付款：** 已取得 ATM／超商代碼（狀態 `0`）的舊單，日後仍可能與新單都被付款。
- **訂單轉 `paid` 後才在舊分頁付款：** 收不到通知，也不會再查詢。要根治須實作 `ReturnURL`，但目前僅在 localhost 運行。
- **重複扣款只有紀錄：** 僅寫 log 與資料表，沒有後台介面或自動退款。
- **模擬失敗後實際已付：** 經 `PATCH /pay` 標成 `failed` 的訂單不再對帳；前端已不呼叫此 API。
- **既有卡單：** 見上方「無法自動復原的部分」。

## 測試案例（`tests/ecpay.test.js`）

以 `vi.spyOn(global,'fetch').mockImplementation` 依編號回應，並斷言實際查詢的編號。回應須含綠界實測的 `10200047` 格式。

**新測試以 SQL 直接建立訂單，不走 `POST /api/orders`。** 否則會加速消耗 `products[0]` 庫存，而 `docs/TESTING.md` 已指出約 4 次執行後就會失敗。

**重入付款頁**
1. 首次進入：不呼叫綠界，新增 1 筆紀錄。
2. 舊單未付後重入：200，編號不同，歷史 2 筆，`orders.merchant_trade_no` 為最新。
3. **舊單已付但本地 `pending` 時重入（核心回歸）：** 302，訂單轉 `paid`，沒有新編號。
4. 已 `paid` 重入：302，不呼叫綠界，沒有新編號，`merchant_trade_no` 不變。
5. `failed` 重入：400，沒有新編號。
6. 對帳連線失敗後重入：502，沒有新編號，訂單仍 `pending`。
7. 已達 10 筆且皆未付：400，沒有新編號；其中一筆已付時則轉 `paid`。
8. 對帳期間訂單被改為非 `pending`：不寫入新編號。

**重複查詢**
9. 已 `paid` 再查：200，呼叫綠界 0 次，`ecpay_trade_no`、`paid_at` 不變。
10. 併發兩次查詢（`Promise.all`）：皆回 `paid`，付款欄位只寫入一次。
11. 未付款重複查詢：維持 `pending`，`trade_status` 更新。
12. 只經模擬付款標成 `paid` 且曾發起綠界付款：不呼叫綠界。

**多筆交易**
13. t1 已付、t2 未付：轉 `paid`，`ecpay_trade_no` 來自 t1，`merchant_trade_no` 改為 t1。
14. t1 未付、t2 已付：轉 `paid`。
15. **t1 已付、t2 回 `10200047`／`TradeAmt=0`（根因 3 回歸）：** 轉 `paid`，不是 502。
16. 全部未付：`pending`，每個編號恰查一次。
17. 一筆連線失敗、另一筆已付：轉 `paid`。
18. 一筆連線失敗、其餘未付：502，維持 `pending`。
19. 一筆 CheckMacValue 錯、其餘未付：502。
20. 已付但金額不符、其餘未付：502，維持 `pending`。
21. 回傳 `MerchantTradeNo` 與查詢值不符：502。
22. 兩筆皆已付：轉 `paid`，採最早一筆，兩筆 `trade_status=1`，`console.error` 被呼叫。
23. 收到 403：停止查詢後續編號，回 502。

**遷移與編號**
24. 回填可重複執行：有 `merchant_trade_no` 而無紀錄的訂單被補上，再跑一次不重複（將回填函式掛在 `db` 上供測試呼叫）。
25. `generateMerchantTradeNo`：固定 `Date.now()` 時連續呼叫仍不同，長度 ≤ 20、僅英數。

既有 `check-payment` 測試無須修改語意，因為它們都只有一筆編號，且金額不符的案例使用 `TradeStatus=1`。

## Tasks

- [x] `src/database.js`：新增 `ecpay_trades` 與索引、回填遷移
- [x] `src/services/ecpay.js`：編號加隨機碼、查詢逾時、錯誤帶 HTTP status
- [x] `src/routes/ecpayRoutes.js`：新增 `reconcileOrderPayment`，改寫付款頁與 `check-payment`，更新 `@openapi`
- [x] `tests/ecpay.test.js`：新增上列案例（修改前已確認案例 3、13、15 因行為不符而失敗：`200≠302`、`pending≠paid`、`502≠200`）
- [ ] 文件：`docs/FEATURES.md`（付款頁與查詢的行為表、移除「重新進入會覆寫」已知問題、金額比對順序）、`docs/ARCHITECTURE.md`（新資料表、`merchant_trade_no` 語意、付款流程圖、移除上線清單中的對應項目）、`docs/TESTING.md`（`ecpay.test.js` 由 19 增為 45 個案例、資料影響）、`docs/CHANGELOG.md`、`CLAUDE.md` ECPay 條目
- [ ] 驗證（見下，第 3、4 項尚未完成）
- [ ] 完成後 `git mv` 本計畫至 `docs/plans/archive/`

## 驗證

1. [x] 全部測試通過：77 個（原 51＋新增 26）。在專案副本以全新資料庫執行，未再消耗開發資料庫的庫存。
2. [x] `npm run openapi` 可正常產生（於副本執行），付款頁列出 200／302／400／401／404／502。
3. [ ] 付款頁與 `check-payment` 對綠界測試環境的端對端驗證：尚未完成，由下列手動步驟涵蓋。
4. [ ] 手動走測試環境（卡號 `4311-9522-2222-2222`，3D 驗證碼 `1234`）：
   - 付款 → **不查詢**，直接回訂單頁再按「前往綠界付款」→ 應導回訂單頁並顯示已付款，且綠界端只有一筆扣款。
   - 開付款頁後中途離開 → 重入 → 應出現新表單；查詢時兩個編號皆被查到。
   - 依綠界說明，信用卡付款後銀行未回覆時可能暫為 `TradeStatus=0`；若重入仍出現新表單，**先不要付款**，稍後再查。
5. [x] 回填遷移：在開發資料庫副本確認 18 筆既有編號全數補入，重跑後仍為 18 筆。

開發資料庫已於 2026-11-04 依要求清除，舊編號（含 `DE02F825A4B7CDFB`）的本地紀錄隨之移除；該交易仍存在於綠界測試環境。

## 實作注意

- 僅 stage 明確列出的檔案，不要用 `git add -A`。沙箱會在專案內掛載 `/dev/null` 佔位檔（`.bashrc`、`.mcp.json` 等），在沙箱內的 `git status` 會顯示為 untracked。
- 沙箱內 Node 的 `fetch` 無法解析外部 DNS，自動化測試不受影響（皆為 mock）；需連綠界的伺服器與手動驗證須在沙箱外執行。
- `npm test` 每次消耗 `products[0]` 庫存 7，新資料庫約可執行 4 次；新增的 26 個案例以 SQL 建單，不增加消耗。
