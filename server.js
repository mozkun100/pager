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
  io.to(orderRoom(order.id)).emit('order:update', order);
}

// ---------- 3) الاتصال المباشر ----------
io.on('connection', (socket) => {
  log(`device connected     ${socket.id}`);

  // --- لوحة الكاشير ---
  socket.on('cashier:join', () => {
    socket.join(CASHIER_ROOM);
    socket.emit('state', cashierState());
  });

  // طلب جديد
  socket.on('order:create', (_data, reply) => {
    try {
      const order = db.createOrder();
      log(`order #${order.number} created`);
      broadcastToCashiers();
      reply?.({ ok: true, order });
    } catch (err) {
      reply?.({ ok: false, error: err.message });
    }
  });

  // الطلب جاهز
  socket.on('order:ready', ({ id } = {}, reply) => {
    const order = db.markReady(id);
    if (order) {
      log(`order #${order.number} is READY`);
      broadcastToCashiers();
      notifyOrder(order);
    }
    reply?.({ ok: !!order });
  });

  // تم الاستلام (يقفل الطلب)
  socket.on('order:close', ({ id } = {}, reply) => {
    const order = db.closeOrder(id);
    if (order) {
      log(`order #${order.number} picked up (closed)`);
      broadcastToCashiers();
      notifyOrder(order);
    }
    reply?.({ ok: !!order });
  });

  // تغيير الحد الأعلى للأرقام
  socket.on('settings:setMax', ({ max } = {}, reply) => {
    try {
      const n = db.setMaxNumber(max);
      log(`max number set to ${n}`);
      broadcastToCashiers();
      reply?.({ ok: true, max: n });
    } catch (err) {
      reply?.({ ok: false, error: err.message, maxActive: err.maxActive });
    }
  });

  socket.on('disconnect', () => {
    log(`device disconnected  ${socket.id}`);
  });
});

// ---------- 4) تشغيل السيرفر ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Pager server is running!\n');
  console.log('  On this computer:');
  console.log(`    Cashier:   http://localhost:${PORT}/cashier`);
  console.log(`    Customer:  http://localhost:${PORT}/`);

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
