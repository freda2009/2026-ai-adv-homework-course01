const db = require('../database');

// 將訪客購物車併入會員購物車：同商品數量相加並以庫存為上限，訪客列全數移轉或刪除。
// 訪客列在同一個 transaction 內清空，因此重複登入不會重複累加；失敗時整批回滾。
function mergeGuestCart(sessionId, userId) {
  return db.transaction(() => {
    const guestItems = db.prepare(
      `SELECT ci.id, ci.product_id, ci.quantity, p.stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.session_id = ?
       ORDER BY ci.rowid`
    ).all(sessionId);

    let merged = 0;
    let adjusted = 0;

    for (const item of guestItems) {
      const memberItem = db.prepare(
        'SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?'
      ).get(userId, item.product_id);

      const existing = memberItem ? memberItem.quantity : 0;
      const requested = existing + item.quantity;
      // 以庫存為上限，但不調低會員車原有數量
      const quantity = Math.max(existing, Math.min(requested, item.stock));

      if (quantity < requested) adjusted += 1;
      if (quantity > existing) merged += 1;

      if (memberItem || quantity === 0) {
        if (quantity > existing) {
          db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, memberItem.id);
        }
        db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
      } else {
        db.prepare(
          'UPDATE cart_items SET user_id = ?, session_id = NULL, quantity = ? WHERE id = ?'
        ).run(userId, quantity, item.id);
      }
    }

    return { merged, adjusted };
  })();
}

module.exports = { mergeGuestCart };
