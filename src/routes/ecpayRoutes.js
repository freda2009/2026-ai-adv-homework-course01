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

// 綠界對高頻查詢回 403 且須等 30 分鐘；每次重入都會查全部歷史，故限制間隔與筆數
const QUERY_INTERVAL_MS = 200;
const MAX_TRADES_PER_ORDER = 10;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getOrderTrades(orderId) {
  return db.prepare('SELECT merchant_trade_no FROM ecpay_trades WHERE order_id = ? ORDER BY id').all(orderId);
}

// 逐筆查詢訂單的所有編號；任一筆已付款就將訂單轉為 paid。
// 不在第一筆已付款時停止，才能發現重複扣款。回傳 failure 表示有編號無法確認狀態。
async function reconcileOrderPayment(order) {
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;
  const updateTrade = db.prepare(
    `UPDATE ecpay_trades SET trade_status = ?, checked_at = datetime('now') WHERE merchant_trade_no = ?`
  );

  const paidResults = [];
  let failure = null;
  let latestTradeStatus = null;

  const trades = getOrderTrades(order.id);
  for (const [index, { merchant_trade_no: tradeNo }] of trades.entries()) {
    if (index > 0) await sleep(QUERY_INTERVAL_MS);

    let result;
    try {
      result = await queryTradeInfo(tradeNo);
    } catch (e) {
      failure = failure || `綠界查詢失敗：${e.message}`;
      if (e.status === 403) break; // 已被限流，繼續查只會延長封鎖
      continue;
    }

    if (!verifyCheckMacValue(result, hashKey, hashIv)) {
      failure = failure || '回傳 CheckMacValue 驗證失敗';
      continue;
    }
    if (result.MerchantTradeNo !== tradeNo) {
      failure = failure || '回傳交易編號不符';
      continue;
    }

    updateTrade.run(result.TradeStatus, tradeNo);
    latestTradeStatus = result.TradeStatus;

    if (result.TradeStatus !== '1') continue;

    // 只比對已付款交易的金額：綠界對不存在的編號回 TradeAmt=0
    if (parseInt(result.TradeAmt, 10) !== order.total_amount) {
      failure = failure || '交易金額不符';
      continue;
    }
    paidResults.push(result);
  }

  if (paidResults.length === 0) {
    return { paid: false, changed: false, failure, latestTradeStatus };
  }

  if (paidResults.length > 1) {
    const paidNos = paidResults.map(r => r.MerchantTradeNo).join(', ');
    console.error(`[ECPay] 訂單 ${order.id} 重複扣款，已付款編號：${paidNos}`);
  }

  const [first] = paidResults;
  // UPDATE … WHERE status='pending' 保持冪等
  const { changes } = db.transaction(() => db.prepare(
    `UPDATE orders SET status='paid', merchant_trade_no=?, ecpay_trade_no=?, payment_type=?, paid_at=?
     WHERE id=? AND status='pending'`
  ).run(first.MerchantTradeNo, first.TradeNo || '', first.PaymentType || '', first.PaymentDate || '', order.id))();

  return { paid: true, changed: changes > 0, failure, latestTradeStatus };
}

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
 *       302:
 *         description: 訂單已付款（含重入時對帳發現已付款），導向訂單頁
 *       400:
 *         description: 訂單已失敗，或發起付款次數已達上限
 *       401:
 *         description: 缺少或無效的 token
 *       404:
 *         description: 訂單不存在或非本人
 *       502:
 *         description: 無法確認先前的交易是否已付款，不產生新付款
 */
pageRouter.get('/payment/:orderId', queryAuth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const getOrder = () => db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.userId);
    const orderPage = `/orders/${orderId}`;

    const order = getOrder();
    if (!order) return res.status(404).send('訂單不存在');
    if (order.status === 'paid') return res.redirect(orderPage);
    if (order.status !== 'pending') return res.status(400).send('訂單狀態不是 pending，無法付款');

    // 收不到綠界通知，本地 pending 不代表未付款：先對帳，避免引導使用者重複付款
    if (getOrderTrades(orderId).length > 0) {
      const outcome = await reconcileOrderPayment(order);
      if (!outcome.paid && outcome.failure) {
        return res.status(502).send('暫時無法確認先前的付款狀態，請稍後再試');
      }
    }

    // await 期間訂單可能已變更，須重新讀取；以下皆為同步，不會再被插隊
    const current = getOrder();
    if (current.status === 'paid') return res.redirect(orderPage);
    if (current.status !== 'pending') return res.status(400).send('訂單狀態不是 pending，無法付款');
    if (getOrderTrades(orderId).length >= MAX_TRADES_PER_ORDER) {
      return res.status(400).send('此訂單發起付款次數已達上限，請重新下單或聯繫客服');
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const merchantTradeNo = generateMerchantTradeNo(orderId);

    db.transaction(() => {
      db.prepare('INSERT INTO ecpay_trades (merchant_trade_no, order_id) VALUES (?, ?)').run(merchantTradeNo, orderId);
      db.prepare('UPDATE orders SET merchant_trade_no = ? WHERE id = ?').run(merchantTradeNo, orderId);
    })();

    const { action, params } = buildAioParams(current, items, merchantTradeNo);
    res.render('pages/ecpay-redirect', { action, params });
  } catch (err) {
    next(err);
  }
});

// ── API Router：掛載於 /api/orders ────────────────────────────────
const apiRouter = express.Router();
apiRouter.use(authMiddleware);

/**
 * @openapi
 * /api/orders/{id}/check-payment:
 *   post:
 *     summary: 以 ECPay QueryTradeInfo 逐筆查詢訂單所有交易編號，任一筆已付款即更新訂單
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
 *         description: 無已付款交易，且至少一筆查詢失敗或驗證不符
 */
apiRouter.post('/:id/check-payment', async (req, res, next) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.userId);

    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }
    if (getOrderTrades(order.id).length === 0) {
      return res.status(400).json({
        data: null, error: 'PAYMENT_NOT_STARTED', message: '尚未發起綠界付款'
      });
    }
    const respondSettled = status => res.json({
      data: { status },
      error: null,
      message: status === 'paid' ? '訂單已付款' : '訂單狀態異常'
    });

    // 冪等：已付款直接回傳
    if (order.status !== 'pending') return respondSettled(order.status);

    const outcome = await reconcileOrderPayment(order);

    if (outcome.paid) {
      if (outcome.changed) {
        return res.json({ data: { status: 'paid' }, error: null, message: '付款成功' });
      }
      // 查詢期間訂單已被其他請求變更
      return respondSettled(db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status);
    }

    if (outcome.failure) {
      return res.status(502).json({
        data: null, error: 'ECPAY_QUERY_FAILED', message: outcome.failure
      });
    }

    return res.json({
      data: { status: 'pending', trade_status: outcome.latestTradeStatus },
      error: null,
      message: '尚未完成付款'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { pageRouter, apiRouter };
