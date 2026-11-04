# 功能

✅ 認證、商品、購物車（含訪客併入）、訂單、後台、ECPay AIO
⚠️ 運費僅前端顯示
❌ 取消訂單、速率限制

回應格式 `{ data, error, message }`。

**錯誤碼**：`VALIDATION_ERROR`、`CART_EMPTY`、`STOCK_INSUFFICIENT`、`INVALID_STATUS`、`PAYMENT_NOT_STARTED`（400）；`UNAUTHORIZED`（401）；`FORBIDDEN`（403）；`NOT_FOUND`（404）；`CONFLICT`（409）；`ECPAY_QUERY_FAILED`（502）；`INTERNAL_ERROR`（500）。

**ECPay**：`check-payment` 查全部歷史編號，任一筆已付款即轉 `paid`。

詳細：[reference/FEATURES.md](./reference/FEATURES.md)
