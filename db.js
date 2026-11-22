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

  -- اشتراكات الإشعارات: كل جوال (عنوان إشعاراته) مربوط بطلب واحد
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint   TEXT PRIMARY KEY,     -- عنوان الإشعارات الخاص بالجوال
    order_id   TEXT NOT NULL,        -- الرقم السري للطلب
    sub_json   TEXT NOT NULL,        -- بيانات الاشتراك كاملة
    lang       TEXT NOT NULL DEFAULT 'ar',
    created_at INTEGER NOT NULL
  );

  -- الأجهزة اللي دخلت لوحة الكاشير بالرمز (نحفظ بصمة "تذكرة الدخول" بس)
  CREATE TABLE IF NOT EXISTS cashier_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`);

// القيم الافتراضية للإعدادات
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_number', '50')`).run();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('last_number', '0')`).run();
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('games_enabled', '1')`).run();

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

// ألعاب الانتظار في صفحة العميل (مشغّلة أو مطفية)
function getGamesEnabled() {
  return getSetting('games_enabled') === '1';
}
function setGamesEnabled(on) {
  setSetting('games_enabled', on ? '1' : '0');
  return !!on;
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

// =============================================================
//  رمز الدخول (PIN) للوحة الكاشير
//  ما نحفظ الرمز نفسه أبداً — نحفظ "بصمة" مشفّرة منه (scrypt + ملح عشوائي)
//  حتى لو أحد شاف ملف قاعدة البيانات ما يقدر يعرف الرمز
// =============================================================

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin); // 4 أرقام بالضبط
}

function isPinSet() {
  return !!getSetting('pin_hash');
}

function setPin(pin) {
  if (!isValidPin(pin)) throw new Error('INVALID_PIN');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?)`)
    .run(`${salt}:${hash}`);
}

function verifyPin(pin) {
  const stored = getSetting('pin_hash');
  if (!stored || typeof pin !== 'string') return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// "تذكرة دخول": بعد ما يدخل الكاشير الرمز صح، نعطي جهازه تذكرة عشوائية
// يحفظها الجهاز، وما يحتاج يدخل الرمز كل مرة
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO cashier_sessions (token_hash, created_at) VALUES (?, ?)')
    .run(sha256(token), Date.now());
  return token;
}

function isValidSession(token) {
  if (typeof token !== 'string' || !token) return false;
  return !!db.prepare('SELECT 1 FROM cashier_sessions WHERE token_hash = ?').get(sha256(token));
}

function deleteSession(token) {
  if (typeof token !== 'string') return;
  db.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').run(sha256(token));
}

// نلغي كل التذاكر (مثلاً لما يتغيّر الرمز) — كل الأجهزة لازم تدخل الرمز الجديد
function deleteAllSessions() {
  db.prepare('DELETE FROM cashier_sessions').run();
}

// نسيت الرمز؟ نمسحه، وأول ما تفتح اللوحة تختار رمز جديد
function resetPin() {
  db.prepare(`DELETE FROM settings WHERE key = 'pin_hash'`).run();
  deleteAllSessions();
}

// =============================================================
//  اشتراكات الإشعارات
// =============================================================

// نحفظ اشتراك الجوال لطلب معيّن (لو نفس الجوال تابع طلب جديد، ينتقل للطلب الجديد)
function savePushSub(orderId, sub, lang) {
  db.prepare(`
    INSERT INTO push_subs (endpoint, order_id, sub_json, lang, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET order_id = excluded.order_id, sub_json = excluded.sub_json, lang = excluded.lang
  `).run(sub.endpoint, orderId, JSON.stringify(sub), lang === 'en' ? 'en' : 'ar', Date.now());
}

function getPushSubs(orderId) {
  return db.prepare('SELECT endpoint, sub_json, lang FROM push_subs WHERE order_id = ?').all(orderId)
    .map((r) => ({ endpoint: r.endpoint, sub: JSON.parse(r.sub_json), lang: r.lang }));
}

function deletePushSub(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

function deletePushSubsForOrder(orderId) {
  db.prepare('DELETE FROM push_subs WHERE order_id = ?').run(orderId);
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
  getGamesEnabled,
  setGamesEnabled,
  getActiveOrders,
  getOrderById,
  createOrder,
  markReady,
  closeOrder,
  isValidPin,
  isPinSet,
  setPin,
  verifyPin,
  createSession,
  isValidSession,
  deleteSession,
  deleteAllSessions,
  resetPin,
  savePushSub,
  getPushSubs,
  deletePushSub,
  deletePushSubsForOrder,
};
