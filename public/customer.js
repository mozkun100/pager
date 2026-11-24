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
const stopAlarmBtn = $('stopAlarmBtn');
const reactivateBtn = $('reactivateBtn');
const playBtn = $('playBtn');

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

// =============================================================
//  الإشعارات (توصل حتى لو الجوال مقفل)
// =============================================================
const PushClient = (() => {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window && window.isSecureContext;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let permissionAsk = null;

  if (supported) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // لازم ينادى داخل ضغطة العميل (المتصفح ما يسمح يسأل بدونها)
  function ask() {
    if (supported && Notification.permission === 'default') permissionAsk = Notification.requestPermission();
  }

  const toBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const sameKey = (a, b) => a && a.length === b.length && a.every((v, i) => v === b[i]);

  // نشترك ونربط الاشتراك بالطلب. يرجّع: on | denied | default | unsupported | ios | error
  async function subscribe(orderId) {
    if (!supported) return isIOS && !standalone ? 'ios' : 'unsupported';
    if (permissionAsk) { await permissionAsk.catch(() => {}); permissionAsk = null; }
    if (Notification.permission !== 'granted') return Notification.permission;
    try {
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch('/api/push-key')).json();
      const keyBytes = toBytes(key);
      let sub = await reg.pushManager.getSubscription();
      // لو تغيّرت مفاتيح السيرفر، نجدد الاشتراك
      if (sub && !sameKey(sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey), keyBytes)) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
      const res = await new Promise((done) =>
        socket.emit('push:subscribe', { id: orderId, subscription: sub.toJSON(), lang: I18n.lang }, done));
      return res && res.ok ? 'on' : 'error';
    } catch {
      return 'error';
    }
  }

  return { supported, ask, subscribe };
})();

let pushState = 'unknown';
const orderHint = $('orderHint');
function updatePushHint() {
  if (!orderHint) return;
  const key = { on: 'pushOn', ios: 'pushIos', denied: 'pushOff' }[pushState] || 'keepOpen';
  orderHint.textContent = t(key);
  orderHint.classList.toggle('push-on', pushState === 'on');
}
function syncPush(orderId) {
  PushClient.subscribe(orderId).then((state) => { pushState = state; updatePushHint(); });
}

// ---------- التنقل بين الشاشات ----------
function showView(name) {
  if (name !== 'order') document.body.classList.remove('is-ready');
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
      if (res.order.status !== 'done') syncPush(res.order.id);
    });
  }
});

socket.on('disconnect', () => {
  statusEl.classList.remove('online');
  if (currentOrder) offlineBar.classList.remove('hidden');
});

