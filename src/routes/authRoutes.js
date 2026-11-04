const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const cartService = require('../services/cart');

const router = express.Router();

// 合併失敗不阻擋登入：transaction 已回滾，訪客車保留，下次登入可再合併
function mergeGuestCartSafely(req, userId) {
  if (!req.sessionId) return { merged: 0, adjusted: 0 };
  try {
    return cartService.mergeGuestCart(req.sessionId, userId);
  } catch (err) {
    console.error('[Cart] 訪客購物車合併失敗：', err);
    return { merged: 0, adjusted: 0 };
  }
}

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: 註冊新帳號
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Session-Id
 *         required: false
 *         schema:
 *           type: string
 *         description: 訪客購物車識別碼；成功後將該購物車併入會員購物車
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: 註冊成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *                         role:
 *                           type: string
 *                     token:
 *                       type: string
 *                     cart_merge:
 *                       type: object
 *                       description: 訪客購物車合併結果；未帶 X-Session-Id 或合併失敗時皆為 0
 *                       properties:
 *                         merged:
 *                           type: integer
 *                         adjusted:
 *                           type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 參數缺失或格式錯誤
 *       409:
 *         description: Email 已被註冊
 */
router.post('/register', (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'email、password、name 為必填欄位'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'Email 格式不正確'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '密碼至少需要 6 個字元'
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({
      data: null,
      error: 'CONFLICT',
      message: 'Email 已被註冊'
    });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, passwordHash, name, 'user');

  const user = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    data: {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
      cart_merge: mergeGuestCartSafely(req, user.id)
    },
    error: null,
    message: '註冊成功'
  });
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: 登入
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: X-Session-Id
 *         required: false
 *         schema:
 *           type: string
 *         description: 訪客購物車識別碼；成功後將該購物車併入會員購物車
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 登入成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         email:
 *                           type: string
 *                         name:
 *                           type: string
 *                         role:
 *                           type: string
 *                     token:
 *                       type: string
 *                     cart_merge:
 *                       type: object
 *                       description: 訪客購物車合併結果；未帶 X-Session-Id 或合併失敗時皆為 0
 *                       properties:
 *                         merged:
 *                           type: integer
 *                         adjusted:
 *                           type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 參數缺失
 *       401:
 *         description: Email 或密碼錯誤
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'email 和 password 為必填欄位'
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({
      data: null,
      error: 'UNAUTHORIZED',
      message: 'Email 或密碼錯誤'
    });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({
      data: null,
      error: 'UNAUTHORIZED',
      message: 'Email 或密碼錯誤'
    });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    data: {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
      cart_merge: mergeGuestCartSafely(req, user.id)
    },
    error: null,
    message: '登入成功'
  });
});

/**
 * @openapi
 * /api/auth/profile:
 *   get:
 *     summary: 取得個人資料
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       401:
 *         description: 未登入或 token 無效
 */
router.get('/profile', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(req.user.userId);

  if (!user) {
    return res.status(404).json({
      data: null,
      error: 'NOT_FOUND',
      message: '使用者不存在'
    });
  }

  res.json({
    data: user,
    error: null,
    message: '成功'
  });
});

module.exports = router;
