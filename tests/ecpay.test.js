const { app, request, registerUser } = require('./setup');
const {
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
} = require('../src/services/ecpay');

// 測試向量複製自 ecpay skill 的 test-vectors/checkmacvalue.json，納入版控以便全新 clone 也能執行
const vectors = require('./fixtures/ecpay-checkmacvalue.json');

// ── 1. CheckMacValue 測試向量 ────────────────────────────────────────
describe('CheckMacValue 計算', () => {
  const aioVectors = vectors.vectors.filter(v => v.method === 'SHA256' && !v.formula);

  for (const v of aioVectors) {
    it(v.name, () => {
      const result = generateCheckMacValue(v.params, v.hashKey, v.hashIV);
      expect(result).toBe(v.expected);
    });
  }

  it('verifyCheckMacValue 應通過正確 CMV', () => {
    const v = aioVectors[0];
    const params = { ...v.params, CheckMacValue: v.expected };
    expect(verifyCheckMacValue(params, v.hashKey, v.hashIV)).toBe(true);
  });

  it('verifyCheckMacValue 應拒絕錯誤 CMV', () => {
    const v = aioVectors[0];
    const params = { ...v.params, CheckMacValue: 'WRONG' + v.expected.slice(5) };
    expect(verifyCheckMacValue(params, v.hashKey, v.hashIV)).toBe(false);
  });
});

// ── 2. generateMerchantTradeNo ────────────────────────────────────────
describe('generateMerchantTradeNo', () => {
  it('應為英數字且長度 ≤ 20', () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440000';
    const no = generateMerchantTradeNo(orderId);
    expect(no).toMatch(/^[A-Z0-9]+$/);
    expect(no.length).toBeLessThanOrEqual(20);
  });

  it('連續呼叫應產生不同值', async () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440000';
    const a = generateMerchantTradeNo(orderId);
    await new Promise(r => setTimeout(r, 2));
    const b = generateMerchantTradeNo(orderId);
    expect(a).not.toBe(b);
  });
});

