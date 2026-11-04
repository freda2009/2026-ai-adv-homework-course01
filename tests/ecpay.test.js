const path = require('path');
const { app, request, registerUser } = require('./setup');
const {
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
} = require('../src/services/ecpay');

// 測試向量來自 .claude/skills/ecpay/test-vectors/checkmacvalue.json
const vectors = require(
  path.join(__dirname, '..', '.claude', 'skills', 'ecpay', 'test-vectors', 'checkmacvalue.json')
);

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
