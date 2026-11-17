// =============================================================
//  المنبه (Pager) — السيرفر
//  هذا الملف هو "قلب" المشروع:
//   1) يعرض صفحات الموقع (لوحة الكاشير + صفحة العميل)
//   2) يفتح خط اتصال مباشر (Real-time) مع كل جهاز عن طريق Socket.IO
//   3) يستقبل أوامر الكاشير (طلب جديد / جاهز / تم الاستلام) وينفذها
//
//  ملاحظة: رسائل الشاشة السوداء بالإنجليزي لأن شاشة ويندوز ما تعرض العربي
// =============================================================

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const db = require('./db');

const PORT = process.env.PORT || 3000;

// ---------- 1) إعداد الموقع ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// "/" = صفحة العميل (هذا الرابط اللي بيكون في الـ QR)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});

// "/cashier" = لوحة الكاشير
app.get('/cashier', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cashier.html'));
});

// "/qr" = صفحة طباعة الـ QR
app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// يرجّع رابط صفحة العميل + صورة الـ QR له (SVG)
// - لو حددنا PUBLIC_URL (لما ننقل لاستضافة حقيقية) نستخدمه
// - لو الكاشير فاتح من نفس الكمبيوتر (localhost) نستخدم عنوان الكمبيوتر في الشبكة
//   لأن "localhost" في جوال العميل يعني جوال العميل نفسه، مو كمبيوترك!
// - غير كذا نستخدم نفس الرابط اللي فاتح منه الكاشير
app.set('trust proxy', true);
app.get('/api/qr', async (req, res) => {
  let urls;
  if (process.env.PUBLIC_URL) {
    urls = [process.env.PUBLIC_URL.replace(/\/?$/, '/')];
  } else if (['localhost', '127.0.0.1', '::1'].includes(req.hostname)) {
    urls = getLocalIPs().map((ip) => `http://${ip}:${PORT}/`);
  } else {
    urls = [`${req.protocol}://${req.get('host')}/`];
  }

  const links = await Promise.all(urls.map(async (url) => ({
    url,
    local: isPrivateAddress(new URL(url).hostname),
    svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
  })));
  res.json({ links });
});

// عنوان داخلي (شبكة البيت) ولا عنوان حقيقي على الإنترنت؟
function isPrivateAddress(host) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)/.test(host);
}

// ---------- 2) الغرف (Rooms) ----------
// Socket.IO يسمح نحط الأجهزة في "غرف"، ونرسل رسالة لغرفة معينة بس:
//   'cashier'         ← كل شاشات الكاشير
//   'order:<الرقم السري>' ← جوالات طلب واحد فقط (نستخدمها في المرحلة الثالثة)
// بهذي الطريقة جوال طلب 5 ما يوصله أبداً شي يخص طلب 1.
const CASHIER_ROOM = 'cashier';
const orderRoom = (id) => `order:${id}`;

// الحالة الكاملة اللي تحتاجها لوحة الكاشير
function cashierState() {
  return {
    orders: db.getActiveOrders(),
    maxNumber: db.getMaxNumber(),
    serverNow: Date.now(), // عشان العدادات تكون دقيقة حتى لو ساعة الجهاز مختلفة
  };
}

// نرسل التحديث لكل شاشات الكاشير
function broadcastToCashiers() {
  io.to(CASHIER_ROOM).emit('state', cashierState());
}

// نرسل تحديث طلب معيّن لجوالاته فقط
function notifyOrder(order) {
  io.to(orderRoom(order.id)).emit('order:update', { order, serverNow: Date.now() });
}

// نربط جوال العميل بغرفة طلبه (ونطلعه من أي غرفة طلب قديمة)
function joinOrderRoom(socket, order) {
  for (const room of socket.rooms) {
    if (room.startsWith('order:')) socket.leave(room);
  }
  socket.join(orderRoom(order.id));
}

// ---------- 3) حماية الرمز من التخمين ----------
// 4 أرقام = 10,000 احتمال، فلازم نمنع أحد يجرب الأرقام وحدة وحدة:
//  - بعد 5 محاولات غلط من نفس الجهاز ← يتقفل دقيقة
//  - ولو كثرت المحاولات الغلط من كل الأجهزة (15 بالدقيقة) ← نقفل الدخول 5 دقايق للكل
//    (الأجهزة اللي داخلة أصلاً ما تتأثر)
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
const GLOBAL_MAX_FAILS = 15;
const GLOBAL_LOCK_MS = 5 * 60 * 1000;
const failures = new Map(); // عنوان الجهاز ← { count, lockedUntil }
let globalFails = [];        // أوقات كل المحاولات الغلط
let globalLockedUntil = 0;