// ── 3. GET /ecpay/payment/:orderId ────────────────────────────────────
describe('GET /ecpay/payment/:orderId', () => {
  let userToken;
  let orderId;

  beforeAll(async () => {
    const { token } = await registerUser();
    userToken = token;

    // 建立訂單
    const prodRes = await request(app).get('/api/products');
    const productId = prodRes.body.data.products[0].id;
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '測試收件人',
        recipientEmail: 'ecpay@example.com',
        recipientAddress: '台北市測試路 1 號',
      });
    orderId = orderRes.body.data.id;
  });

  it('缺少 token 應回傳 401', async () => {
    const res = await request(app).get(`/ecpay/payment/${orderId}`);
    expect(res.status).toBe(401);
  });

  it('他人訂單應回傳 404', async () => {
    const { token: otherToken } = await registerUser();
    const res = await request(app)
      .get(`/ecpay/payment/${orderId}?token=${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('應回傳含 <form action="..."> 的 HTML 並帶 CheckMacValue', async () => {
    const res = await request(app)
      .get(`/ecpay/payment/${orderId}?token=${userToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('payment-stage.ecpay.com.tw');
    expect(res.text).toContain('CheckMacValue');
    // MerchantTradeNo 應為英數、≤ 20 字
    const match = res.text.match(/name="MerchantTradeNo" value="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match[1]).toMatch(/^[A-Z0-9]+$/);
    expect(match[1].length).toBeLessThanOrEqual(20);
  });
});

// ── 4. POST /api/orders/:id/check-payment ────────────────────────────
describe('POST /api/orders/:id/check-payment', () => {
  let userToken;
  let orderId;
  let otherToken;

  beforeAll(async () => {
    const { token } = await registerUser();
    userToken = token;
    const { token: ot } = await registerUser();
    otherToken = ot;

    const prodRes = await request(app).get('/api/products');
    const productId = prodRes.body.data.products[0].id;
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '查詢測試',
        recipientEmail: 'query@example.com',
        recipientAddress: '台北市測試路 2 號',
      });
    orderId = orderRes.body.data.id;
  });

  it('尚未發起付款應回 400 PAYMENT_NOT_STARTED', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/check-payment`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PAYMENT_NOT_STARTED');
  });

  it('他人訂單應回 404', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/check-payment`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  describe('已發起付款後', () => {
    beforeAll(async () => {
      // 先呼叫 GET /ecpay/payment 以寫入 merchant_trade_no
      await request(app).get(`/ecpay/payment/${orderId}?token=${userToken}`);
    });

    it('TradeStatus=1 且金額正確 → 訂單轉 paid', async () => {
      // 取得 merchant_trade_no 以算出正確 CMV
      const db = require('../src/database');
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const { generateCheckMacValue: cmv } = require('../src/services/ecpay');

      const fakeResult = {
        MerchantID: process.env.ECPAY_MERCHANT_ID || '3002607',
        MerchantTradeNo: order.merchant_trade_no,
        TradeNo: 'FAKE0000000000001',
        TradeAmt: String(order.total_amount),
        TradeStatus: '1',
        PaymentType: 'Credit_CreditCard',
        PaymentDate: '2026/11/04 12:00:00',
      };
      fakeResult.CheckMacValue = cmv(
        fakeResult,
        process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6',
        process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs'
      );

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => new URLSearchParams(fakeResult).toString(),
      });

      const res = await request(app)
        .post(`/api/orders/${orderId}/check-payment`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data.status).toBe('paid');
      fetchSpy.mockRestore();
    });

    it('冪等：再次查詢已付款訂單應直接回 paid', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderId}/check-payment`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
    });
  });

  it('TradeStatus=0 → 200 仍 pending', async () => {
    // 建立新訂單並啟動付款
    const { token: t2 } = await registerUser();
    const prodRes = await request(app).get('/api/products');
    const productId = prodRes.body.data.products[0].id;
    await request(app).post('/api/cart').set('Authorization', `Bearer ${t2}`).send({ productId, quantity: 1 });
    const o2 = await request(app).post('/api/orders').set('Authorization', `Bearer ${t2}`)
      .send({ recipientName: 'T', recipientEmail: 't@t.com', recipientAddress: 'A' });
    const oid2 = o2.body.data.id;
    await request(app).get(`/ecpay/payment/${oid2}?token=${t2}`);

    const db = require('../src/database');
    const order2 = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid2);
    const { generateCheckMacValue: cmv } = require('../src/services/ecpay');

    const fakeResult = {
      MerchantID: process.env.ECPAY_MERCHANT_ID || '3002607',
      MerchantTradeNo: order2.merchant_trade_no,
      TradeNo: '',
      TradeAmt: String(order2.total_amount),
      TradeStatus: '0',
      PaymentType: '',
      PaymentDate: '',
    };
    fakeResult.CheckMacValue = cmv(
      fakeResult,
      process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6',
      process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs'
    );

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => new URLSearchParams(fakeResult).toString(),
    });

    const res = await request(app)
      .post(`/api/orders/${oid2}/check-payment`)
      .set('Authorization', `Bearer ${t2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.message).toContain('尚未');
    fetchSpy.mockRestore();
  });

  it('金額不符 → 502 ECPAY_QUERY_FAILED', async () => {
    const { token: t3 } = await registerUser();
    const prodRes = await request(app).get('/api/products');
    const productId = prodRes.body.data.products[0].id;
    await request(app).post('/api/cart').set('Authorization', `Bearer ${t3}`).send({ productId, quantity: 1 });
    const o3 = await request(app).post('/api/orders').set('Authorization', `Bearer ${t3}`)
      .send({ recipientName: 'T', recipientEmail: 't@t.com', recipientAddress: 'A' });
    const oid3 = o3.body.data.id;
    await request(app).get(`/ecpay/payment/${oid3}?token=${t3}`);

    const db = require('../src/database');
    const order3 = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid3);
    const { generateCheckMacValue: cmv } = require('../src/services/ecpay');

    const fakeResult = {
      MerchantID: process.env.ECPAY_MERCHANT_ID || '3002607',
      MerchantTradeNo: order3.merchant_trade_no,
      TradeNo: 'FAKE2',
      TradeAmt: '1', // 金額故意不符
      TradeStatus: '1',
      PaymentType: 'Credit_CreditCard',
      PaymentDate: '2026/11/04 12:00:00',
    };
    fakeResult.CheckMacValue = cmv(
      fakeResult,
      process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6',
      process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs'
    );

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => new URLSearchParams(fakeResult).toString(),
    });

    const res = await request(app)
      .post(`/api/orders/${oid3}/check-payment`)
      .set('Authorization', `Bearer ${t3}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ECPAY_QUERY_FAILED');
    fetchSpy.mockRestore();
  });

  it('CMV 不符 → 502 ECPAY_QUERY_FAILED', async () => {
    const { token: t4 } = await registerUser();
    const prodRes = await request(app).get('/api/products');
    const productId = prodRes.body.data.products[0].id;
    await request(app).post('/api/cart').set('Authorization', `Bearer ${t4}`).send({ productId, quantity: 1 });
    const o4 = await request(app).post('/api/orders').set('Authorization', `Bearer ${t4}`)
      .send({ recipientName: 'T', recipientEmail: 't@t.com', recipientAddress: 'A' });
    const oid4 = o4.body.data.id;
    await request(app).get(`/ecpay/payment/${oid4}?token=${t4}`);

    const db = require('../src/database');
    const order4 = db.prepare('SELECT * FROM orders WHERE id = ?').get(oid4);

    const fakeResult = {
      MerchantID: '3002607',
      MerchantTradeNo: order4.merchant_trade_no,
      TradeAmt: String(order4.total_amount),
      TradeStatus: '1',
      CheckMacValue: 'BADCMVBADCMVBADCMVBADCMVBADCMVBADCMVBADCMVBADCMVBADCMVBADCMV1',
    };

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => new URLSearchParams(fakeResult).toString(),
    });

    const res = await request(app)
      .post(`/api/orders/${oid4}/check-payment`)
      .set('Authorization', `Bearer ${t4}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ECPAY_QUERY_FAILED');
    fetchSpy.mockRestore();
  });
});

