// =============================================================
//  صفحة العميل — الكود اللي يشتغل في جوال العميل
//
//  الفكرة: العميل يكتب رقمه ← السيرفر يربط جواله "بغرفة" طلبه
//  ← أي تحديث على هذا الطلب (جاهز / تم الاستلام) يوصل لجواله فقط.
// =============================================================

const socket = io();
const $ = (id) => document.getElementById(id);

// عناصر الصفحة
const views = { entry: $('viewEntry'), order: $('viewOrder'), done: $('viewDone') };
const statusEl = $('status');
const offlineBar = $('offlineBar');
const numberInput = $('numberInput');
const activateBtn = $('activateBtn');
const entryError = $('entryError');
const orderPanel = $('orderPanel');
const orderNumber = $('orderNumber');
const orderStatusText = $('orderStatusText');
const orderTimer = $('orderTimer');
const receivedBtn = $('receivedBtn');

// الحالة الحالية
let currentOrder = null; // الطلب اللي يتابعه هذا الجوال
let clockOffset = 0;     // الفرق بين ساعة السيرفر وساعة الجوال

// ---------- التنقل بين الشاشات ----------
function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
}

// ---------- الاتصال ----------
socket.on('connect', () => {
  statusEl.classList.add('online');
  offlineBar.classList.add('hidden');

  // لو كنا نتابع طلب وانقطع الاتصال، نرجع نرتبط فيه بالرقم السري
  if (currentOrder && currentOrder.status !== 'done') {
    socket.emit('customer:rejoin', { id: currentOrder.id }, (res) => {
      if (res.ok) applyOrder(res.order, res.serverNow);
    });
  }
});

socket.on('disconnect', () => {
  statusEl.classList.remove('online');
  if (currentOrder) offlineBar.classList.remove('hidden');
});

// تحديث يخص طلبنا نحن فقط (السيرفر ما يرسل لنا غيره)
socket.on('order:update', ({ order, serverNow }) => {
  if (!currentOrder || order.id !== currentOrder.id) return; // حماية إضافية
  applyOrder(order, serverNow);
});

// ---------- 1) تفعيل التنبيه ----------
activateBtn.addEventListener('click', activate);
numberInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });

function activate() {
  const number = numberInput.value.trim();
  if (!number) return showEntryError('اكتب رقم طلبك أول');
  if (!socket.connected) return showEntryError('ما فيه اتصال بالسيرفر، تأكد من الإنترنت');

  activateBtn.disabled = true;
  socket.emit('customer:join', { number }, (res) => {
    activateBtn.disabled = false;
    if (!res.ok) return showEntryError('الرقم غير صحيح');
    entryError.classList.add('hidden');
    applyOrder(res.order, res.serverNow);
  });
}

function showEntryError(msg) {
  entryError.textContent = msg;
  entryError.classList.remove('hidden');
}

// ---------- 2) عرض حالة الطلب ----------
function applyOrder(order, serverNow) {
  clockOffset = serverNow - Date.now();
  currentOrder = order;

  if (order.status === 'done') {
    $('doneNumber').textContent = order.number;
    showView('done');
    return;
  }

  const isReady = order.status === 'ready';
  orderNumber.textContent = order.number;
  orderStatusText.textContent = isReady ? 'طلبك جاهز ✅' : 'طلبك مو جاهز';
  orderPanel.classList.toggle('is-ready', isReady);
  receivedBtn.classList.toggle('btn-received-strong', isReady);
  showView('order');
  updateTimer();
}

// "منذ 03:12" / "جاهز منذ 00:45"
function updateTimer() {
  if (!currentOrder || currentOrder.status === 'done') return;
  const isReady = currentOrder.status === 'ready';
  const since = isReady ? currentOrder.readyAt : currentOrder.createdAt;
  const seconds = Math.max(0, Math.floor((Date.now() + clockOffset - since) / 1000));
  orderTimer.textContent = (isReady ? 'جاهز منذ ' : 'منذ ') + formatDuration(seconds);
}
setInterval(updateTimer, 1000);

function formatDuration(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ---------- 3) تم الاستلام ----------
receivedBtn.addEventListener('click', () => {
  if (!currentOrder) return;
  if (!confirm('متأكد إنك استلمت طلبك؟')) return;
  receivedBtn.disabled = true;
  socket.emit('order:close', { id: currentOrder.id }, () => {
    receivedBtn.disabled = false;
    // السيرفر بيرسل order:update بحالة "done" وتنعرض رسالة الشكر
  });
});

// ---------- أزرار الرجوع ----------
$('changeNumberBtn').addEventListener('click', resetToEntry);
$('newOrderBtn').addEventListener('click', resetToEntry);

function resetToEntry() {
  currentOrder = null;
  numberInput.value = '';
  entryError.classList.add('hidden');
  showView('entry');
  numberInput.focus();
}
