// Source: guides/13-checkmacvalue.md Node.js section + web_fetch developers.ecpay.com.tw/2862.md, 2890.md 2026-11-04
const crypto = require('crypto');

const isStaging = (process.env.ECPAY_ENV || 'staging') !== 'production';

const AIO_URL = isStaging
  ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
  : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

const QUERY_URL = isStaging
  ? 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
  : 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5';

// ECPay 專用 URL encode：urlencode → toLowerCase → .NET 特殊字元還原
function ecpayUrlEncode(source) {
  let encoded = encodeURIComponent(source)
    .replace(/%20/g, '+')
    .replace(/~/g, '%7e')
    .replace(/'/g, '%27');
  encoded = encoded.toLowerCase();
  const replacements = {
    '%2d': '-', '%5f': '_', '%2e': '.', '%21': '!',
    '%2a': '*', '%28': '(', '%29': ')',
  };
  for (const [old, char] of Object.entries(replacements)) {
    encoded = encoded.split(old).join(char);
  }
  return encoded;
}

function generateCheckMacValue(params, hashKey, hashIv) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([k]) => k !== 'CheckMacValue')
  );
  const sorted = Object.keys(filtered)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const paramStr = sorted.map(k => `${k}=${filtered[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${paramStr}&HashIV=${hashIv}`;
  const encoded = ecpayUrlEncode(raw);
  return crypto.createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase();
}

function verifyCheckMacValue(params, hashKey, hashIv) {
  const received = params.CheckMacValue || '';
  const calculated = generateCheckMacValue(params, hashKey, hashIv);
  const a = Buffer.from(received);
  const b = Buffer.from(calculated);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 產生唯一 MerchantTradeNo：英數、≤20 字
function generateMerchantTradeNo(orderId) {
  const orderPrefix = orderId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const tsHex = Date.now().toString(16).toUpperCase().padStart(13, '0').slice(-8);
  return orderPrefix + tsHex;
}

// ECPay 要求 UTC+8，格式 yyyy/MM/dd HH:mm:ss
function getMerchantTradeDate() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${utc8.getUTCFullYear()}/${pad(utc8.getUTCMonth() + 1)}/${pad(utc8.getUTCDate())} ${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}`;
}

function buildAioParams(order, items, merchantTradeNo) {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

  // 過濾控制字元與 # 符號（ECPay 以 # 作分隔符），限 400 字
  let itemName = items
    .map(i => `${i.product_name.replace(/[\x00-\x1F#]/g, '')} x${i.quantity}`)
    .join('#');
  if (itemName.length > 400) {
    itemName = itemName.slice(0, 397) + '...';
  }

  const params = {
    MerchantID: merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: getMerchantTradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(order.total_amount),
    TradeDesc: '花漾生活購物',
    ItemName: itemName,
    ReturnURL: `${baseUrl}/api/ecpay/notify`,
    ClientBackURL: `${baseUrl}/orders/${order.id}?payment=pending`,
    ChoosePayment: 'ALL',
    EncryptType: '1',
  };

  params.CheckMacValue = generateCheckMacValue(params, hashKey, hashIv);
  return { action: AIO_URL, params };
}

async function queryTradeInfo(merchantTradeNo) {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;

  // TimeStamp 為 Unix 秒，3 分鐘內有效
  const params = {
    MerchantID: merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  };
  params.CheckMacValue = generateCheckMacValue(params, hashKey, hashIv);

  const body = new URLSearchParams(params).toString();
  const response = await fetch(QUERY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`QueryTradeInfo HTTP ${response.status}`);
  }

  const text = await response.text();
  return Object.fromEntries(new URLSearchParams(text));
}

module.exports = {
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
  buildAioParams,
  queryTradeInfo,
  AIO_URL,
  QUERY_URL,
};
