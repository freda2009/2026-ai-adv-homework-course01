const { app, request, registerUser } = require('./setup');

describe('Cart API', () => {
  const sessionId = 'test-session-' + Date.now();
  let productId;
  let cartItemId;
  let userToken;

  beforeAll(async () => {
    // Get a product id from the product list
    const res = await request(app).get('/api/products');
    productId = res.body.data.products[0].id;
  });

  it('should add product to cart (guest mode)', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('X-Session-Id', sessionId)
      .send({ productId, quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('product_id', productId);
    expect(res.body.data).toHaveProperty('quantity');

    cartItemId = res.body.data.id;
  });

  it('should get cart (guest mode)', async () => {
    const res = await request(app)
      .get('/api/cart')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('total');
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it('should update cart item quantity (guest mode)', async () => {
    const res = await request(app)
      .patch(`/api/cart/${cartItemId}`)
      .set('X-Session-Id', sessionId)
      .send({ quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('quantity', 3);
  });

  it('should remove cart item (guest mode)', async () => {
    const res = await request(app)
      .delete(`/api/cart/${cartItemId}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);

    // Verify cart is empty
    const cartRes = await request(app)
      .get('/api/cart')
      .set('X-Session-Id', sessionId);
    expect(cartRes.body.data.items.length).toBe(0);
  });

  it('should add product to cart (authenticated mode)', async () => {
    const { token } = await registerUser();
    userToken = token;

    const res = await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('product_id', productId);
  });

  it('should fail to add non-existent product to cart', async () => {
    const res = await request(app)
      .post('/api/cart')
      .set('X-Session-Id', sessionId)
      .send({ productId: 'non-existent-product-id', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toBeNull();
  });
});

describe('訪客購物車併入會員購物車', () => {
  const db = require('../src/database');
  const { v4: uuidv4 } = require('uuid');
  const PASSWORD = 'password123';
  const createdProducts = [];

  // 以 SQL 建立商品以控制庫存。created_at 設為舊日期，避免變成其他測試依賴的 products[0]
  function createProduct(stock, price = 100) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO products (id, name, price, stock, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2000-01-01 00:00:00', '2000-01-01 00:00:00')`
    ).run(id, `合併測試商品-${id.slice(0, 8)}`, price, stock);
    createdProducts.push(id);
    return id;
  }

  const newSession = () => `merge-session-${uuidv4()}`;
  const setStock = (productId, stock) => db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, productId);

  async function addToCart({ session, token }, productId, quantity) {
    const req = request(app).post('/api/cart');
    if (session) req.set('X-Session-Id', session);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.send({ productId, quantity });
    expect(res.status).toBe(200);
  }

  async function createMember() {
    const email = `merge-${uuidv4()}@example.com`;
    const { token, user } = await registerUser({ email, password: PASSWORD });
    return { email, token, user };
  }

  function login(email, session, password = PASSWORD) {
    const req = request(app).post('/api/auth/login');
    if (session) req.set('X-Session-Id', session);
    return req.send({ email, password });
  }

  const memberCart = async (token) => (await request(app)
    .get('/api/cart')
    .set('Authorization', `Bearer ${token}`)).body.data.items;

  const guestCart = async (session) => (await request(app)
    .get('/api/cart')
    .set('X-Session-Id', session)).body.data.items;

  const quantityOf = (items, productId) => items.find(i => i.product_id === productId)?.quantity;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const id of createdProducts) {
      db.prepare('DELETE FROM cart_items WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }
  });

  describe('合併情境', () => {
    it('訪客加入後登入：商品併入會員車，訪客車清空', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email } = await createMember();
      await addToCart({ session }, productId, 2);

      const res = await login(email, session);

      expect(res.status).toBe(200);
      expect(res.body.data.cart_merge).toEqual({ merged: 1, adjusted: 0 });
      expect(quantityOf(await memberCart(res.body.data.token), productId)).toBe(2);
      expect(await guestCart(session)).toHaveLength(0);
    });

    it('訪客加入後註冊：商品併入新會員車，訪客車清空', async () => {
      const productId = createProduct(10);
      const session = newSession();
      await addToCart({ session }, productId, 2);

      const res = await request(app)
        .post('/api/auth/register')
        .set('X-Session-Id', session)
        .send({ email: `merge-${uuidv4()}@example.com`, password: PASSWORD, name: '合併測試' });

      expect(res.status).toBe(201);
      expect(res.body.data.cart_merge).toEqual({ merged: 1, adjusted: 0 });
      expect(quantityOf(await memberCart(res.body.data.token), productId)).toBe(2);
      expect(await guestCart(session)).toHaveLength(0);
    });

    it('會員車已有同商品：數量相加且只有一列', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token, user } = await createMember();
      await addToCart({ token }, productId, 2);
      await addToCart({ session }, productId, 3);

      const res = await login(email, session);

      expect(res.body.data.cart_merge).toEqual({ merged: 1, adjusted: 0 });
      expect(quantityOf(await memberCart(token), productId)).toBe(5);
      const rows = db.prepare('SELECT id FROM cart_items WHERE user_id = ? AND product_id = ?').all(user.id, productId);
      expect(rows).toHaveLength(1);
    });

    it('會員車有不同商品：兩者並存', async () => {
      const memberProduct = createProduct(10);
      const guestProduct = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ token }, memberProduct, 1);
      await addToCart({ session }, guestProduct, 2);

      await login(email, session);

      const items = await memberCart(token);
      expect(items).toHaveLength(2);
      expect(quantityOf(items, memberProduct)).toBe(1);
      expect(quantityOf(items, guestProduct)).toBe(2);
    });

    it('相加超過庫存：以庫存為上限', async () => {
      const productId = createProduct(5);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ token }, productId, 3);
      await addToCart({ session }, productId, 4);

      const res = await login(email, session);

      expect(res.body.data.cart_merge).toEqual({ merged: 1, adjusted: 1 });
      expect(quantityOf(await memberCart(token), productId)).toBe(5);
      expect(await guestCart(session)).toHaveLength(0);
    });

    it('重複登入：不重複合併', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ session }, productId, 2);

      await login(email, session);
      const second = await login(email, session);

      expect(second.body.data.cart_merge).toEqual({ merged: 0, adjusted: 0 });
      expect(quantityOf(await memberCart(token), productId)).toBe(2);
    });
  });

  describe('庫存邊界', () => {
    it('訪客數量超過目前庫存：降為庫存量', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ session }, productId, 5);
      setStock(productId, 2);

      const res = await login(email, session);

      expect(res.body.data.cart_merge).toEqual({ merged: 1, adjusted: 1 });
      expect(quantityOf(await memberCart(token), productId)).toBe(2);
    });

    it('庫存為 0 且會員車沒有此商品：不併入並移除訪客列', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ session }, productId, 1);
      setStock(productId, 0);

      const res = await login(email, session);

      expect(res.body.data.cart_merge).toEqual({ merged: 0, adjusted: 1 });
      expect(await memberCart(token)).toHaveLength(0);
      expect(await guestCart(session)).toHaveLength(0);
    });

    it('會員車原數量已大於庫存：數量不被調低', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ token }, productId, 5);
      await addToCart({ session }, productId, 1);
      setStock(productId, 2);

      const res = await login(email, session);

      expect(res.body.data.cart_merge).toEqual({ merged: 0, adjusted: 1 });
      expect(quantityOf(await memberCart(token), productId)).toBe(5);
      expect(await guestCart(session)).toHaveLength(0);
    });
  });

  describe('隔離與失敗', () => {
    it('密碼錯誤：回 401，訪客車不變', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ session }, productId, 2);

      const res = await login(email, session, 'wrong-password');

      expect(res.status).toBe(401);
      expect(quantityOf(await guestCart(session), productId)).toBe(2);
      expect(await memberCart(token)).toHaveLength(0);
    });

    it('註冊 Email 重複：回 409，訪客車不變', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const { email } = await createMember();
      await addToCart({ session }, productId, 2);

      const res = await request(app)
        .post('/api/auth/register')
        .set('X-Session-Id', session)
        .send({ email, password: PASSWORD, name: '重複' });

      expect(res.status).toBe(409);
      expect(quantityOf(await guestCart(session), productId)).toBe(2);
    });

    it('登入不帶 X-Session-Id：正常成功且不合併', async () => {
      const { email, token } = await createMember();

      const res = await login(email);

      expect(res.status).toBe(200);
      expect(res.body.data.cart_merge).toEqual({ merged: 0, adjusted: 0 });
      expect(await memberCart(token)).toHaveLength(0);
    });

    it('其他 session 與其他會員的購物車不受影響', async () => {
      const productId = createProduct(10);
      const session = newSession();
      const otherSession = newSession();
      const { email } = await createMember();
      const other = await createMember();
      await addToCart({ session }, productId, 1);
      await addToCart({ session: otherSession }, productId, 2);
      await addToCart({ token: other.token }, productId, 3);

      await login(email, session);

      expect(quantityOf(await guestCart(otherSession), productId)).toBe(2);
      expect(quantityOf(await memberCart(other.token), productId)).toBe(3);
    });

    it('合併中途失敗：登入仍成功，交易回滾且訪客車完整保留', async () => {
      const movedProduct = createProduct(10);
      const summedProduct = createProduct(10);
      const session = newSession();
      const { email, token } = await createMember();
      await addToCart({ token }, summedProduct, 1);
      await addToCart({ session }, movedProduct, 2); // 先處理：整列移轉給會員
      await addToCart({ session }, summedProduct, 3); // 後處理：刪除訪客列時失敗

      vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql) => {
        if (sql.includes('DELETE FROM cart_items')) throw new Error('模擬合併失敗');
        return originalPrepare(sql);
      });

      const res = await login(email, session);
      vi.restoreAllMocks();

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.cart_merge).toEqual({ merged: 0, adjusted: 0 });
      const guest = await guestCart(session);
      expect(quantityOf(guest, movedProduct)).toBe(2);
      expect(quantityOf(guest, summedProduct)).toBe(3);
      const member = await memberCart(token);
      expect(member).toHaveLength(1);
      expect(quantityOf(member, summedProduct)).toBe(1);
    });
  });

  describe('完整流程', () => {
    it('訪客加入 → 登入 → 不需重新加入即可建立訂單', async () => {
      const productId = createProduct(10, 250);
      const session = newSession();
      const { email } = await createMember();
      await addToCart({ session }, productId, 2);

      const loginRes = await login(email, session);
      const orderRes = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${loginRes.body.data.token}`)
        .send({ recipientName: '合併測試', recipientEmail: email, recipientAddress: '台北市測試路 3 號' });

      expect(orderRes.status).toBe(201);
      expect(orderRes.body.data.total_amount).toBe(500);
      expect(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock).toBe(8);
    });
  });
});
