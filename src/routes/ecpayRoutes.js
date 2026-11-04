const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const {
  buildAioParams,
  generateMerchantTradeNo,
  queryTradeInfo,
  verifyCheckMacValue,
} = require('../services/ecpay');

// ── 頁面 Router：掛載於 /ecpay ─────────────────────────────────────
const pageRouter = express.Router();

// 瀏覽器直接導向時 JWT 以 query ?token= 傳入
function queryAuth(req, res, next) {
  const token = req.query.token;
  if (!token) return res.status(401).send('未授權，請重新登入');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(401).send('使用者不存在');
    req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role };
    next();
  } catch {
    return res.status(401).send('Token 無效或已過期，請重新登入');
  }
}

/**
 * @openapi
 * /ecpay/payment/{orderId}:
 *   get:
 *     summary: 產生 ECPay AIO 自動送出付款表單
 *     tags: [ECPay]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: HTML 自動送出表單頁
 */
pageRouter.get('/payment/:orderId', queryAuth, (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.userId;

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!order) return res.status(404).send('訂單不存在');
  if (order.status !== 'pending') return res.status(400).send('訂單狀態不是 pending，無法付款');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const merchantTradeNo = generateMerchantTradeNo(orderId);

  db.prepare('UPDATE orders SET merchant_trade_no = ? WHERE id = ?').run(merchantTradeNo, orderId);

  const { action, params } = buildAioParams(order, items, merchantTradeNo);
  res.render('pages/ecpay-redirect', { action, params });
});

// ── API Router：掛載於 /api/orders ────────────────────────────────
const apiRouter = express.Router();
apiRouter.use(authMiddleware);

/**
 * @openapi
 * /api/orders/{id}/check-payment:
 *   post:
 *     summary: 呼叫 ECPay QueryTradeInfo 驗證並更新訂單狀態
 *     tags: [ECPay]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 查詢成功
 *       400:
 *         description: 尚未發起付款或狀態異常
 *       404:
 *         description: 訂單不存在或非本人
 *       502:
 *         description: 綠界查詢失敗
 */
apiRouter.post('/:id/check-payment', async (req, res, next) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);

    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }
    if (!order.merchant_trade_no) {
      return res.status(400).json({
        data: null, error: 'PAYMENT_NOT_STARTED', message: '尚未發起綠界付款'
      });
    }
    // 冪等：已付款直接回傳
    if (order.status !== 'pending') {
      return res.json({
        data: { status: order.status },
        error: null,
        message: order.status === 'paid' ? '訂單已付款' : '訂單狀態異常'
      });
    }

    let result;
    try {
      result = await queryTradeInfo(order.merchant_trade_no);
    } catch (e) {
      return res.status(502).json({
        data: null, error: 'ECPAY_QUERY_FAILED', message: `綠界查詢失敗：${e.message}`
      });
    }

    const hashKey = process.env.ECPAY_HASH_KEY;
    const hashIv = process.env.ECPAY_HASH_IV;

    if (!verifyCheckMacValue(result, hashKey, hashIv)) {
      return res.status(502).json({
        data: null, error: 'ECPAY_QUERY_FAILED', message: '回傳 CheckMacValue 驗證失敗'
      });
    }
    if (parseInt(result.TradeAmt, 10) !== order.total_amount) {
      return res.status(502).json({
        data: null, error: 'ECPAY_QUERY_FAILED', message: '交易金額不符'
      });
    }

    if (result.TradeStatus !== '1') {
      return res.json({
        data: { status: 'pending', trade_status: result.TradeStatus },
        error: null,
        message: '尚未完成付款'
      });
    }

    // UPDATE … WHERE status='pending' 保持冪等
    db.transaction(() => {
      db.prepare(
        `UPDATE orders SET status='paid', ecpay_trade_no=?, payment_type=?, paid_at=?
         WHERE id=? AND status='pending'`
      ).run(result.TradeNo || '', result.PaymentType || '', result.PaymentDate || '', order.id);
    })();

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return res.json({ data: { status: updated.status }, error: null, message: '付款成功' });
  } catch (err) {
    next(err);
  }
});

module.exports = { pageRouter, apiRouter };
