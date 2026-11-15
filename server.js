// =============================================================
//  المنبه (Pager) — السيرفر
//  هذا الملف هو "قلب" المشروع:
//   1) يعرض صفحات الموقع (لوحة الكاشير + صفحة العميل)
//   2) يفتح خط اتصال مباشر (Real-time) مع كل جهاز عن طريق Socket.IO
// =============================================================

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

// ---------- 1) إعداد الموقع ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// كل الملفات اللي داخل مجلد public تنعرض مباشرة (HTML / CSS / JS)
app.use(express.static(path.join(__dirname, 'public')));

// الرابط الرئيسي "/" يفتح صفحة العميل (هذا اللي بيكون في الـ QR)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});

// "/cashier" يفتح لوحة الكاشير
app.get('/cashier', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cashier.html'));
});

// ---------- 2) الاتصال المباشر ----------
// كل ما فتح أحد الصفحة، ينفتح له "خط" خاص (socket)
io.on('connection', (socket) => {
  console.log('🔌 جهاز اتصل:', socket.id);

  // [تجربة المرحلة الأولى فقط]
  // الكاشير يضغط "إرسال تجربة" → نرسلها لكل الأجهزة المفتوحة
  // (في المراحل الجاية، كل رسالة بتروح لجوالات طلبها فقط)
  socket.on('test:ping', () => {
    io.emit('test:pong', { at: Date.now() });
  });

  socket.on('disconnect', () => {
    console.log('❌ جهاز قطع الاتصال:', socket.id);
  });
});

// ---------- 3) تشغيل السيرفر ----------
// '0.0.0.0' معناها: اقبل الاتصال من أي جهاز على نفس الشبكة (مثل جوالك)
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n✅ السيرفر شغال!\n');
  console.log(`   من هذا الكمبيوتر:`);
  console.log(`     لوحة الكاشير:  http://localhost:${PORT}/cashier`);
  console.log(`     صفحة العميل:   http://localhost:${PORT}/`);

  const ips = getLocalIPs();
  if (ips.length) {
    console.log(`\n   من الجوال (لازم يكون على نفس الواي فاي):`);
    ips.forEach((ip) => console.log(`     صفحة العميل:   http://${ip}:${PORT}/`));
  }
  console.log('\n   لإيقاف السيرفر: اضغط Ctrl + C\n');
});

// يجيب عنوان الكمبيوتر في الشبكة المحلية (مثل 192.168.1.5)
function getLocalIPs() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}