// ── 5. 重入付款頁與多筆交易 ──────────────────────────────────────────
describe('重入付款頁與多筆交易對帳', () => {
  const db = require('../src/database');
  const { v4: uuidv4 } = require('uuid');
  const { generateCheckMacValue: cmv } = require('../src/services/ecpay');
  const AMOUNT = 1000;

  let fetchSpy;
  let ecpay; // 模擬綠界端：merchantTradeNo → 回應設定
  let queried; // 實際送往 QueryTradeInfo 的編號

  // 不存在的編號依 2026-11-04 測試環境實測格式回應：HTTP 200、TradeAmt=0、CMV 有效
  function buildResponse(no) {
    const t = ecpay[no];
    const status = t ? t.status : '10200047';
    const paid = status === '1';
    const body = {
      HandlingCharge: '0',
      ItemName: '',
      MerchantID: process.env.ECPAY_MERCHANT_ID,
      MerchantTradeNo: t && t.wrongNo ? 'SOMEOTHERTRADENO' : no,
      PaymentDate: paid ? (t.date || '2026/11/04 12:00:00') : '',
      PaymentType: paid ? 'Credit_CreditCard' : '',
      PaymentTypeChargeFee: '0',
      TradeAmt: String(t ? (t.amt ?? AMOUNT) : 0),
      TradeDate: '',
      TradeNo: paid ? `TN${no}`.slice(0, 20) : '',
      TradeStatus: status,
    };
    body.CheckMacValue = t && t.badCmv
      ? 'BAD'
      : cmv(body, process.env.ECPAY_HASH_KEY, process.env.ECPAY_HASH_IV);
    return new URLSearchParams(body).toString();
  }

  beforeEach(() => {
    ecpay = {};
    queried = [];
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, opt) => {
      const no = new URLSearchParams(opt.body).get('MerchantTradeNo');
      queried.push(no);
      const t = ecpay[no];
      if (t && t.networkError) throw new Error('connect ECONNREFUSED');
      if (t && t.http) return { ok: false, status: t.http, text: async () => '' };
      return { ok: true, status: 200, text: async () => buildResponse(no) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 直接以 SQL 建立訂單，避免消耗 products[0] 庫存（見 docs/TESTING.md）
  async function createOrder(status = 'pending') {
    const { token, user } = await registerUser();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, order_no, user_id, recipient_name, recipient_email, recipient_address, total_amount, status)
       VALUES (?, ?, ?, 'T', 't@t.com', 'A', ?, ?)`
    ).run(id, `ORD-TEST-${id.slice(0, 13)}`, user.id, AMOUNT, status);
    db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
       VALUES (?, ?, 'test-product', '測試商品', ?, 1)`
    ).run(uuidv4(), id, AMOUNT);
    return { id, token };
  }

  const enter = (o) => request(app).get(`/ecpay/payment/${o.id}?token=${o.token}`);

  // 進入付款頁並回傳新編號；測試會斷言前一步成功
  async function startTrade(o) {
    const res = await enter(o);
    expect(res.status).toBe(200);
    return res.text.match(/name="MerchantTradeNo" value="([^"]+)"/)[1];
  }

  const check = (o) => request(app)
    .post(`/api/orders/${o.id}/check-payment`)
    .set('Authorization', `Bearer ${o.token}`);

  const orderRow = (o) => db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
  const tradeRows = (o) => db.prepare('SELECT * FROM ecpay_trades WHERE order_id = ? ORDER BY id').all(o.id);

  function insertTrades(o, count) {
    const nos = [];
    for (let i = 0; i < count; i++) {
      const no = `SEED${o.id.replace(/-/g, '').slice(0, 12)}${String(i).padStart(4, '0')}`.toUpperCase();
      db.prepare('INSERT INTO ecpay_trades (merchant_trade_no, order_id) VALUES (?, ?)').run(no, o.id);
      nos.push(no);
    }
    db.prepare('UPDATE orders SET merchant_trade_no = ? WHERE id = ?').run(nos[nos.length - 1], o.id);
    return nos;
  }

  describe('重入付款頁', () => {
    it('首次進入不呼叫綠界，新增 1 筆紀錄', async () => {
      const o = await createOrder();
      const no = await startTrade(o);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(tradeRows(o).map(t => t.merchant_trade_no)).toEqual([no]);
      expect(orderRow(o).merchant_trade_no).toBe(no);
    });

    it('舊單未付後重入：產生新編號並保留歷史', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '0' };
      const t2 = await startTrade(o);
      expect(t2).not.toBe(t1);
      expect(tradeRows(o).map(t => t.merchant_trade_no)).toEqual([t1, t2]);
      expect(orderRow(o).merchant_trade_no).toBe(t2);
    });

    it('舊單已付但本地仍 pending 時重入：轉 paid 並導回訂單頁，不產生新編號', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '1' };

      const res = await enter(o);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/orders/${o.id}`);
      expect(orderRow(o).status).toBe('paid');
      expect(orderRow(o).merchant_trade_no).toBe(t1);
      expect(tradeRows(o)).toHaveLength(1);
    });

    it('已 paid 重入：導回訂單頁，不呼叫綠界也不產生新編號', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '1' };
      await check(o);
      fetchSpy.mockClear();

      const res = await enter(o);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/orders/${o.id}`);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(tradeRows(o)).toHaveLength(1);
      expect(orderRow(o).merchant_trade_no).toBe(t1);
    });

    it('failed 重入：回 400，不產生新編號', async () => {
      const o = await createOrder('failed');
      const res = await enter(o);
      expect(res.status).toBe(400);
      expect(tradeRows(o)).toHaveLength(0);
    });

    it('對帳連線失敗：回 502 且不放行新付款', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { networkError: true };

      const res = await enter(o);

      expect(res.status).toBe(502);
      expect(tradeRows(o)).toHaveLength(1);
      expect(orderRow(o).status).toBe('pending');
    });

    it('已達 10 筆且皆未付：回 400，不產生新編號', async () => {
      const o = await createOrder();
      const nos = insertTrades(o, 10);
      nos.forEach(no => { ecpay[no] = { status: '0' }; });

      const res = await enter(o);

      expect(res.status).toBe(400);
      expect(tradeRows(o)).toHaveLength(10);
      expect(queried).toEqual(nos);
    });

    it('已達 10 筆但其中一筆已付：仍轉 paid', async () => {
      const o = await createOrder();
      const nos = insertTrades(o, 10);
      nos.forEach(no => { ecpay[no] = { status: '0' }; });
      ecpay[nos[4]] = { status: '1' };

      const res = await enter(o);

      expect(res.status).toBe(302);
      expect(orderRow(o).status).toBe('paid');
      expect(orderRow(o).merchant_trade_no).toBe(nos[4]);
      expect(tradeRows(o)).toHaveLength(10);
    });

    it('對帳期間訂單被改為非 pending：不寫入新編號', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '0' };
      fetchSpy.mockImplementationOnce(async () => {
        db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(o.id);
        return { ok: true, status: 200, text: async () => buildResponse(t1) };
      });

      const res = await enter(o);

      expect(res.status).toBe(400);
      expect(tradeRows(o)).toHaveLength(1);
      expect(orderRow(o).merchant_trade_no).toBe(t1);
    });
  });

  describe('重複查詢', () => {
    it('已 paid 再查：不呼叫綠界，付款欄位不變', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '1' };
      await check(o);
      const before = orderRow(o);
      fetchSpy.mockClear();

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.message).toBe('訂單已付款');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(orderRow(o)).toEqual(before);
    });

    it('併發兩次查詢：皆回 paid，只有一次轉換狀態', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '1' };

      const [a, b] = await Promise.all([check(o), check(o)]);

      expect(a.body.data.status).toBe('paid');
      expect(b.body.data.status).toBe('paid');
      expect([a.body.message, b.body.message].sort()).toEqual(['付款成功', '訂單已付款'].sort());
    });

    it('未付款重複查詢：維持 pending 並更新 trade_status', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);

      const first = await check(o);
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ status: 'pending', trade_status: '10200047' });
      expect(tradeRows(o)[0].trade_status).toBe('10200047');

      ecpay[t1] = { status: '0' };
      const second = await check(o);
      expect(second.body.data).toEqual({ status: 'pending', trade_status: '0' });
      expect(tradeRows(o)[0].trade_status).toBe('0');
      expect(tradeRows(o)[0].checked_at).toBeTruthy();
      expect(orderRow(o).status).toBe('pending');
    });

    it('曾發起綠界付款但以模擬付款標成 paid：不呼叫綠界', async () => {
      const o = await createOrder();
      await startTrade(o);
      await request(app)
        .patch(`/api/orders/${o.id}/pay`)
        .set('Authorization', `Bearer ${o.token}`)
        .send({ action: 'success' });

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('多筆交易', () => {
    async function twoTrades(o) {
      const t1 = await startTrade(o);
      ecpay[t1] = { status: '0' };
      const t2 = await startTrade(o);
      ecpay[t2] = { status: '0' };
      queried = [];
      return [t1, t2];
    }

    it('舊單已付、新單未付：轉 paid 並記錄實際付款的編號', async () => {
      const o = await createOrder();
      const [t1, t2] = await twoTrades(o);
      ecpay[t1] = { status: '1' };

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(queried).toEqual([t1, t2]);
      const row = orderRow(o);
      expect(row.ecpay_trade_no).toBe(`TN${t1}`.slice(0, 20));
      expect(row.merchant_trade_no).toBe(t1);
      expect(row.payment_type).toBe('Credit_CreditCard');
      expect(row.paid_at).toBe('2026/11/04 12:00:00');
    });

    it('舊單未付、新單已付：轉 paid', async () => {
      const o = await createOrder();
      const [, t2] = await twoTrades(o);
      ecpay[t2] = { status: '1' };

      const res = await check(o);

      expect(res.body.data.status).toBe('paid');
      expect(orderRow(o).merchant_trade_no).toBe(t2);
    });

    it('舊單已付、新單未送達綠界（10200047、TradeAmt=0）：轉 paid 而非 502', async () => {
      const o = await createOrder();
      const t1 = await startTrade(o);
      const t2 = await startTrade(o); // t2 不在 ecpay 表內，等同未送達
      ecpay[t1] = { status: '1' };
      queried = [];

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(queried).toEqual([t1, t2]);
    });

    it('全部未付：維持 pending，每個編號恰查一次', async () => {
      const o = await createOrder();
      const [t1, t2] = await twoTrades(o);

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.message).toContain('尚未');
      expect(queried).toEqual([t1, t2]);
    });

    it('一筆連線失敗、另一筆已付：轉 paid', async () => {
      const o = await createOrder();
      const [t1, t2] = await twoTrades(o);
      ecpay[t1] = { networkError: true };
      ecpay[t2] = { status: '1' };

      const res = await check(o);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
    });

    it('一筆連線失敗、其餘未付：502，維持 pending', async () => {
      const o = await createOrder();
      const [t1] = await twoTrades(o);
      ecpay[t1] = { networkError: true };

      const res = await check(o);

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('ECPAY_QUERY_FAILED');
      expect(orderRow(o).status).toBe('pending');
    });

    it('一筆 CheckMacValue 錯、其餘未付：502，且不寫回該筆狀態', async () => {
      const o = await createOrder();
      const [t1] = await twoTrades(o);
      ecpay[t1] = { status: '1', badCmv: true };

      const res = await check(o);

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('ECPAY_QUERY_FAILED');
      expect(orderRow(o).status).toBe('pending');
      expect(tradeRows(o)[0].trade_status).not.toBe('1');
    });

    it('已付但金額不符、其餘未付：502，維持 pending', async () => {
      const o = await createOrder();
      const [t1] = await twoTrades(o);
      ecpay[t1] = { status: '1', amt: 1 };

      const res = await check(o);

      expect(res.status).toBe(502);
      expect(res.body.message).toBe('交易金額不符');
      expect(orderRow(o).status).toBe('pending');
    });

    it('回傳的 MerchantTradeNo 與查詢值不符：502', async () => {
      const o = await createOrder();
      const [t1] = await twoTrades(o);
      ecpay[t1] = { status: '1', wrongNo: true };

      const res = await check(o);

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('ECPAY_QUERY_FAILED');
      expect(orderRow(o).status).toBe('pending');
    });

    it('兩筆皆已付：採最早一筆並記錄重複扣款', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const o = await createOrder();
      const [t1, t2] = await twoTrades(o);
      ecpay[t1] = { status: '1', date: '2026/11/04 12:00:00' };
      ecpay[t2] = { status: '1', date: '2026/11/04 12:05:00' };

      const res = await check(o);

      expect(res.body.data.status).toBe('paid');
      expect(orderRow(o).merchant_trade_no).toBe(t1);
      expect(orderRow(o).paid_at).toBe('2026/11/04 12:00:00');
      expect(tradeRows(o).map(t => t.trade_status)).toEqual(['1', '1']);
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toContain(t1);
      expect(logged).toContain(t2);
    });

    it('收到 403：停止查詢後續編號並回 502', async () => {
      const o = await createOrder();
      const [t1, t2] = await twoTrades(o);
      ecpay[t1] = { http: 403 };
      ecpay[t2] = { status: '1' };

      const res = await check(o);

      expect(res.status).toBe(502);
      expect(queried).toEqual([t1]);
      expect(orderRow(o).status).toBe('pending');
    });
  });

  describe('遷移與編號', () => {
    it('回填可重複執行且不重複', async () => {
      const o = await createOrder();
      const legacyNo = `LEGACY${o.id.replace(/-/g, '').slice(0, 14)}`.toUpperCase();
      db.prepare('UPDATE orders SET merchant_trade_no = ? WHERE id = ?').run(legacyNo, o.id);
      expect(tradeRows(o)).toHaveLength(0);

      db.backfillEcpayTrades();
      db.backfillEcpayTrades();

      expect(tradeRows(o).map(t => t.merchant_trade_no)).toEqual([legacyNo]);
    });

    it('同一毫秒連續產生的編號仍不同，且符合綠界格式', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1790000000000);
      const orderId = '550e8400-e29b-41d4-a716-446655440000';
      const nos = Array.from({ length: 5 }, () => generateMerchantTradeNo(orderId));
      expect(new Set(nos).size).toBeGreaterThan(1);
      for (const no of nos) {
        expect(no).toMatch(/^[A-Z0-9]+$/);
        expect(no.length).toBeLessThanOrEqual(20);
      }
    });
  });
});