// إعدادات عامة من الكاشير (مثل تشغيل/إطفاء الألعاب)
let gamesEnabled = true;
socket.on('public:settings', (settings) => {
  gamesEnabled = !!settings.gamesEnabled;
  if (!gamesEnabled) Games.close();
  updatePlayBtn();
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
  if (!number) return showEntryError(t('errEmpty'));
  if (!socket.connected) return showEntryError(t('errOffline'));

  // لازم يكون هنا مباشرة داخل الضغطة — هذا اللي يسمح بالصوت والإشعارات في المتصفح
  Alarm.unlock();
  PushClient.ask();

  activateBtn.disabled = true;
  socket.emit('customer:join', { number }, (res) => {
    activateBtn.disabled = false;
    if (!res.ok) return showEntryError(t('errWrongNumber'));

    entryError.classList.add('hidden');
    store.set('order', { id: res.order.id, number: res.order.number });
    Alarm.testChime();     // رنة قصيرة عشان يتأكد إن الصوت شغال
    Alarm.keepScreenOn();  // منع انطفاء الشاشة (إذا مدعوم)
    applyOrder(res.order, res.serverNow);
    syncPush(res.order.id); // الإشعارات
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

  // الألعاب: لما ينقفل الطلب نقفلها. ولما يجهز، syncAlarm يوقفها بهدوء ويطلّع بطاقة "طلبك جاهز"
  if (order.status === 'done') Games.close();
  updatePlayBtn();

  if (order.status === 'done') {
    $('thanksBody').textContent = t('thanksBody', { number: order.number });
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
  orderStatusText.textContent = t(isReady ? 'isReady' : 'notReady');
  orderPanel.classList.toggle('is-ready', isReady);
  document.body.classList.toggle('is-ready', isReady); // بعض التصاميم تلوّن الشاشة كاملة
  showView('order');
  updateTimer();
  syncAlarm();
}

// زر "العب وأنت تنتظر"
function updatePlayBtn() {
  const show = gamesEnabled && currentOrder && currentOrder.status === 'preparing';
  playBtn.classList.toggle('hidden', !show);
}
playBtn.addEventListener('click', () => Games.open());

// "منذ 03:12" / "جاهز منذ 00:45"
function updateTimer() {
  if (!currentOrder || currentOrder.status === 'done') return;
  const isReady = currentOrder.status === 'ready';
  const since = isReady ? currentOrder.readyAt : currentOrder.createdAt;
  const seconds = Math.max(0, Math.floor((Date.now() + clockOffset - since) / 1000));
  orderTimer.textContent = t(isReady ? 'readySince' : 'since', { time: formatDuration(seconds) });
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
let titleTimer = null;

function syncAlarm() {
  const shouldRing =
    currentOrder &&
    currentOrder.status === 'ready' &&
    store.get('stopped') !== currentOrder.id;

  if (shouldRing && !Alarm.isRinging()) {
    // المرحلة 1 (هادية): اللعبة توقف، وتطلع بطاقة "طلبك جاهز" مع نغمة ناعمة
    Games.freeze();
    showReadyCard();
    stopAlarmBtn.classList.remove('hidden');
    let on = false;
    titleTimer = setInterval(() => {   // عنوان التبويب يومض (يفيد لو الصفحة في تبويب ثاني)
      document.title = (on = !on) ? t('titleReady') : t('appName');
    }, 1000);
    // المرحلة 2 (لو ما تفاعل خلال 5 ثواني): الرنين الكامل + الوميض
    Alarm.start({ onEscalate: () => document.body.classList.add('alerting') });
  } else if (!shouldRing) {
    const wasRinging = Alarm.isRinging();
    Alarm.stop();
    hideReadyCard();
    if (wasRinging) Games.close(); // العميل رايح يستلم، نقفل اللعبة اللي كانت موقّفة
    document.body.classList.remove('alerting');
    stopAlarmBtn.classList.add('hidden');
    clearInterval(titleTimer);
    document.title = t('appName');
  }
}

// "إيقاف التنبيه" — في هذا الجوال فقط، والطلب يبقى مفتوح
function stopAlarm() {
  if (!currentOrder) return;
  store.set('stopped', currentOrder.id);
  syncAlarm();
}
stopAlarmBtn.addEventListener('click', stopAlarm);

// بطاقة "طلبك جاهز"
const readyCard = $('readyCard');
function showReadyCard() {
  $('readyNum').textContent = currentOrder ? currentOrder.number : '';
  readyCard.hidden = false;
}
function hideReadyCard() {
  readyCard.hidden = true;
}
$('readyOkBtn').addEventListener('click', stopAlarm);               // "تمام، جاي" = يوقف التنبيه

// بعد تحديث الصفحة: أي لمسة على الشاشة تفتح الصوت (المتصفح يحتاج لمسة من العميل)
document.addEventListener('pointerdown', () => {
  if (Alarm.isUnlocked()) return;
  Alarm.unlock();
  reactivateBtn.classList.add('hidden');
}, true);

// "تم الاستلام" صار عند الكاشير بس (حماية: ما أحد يقدر يقفل طلب غيره بتخمين رقمه).
// لما يقفل الكاشير الطلب، السيرفر يرسل order:update بحالة "done" وتنعرض رسالة الشكر.

// لما تتغيّر اللغة نعيد كتابة النصوص المتغيّرة (الحالة، العداد، رسالة الشكر)
document.addEventListener('langchange', () => {
  entryError.classList.add('hidden');
  updatePushHint();
  if (currentOrder) applyOrder(currentOrder, Date.now() + clockOffset);
});

// ---------- أزرار الرجوع ----------
$('changeNumberBtn').addEventListener('click', resetToEntry);
$('newOrderBtn').addEventListener('click', resetToEntry);

function resetToEntry() {
  currentOrder = null;
  Games.close();
  updatePlayBtn();
  store.del('order');
  store.del('stopped');
  syncAlarm();
  Alarm.releaseScreen();
  reactivateBtn.classList.add('hidden');
  numberInput.value = '';
  entryError.classList.add('hidden');
  showView('entry');
}
