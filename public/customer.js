// =============================================================
//  صفحة العميل — الكود اللي يشتغل في جوال العميل
//
//  الفكرة: العميل يكتب رقمه ← السيرفر يربط جواله "بغرفة" طلبه
//  ← أي تحديث على هذا الطلب (جاهز / تم الاستلام) يوصل لجواله فقط.
//  لما يجهز الطلب: صوت متكرر + وميض + اهتزاز، لين يضغط "إيقاف التنبيه".
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
const stopAlarmBtn = $('stopAlarmBtn');
const reactivateBtn = $('reactivateBtn');

// الحالة الحالية
let currentOrder = null; // الطلب اللي يتابعه هذا الجوال
let clockOffset = 0;     // الفرق بين ساعة السيرفر وساعة الجوال

// =============================================================
//  الحفظ المحلي (في الجوال نفسه)
//  عشان لو العميل حدّث الصفحة بالغلط، يرجع لنفس طلبه
//  نحفظ "الرقم السري" للطلب، مو الرقم الظاهر
// =============================================================
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem('pager.' + key)); } catch { return null; } },
  set(key, v) { try { localStorage.setItem('pager.' + key, JSON.stringify(v)); } catch {} },
  del(key) { try { localStorage.removeItem('pager.' + key); } catch {} },
};
// store 'order'   = { id, number }  ← الطلب اللي نتابعه
// store 'stopped' = id               ← طلب أوقف العميل تنبيهه (عشان ما يرجع يرن بعد التحديث)

// ---------- التنقل بين الشاشات ----------
function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
}

// =============================================================
//  الاتصال
// =============================================================
socket.on('connect', () => {
  statusEl.classList.add('online');
  offlineBar.classList.add('hidden');

  // نرجع نرتبط بطلبنا (بعد انقطاع الاتصال، أو بعد تحديث الصفحة)
  const saved = currentOrder || store.get('order');
  if (saved && saved.status !== 'done') {
    socket.emit('customer:rejoin', { id: saved.id }, (res) => {
      if (!res.ok) return resetToEntry(); // الطلب ما عاد موجود
      // بعد تحديث الصفحة: لازم ضغطة جديدة عشان المتصفح يسمح بالصوت
      // (ما نحتاجها لو الطلب جاهز والعميل أصلاً أوقف تنبيهه)
      const alreadyStopped = res.order.status === 'ready' && store.get('stopped') === res.order.id;
      if (!Alarm.isUnlocked() && res.order.status !== 'done' && !alreadyStopped) {
        reactivateBtn.classList.remove('hidden');
      }
      applyOrder(res.order, res.serverNow);
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

// =============================================================
//  1) تفعيل التنبيه
// =============================================================
activateBtn.addEventListener('click', activate);
numberInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });

function activate() {
  const number = numberInput.value.trim();
  if (!number) return showEntryError('اكتب رقم طلبك أول');
  if (!socket.connected) return showEntryError('ما فيه اتصال بالسيرفر، تأكد من الإنترنت');

  // لازم يكون هنا مباشرة داخل الضغطة — هذا اللي يسمح بالصوت في المتصفح
  Alarm.unlock();

  activateBtn.disabled = true;
  socket.emit('customer:join', { number }, (res) => {
    activateBtn.disabled = false;
    if (!res.ok) return showEntryError('الرقم غير صحيح');

    entryError.classList.add('hidden');
    store.set('order', { id: res.order.id, number: res.order.number });
    Alarm.testChime();     // رنة قصيرة عشان يتأكد إن الصوت شغال
    Alarm.keepScreenOn();  // منع انطفاء الشاشة (إذا مدعوم)
    applyOrder(res.order, res.serverNow);
  });
}

function showEntryError(msg) {
  entryError.textContent = msg;
  entryError.classList.remove('hidden');
}

// إعادة التفعيل بعد تحديث الصفحة
reactivateBtn.addEventListener('click', () => {
  Alarm.unlock();
  Alarm.keepScreenOn();
  reactivateBtn.classList.add('hidden');
  if (!Alarm.isRinging()) Alarm.testChime();
});

// =============================================================
//  2) عرض حالة الطلب
// =============================================================
function applyOrder(order, serverNow) {
  clockOffset = serverNow - Date.now();
  currentOrder = order;

  if (order.status === 'done') {
    $('doneNumber').textContent = order.number;
    reactivateBtn.classList.add('hidden');
    store.del('order');
    store.del('stopped');
    Alarm.releaseScreen();
    showView('done');
    syncAlarm();
    return;
  }

  const isReady = order.status === 'ready';
  orderNumber.textContent = order.number;
  orderStatusText.textContent = isReady ? 'طلبك جاهز ✅' : 'طلبك مو جاهز';
  orderPanel.classList.toggle('is-ready', isReady);
  receivedBtn.classList.toggle('btn-received-strong', isReady);
  showView('order');
  updateTimer();
  syncAlarm();
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

// =============================================================
//  3) التنبيه: يرن لما يكون الطلب "جاهز"، إلا إذا العميل أوقفه
// =============================================================
const PAGE_TITLE = document.title;
let titleTimer = null;

function syncAlarm() {
  const shouldRing =
    currentOrder &&
    currentOrder.status === 'ready' &&
    store.get('stopped') !== currentOrder.id;

  if (shouldRing && !Alarm.isRinging()) {
    Alarm.start();
    document.body.classList.add('alerting'); // الوميض
    stopAlarmBtn.classList.remove('hidden');
    // عنوان التبويب يومض بعد (يفيد لو الصفحة في تبويب ثاني)
    let on = false;
    titleTimer = setInterval(() => {
      document.title = (on = !on) ? '🔔 طلبك جاهز!' : PAGE_TITLE;
    }, 1000);
  } else if (!shouldRing) {
    Alarm.stop();
    document.body.classList.remove('alerting');
    stopAlarmBtn.classList.add('hidden');
    clearInterval(titleTimer);
    document.title = PAGE_TITLE;
  }
}

// "إيقاف التنبيه" — في هذا الجوال فقط، والطلب يبقى مفتوح
stopAlarmBtn.addEventListener('click', () => {
  if (!currentOrder) return;
  store.set('stopped', currentOrder.id);
  syncAlarm();
});

// =============================================================
//  4) تم الاستلام
// =============================================================
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
  store.del('order');
  store.del('stopped');
  syncAlarm();
  Alarm.releaseScreen();
  reactivateBtn.classList.add('hidden');
  numberInput.value = '';
  entryError.classList.add('hidden');
  showView('entry');
}
