// =============================================================
//  قاعدة البيانات — كل شي يخص حفظ الطلبات والترقيم
//  نستخدم SQLite المدمجة في Node (ما تحتاج تثبيت أي شي)
//  البيانات تنحفظ في ملف: data/pager.db
// =============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'pager.db'));

// ---------- إنشاء الجداول (أول مرة بس) ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id  TEXT    NOT NULL UNIQUE,  -- الرقم الداخلي السري (فريد لكل طلب)
    number     INTEGER NOT NULL,         -- الرقم اللي يشوفه العميل (1..الحد)
    status     TEXT    NOT NULL,         -- preparing | ready | done
    created_at INTEGER NOT NULL,         -- وقت الإنشاء (بالمللي ثانية)
    ready_at   INTEGER,                  -- وقت ما صار جاهز
    closed_at  INTEGER                   -- وقت الاستلام
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// القيم الافتراضية للإعدادات
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_number', '50')`).run();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('last_number', '0')`).run();

// ---------- الإعدادات ----------
function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}
function setSetting(key, value) {
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value), key);
}

function getMaxNumber() {
  return Number(getSetting('max_number'));
}

// تغيير الحد (مثلاً من 50 إلى 100)
function setMaxNumber(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 1 || n > 9999) {
    throw new Error('INVALID_MAX');
  }
  // ما نسمح بحد أصغر من أكبر رقم نشط حالياً، عشان ما يتلخبط الترقيم
  const maxActive = db.prepare(
    `SELECT MAX(number) AS m FROM orders WHERE status != 'done'`
  ).get().m || 0;
  if (n < maxActive) {
    const err = new Error('MAX_BELOW_ACTIVE');
    err.maxActive = maxActive;
    throw err;
  }
  setSetting('max_number', n);
  return n;
}

// ---------- الطلبات ----------

// كل الطلبات اللي لسا ما انقفلت (قيد التحضير + جاهز)
function getActiveOrders() {
  return db.prepare(
    `SELECT * FROM orders WHERE status != 'done' ORDER BY created_at ASC`
  ).all().map(toPlain);
}

function getOrderById(publicId) {
  const row = db.prepare('SELECT * FROM orders WHERE public_id = ?').get(publicId);
  return row ? toPlain(row) : null;
}

// إنشاء طلب جديد بالرقم التالي
// القاعدة: 1، 2، 3… وبعد الحد يرجع 1، ويتخطى أي رقم لسا نشط
function createOrder() {
  const max = getMaxNumber();
  const last = Number(getSetting('last_number'));
  const active = new Set(getActiveOrders().map((o) => o.number));

  let number = null;
  for (let i = 1; i <= max; i++) {
    const candidate = ((last + i - 1) % max) + 1; // يلف من الحد إلى 1
    if (!active.has(candidate)) { number = candidate; break; }
  }
  if (number === null) throw new Error('ALL_NUMBERS_BUSY');

  const order = {
    public_id: crypto.randomUUID(), // رقم داخلي سري ما يتكرر أبداً
    number,
    status: 'preparing',
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO orders (public_id, number, status, created_at) VALUES (?, ?, ?, ?)`
  ).run(order.public_id, order.number, order.status, order.created_at);
  setSetting('last_number', number);

  return getOrderById(order.public_id);
}

// تحويل الطلب إلى "جاهز"
function markReady(publicId) {
  const res = db.prepare(
    `UPDATE orders SET status = 'ready', ready_at = ? WHERE public_id = ? AND status = 'preparing'`
  ).run(Date.now(), publicId);
  return res.changes > 0 ? getOrderById(publicId) : null;
}

// "تم الاستلام" — يقفل الطلب
function closeOrder(publicId) {
  const res = db.prepare(
    `UPDATE orders SET status = 'done', closed_at = ? WHERE public_id = ? AND status != 'done'`
  ).run(Date.now(), publicId);
  return res.changes > 0 ? getOrderById(publicId) : null;
}

// نحوّل صف قاعدة البيانات لكائن عادي بأسماء واضحة
function toPlain(row) {
  return {
    id: row.public_id,
    number: row.number,
    status: row.status,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    closedAt: row.closed_at,
  };
}

module.exports = {
  getMaxNumber,
  setMaxNumber,
  getActiveOrders,
  getOrderById,
  createOrder,
  markReady,
  closeOrder,
};