function clientAddress(socket) {
  const h = socket.handshake.headers;
  return h['cf-connecting-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || socket.handshake.address;
}

function lockRemaining(addr) {
  const now = Date.now();
  const own = failures.get(addr)?.lockedUntil || 0;
  return Math.max(0, own - now, globalLockedUntil - now);
}

function recordFailure(addr) {
  const now = Date.now();
  const f = failures.get(addr) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) { f.lockedUntil = now + LOCK_MS; f.count = 0; }
  failures.set(addr, f);

  globalFails = globalFails.filter((t) => now - t < 60 * 1000);
  globalFails.push(now);
  if (globalFails.length >= GLOBAL_MAX_FAILS) { globalLockedUntil = now + GLOBAL_LOCK_MS; globalFails = []; }
}

// ---------- 4) الاتصال المباشر ----------
io.on('connection', (socket) => {
  log(`device connected     ${socket.id}`);

  // أوامر الكاشير: ما تشتغل إلا إذا الجهاز داخل بالرمز
  const cashierOnly = (handler) => (data, reply) => {
    if (!socket.data.isCashier) return reply?.({ ok: false, error: 'UNAUTHORIZED' });
    handler(data || {}, reply);
  };

  // نسجّل الجهاز ككاشير ونرسل له الطلبات
  function enterCashier(token) {
    socket.data.isCashier = true;
    socket.data.token = token;
    socket.join(CASHIER_ROOM);
    socket.emit('state', cashierState());
  }

  // --- الدخول للوحة الكاشير ---

  // هل فيه رمز محفوظ؟ (لو لا = أول مرة، الكاشير يختار رمز)
  socket.on('cashier:status', (_data, reply) => {
    reply?.({ pinSet: db.isPinSet() });
  });

  // أول مرة: اختيار الرمز
  socket.on('cashier:setup', ({ pin } = {}, reply) => {
    if (db.isPinSet()) return reply?.({ ok: false, error: 'PIN_ALREADY_SET' });
    if (!db.isValidPin(pin)) return reply?.({ ok: false, error: 'INVALID_PIN' });
    db.setPin(pin);
    const token = db.createSession();
    log('cashier PIN was set');
    enterCashier(token);
    reply?.({ ok: true, token });
  });

  // الدخول بالرمز
  socket.on('cashier:login', ({ pin } = {}, reply) => {
    const addr = clientAddress(socket);
    const wait = lockRemaining(addr);
    if (wait > 0) return reply?.({ ok: false, error: 'LOCKED', seconds: Math.ceil(wait / 1000) });

    if (!db.verifyPin(String(pin ?? ''))) {
      recordFailure(addr);
      log(`wrong cashier PIN from ${addr}`);
      const lockedNow = lockRemaining(addr);
      return reply?.(lockedNow > 0
        ? { ok: false, error: 'LOCKED', seconds: Math.ceil(lockedNow / 1000) }
        : { ok: false, error: 'WRONG_PIN' });
    }
    failures.delete(addr);
    const token = db.createSession();
    log('cashier logged in');
    enterCashier(token);
    reply?.({ ok: true, token });
  });

  // جهاز سبق ودخل: يرسل "تذكرته" بدل الرمز
  socket.on('cashier:join', ({ token } = {}, reply) => {
    if (!db.isValidSession(token)) return reply?.({ ok: false, error: 'UNAUTHORIZED' });
    enterCashier(token);
    reply?.({ ok: true });
  });

  // قفل هذا الجهاز (يطلع من اللوحة)
  socket.on('cashier:logout', (_data, reply) => {
    db.deleteSession(socket.data.token);
    socket.data.isCashier = false;
    socket.leave(CASHIER_ROOM);
    reply?.({ ok: true });
  });

  // تغيير الرمز: لازم الرمز الحالي، وبعدها كل الأجهزة الثانية تطلع وتدخل الرمز الجديد
  socket.on('cashier:changePin', cashierOnly(async ({ currentPin, newPin }, reply) => {
    if (!db.verifyPin(String(currentPin ?? ''))) return reply?.({ ok: false, error: 'WRONG_PIN' });
    if (!db.isValidPin(newPin)) return reply?.({ ok: false, error: 'INVALID_PIN' });
    db.setPin(newPin);
    db.deleteAllSessions();
    const token = db.createSession();
    socket.data.token = token;

    for (const other of await io.in(CASHIER_ROOM).fetchSockets()) {
      if (other.id === socket.id) continue;
      other.data.isCashier = false;
      other.leave(CASHIER_ROOM);
      other.emit('cashier:locked');
    }
    log('cashier PIN was changed (other devices logged out)');
    reply?.({ ok: true, token });
  }));

  // --- صفحة العميل ---

  // العميل كتب رقم طلبه وضغط "فعّل التنبيه"
  // ندوّر على طلب "نشط" بهذا الرقم فقط (المقفلة ما تُقبل)
  socket.on('customer:join', ({ number } = {}, reply) => {
    const n = Math.floor(Number(number));
    const order = db.getActiveOrders().find((o) => o.number === n);
    if (!order) {
      log(`customer tried order #${number} -> not found`);
      return reply?.({ ok: false, error: 'NOT_FOUND' });
    }
    joinOrderRoom(socket, order);
    log(`customer joined order #${order.number}`);
    reply?.({ ok: true, order, serverNow: Date.now() });
  });

  // إعادة الاتصال بعد انقطاع: نرجع بالرقم "السري" مو بالرقم الظاهر
  // عشان لو الرقم 5 انقفل وانعطى لعميل جديد، ما يرتبط الجوال القديم بالطلب الجديد
  socket.on('customer:rejoin', ({ id } = {}, reply) => {
    const order = db.getOrderById(id);
    if (!order) return reply?.({ ok: false, error: 'NOT_FOUND' });
    if (order.status !== 'done') joinOrderRoom(socket, order);
    reply?.({ ok: true, order, serverNow: Date.now() });
  });

  // --- أوامر الطلبات ---

  // طلب جديد (كاشير فقط)
  socket.on('order:create', cashierOnly((_data, reply) => {
    try {
      const order = db.createOrder();
      log(`order #${order.number} created`);
      broadcastToCashiers();
      reply?.({ ok: true, order });
    } catch (err) {
      reply?.({ ok: false, error: err.message });
    }
  }));

  // الطلب جاهز (كاشير فقط)
  socket.on('order:ready', cashierOnly(({ id }, reply) => {
    const order = db.markReady(id);
    if (order) {
      log(`order #${order.number} is READY`);
      broadcastToCashiers();
      notifyOrder(order);
    }
    reply?.({ ok: !!order });
  }));

  // تم الاستلام: الكاشير، أو العميل لطلبه هو فقط
  socket.on('order:close', ({ id } = {}, reply) => {
    const isOwnOrder = typeof id === 'string' && socket.rooms.has(orderRoom(id));
    if (!socket.data.isCashier && !isOwnOrder) return reply?.({ ok: false, error: 'UNAUTHORIZED' });

    const order = db.closeOrder(id);
    if (order) {
      log(`order #${order.number} picked up (closed)`);
      broadcastToCashiers();
      notifyOrder(order);
    }
    reply?.({ ok: !!order });
  });

  // تغيير الحد الأعلى للأرقام (كاشير فقط)
  socket.on('settings:setMax', cashierOnly(({ max }, reply) => {
    try {
      const n = db.setMaxNumber(max);
      log(`max number set to ${n}`);
      broadcastToCashiers();
      reply?.({ ok: true, max: n });
    } catch (err) {
      reply?.({ ok: false, error: err.message, maxActive: err.maxActive });
    }
  }));

  socket.on('disconnect', () => {
    log(`device disconnected  ${socket.id}`);
  });
});

// ---------- 5) تشغيل السيرفر ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Pager server is running!\n');
  console.log('  On this computer:');
  console.log(`    Cashier:   http://localhost:${PORT}/cashier`);
  console.log(`    Customer:  http://localhost:${PORT}/`);
  console.log(`    Print QR:  http://localhost:${PORT}/qr`);

  const ips = getLocalIPs();
  if (ips.length) {
    console.log('\n  From your phone (same Wi-Fi):');
    ips.forEach((ip) => console.log(`    Customer:  http://${ip}:${PORT}/`));
  }
  console.log('\n  To stop the server: press Ctrl + C\n');
});

// عنوان الكمبيوتر في الشبكة المحلية (مثل 192.168.8.11)
function getLocalIPs() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}

function log(msg) {
  const t = new Date().toLocaleTimeString('en-GB');
  console.log(`  [${t}] ${msg}`);
}
