// =============================================================
//  لوحة الكاشير — الكود اللي يشتغل في المتصفح
//  (النصوص كلها تجي من i18n.js عن طريق الدالة t)
// =============================================================

const socket = io();

// عناصر الصفحة
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const statusText = $('statusText');
const newOrderBtn = $('newOrderBtn');
const lastNumberBox = $('lastNumberBox');
const lastNumber = $('lastNumber');
const newOrderError = $('newOrderError');
const ordersGrid = $('ordersGrid');
const emptyState = $('emptyState');
const activeCount = $('activeCount');
const maxInput = $('maxInput');
const saveMaxBtn = $('saveMaxBtn');
const settingsMsg = $('settingsMsg');
const orderTemplate = $('orderTemplate');

// الحالة الحالية (تجينا من السيرفر)
let orders = [];
let clockOffset = 0; // الفرق بين ساعة السيرفر وساعة هذا الجهاز

// رموز الأخطاء من السيرفر ← مفتاح النص المترجم
const ERROR_KEYS = {
  ALL_NUMBERS_BUSY: 'errAllBusy',
  INVALID_MAX: 'errInvalidMax',
  MAX_BELOW_ACTIVE: 'errMaxBelowActive',
};

// ---------- الاتصال ----------
function renderStatus() {
  statusText.textContent = socket.connected ? t('connected') : t('disconnected');
  statusEl.classList.toggle('online', socket.connected);
}
renderStatus();

socket.on('connect', () => {
  renderStatus();
  newOrderBtn.disabled = false;
  socket.emit('cashier:join'); // نطلب نكون في "غرفة الكاشير"
});

socket.on('disconnect', () => {
  renderStatus();
  newOrderBtn.disabled = true;
});

// السيرفر يرسل الحالة الكاملة كل ما تغيّر شي
socket.on('state', (state) => {
  clockOffset = state.serverNow - Date.now();
  orders = state.orders;
  if (document.activeElement !== maxInput) maxInput.value = state.maxNumber;
  render();
});

// لما تتغيّر اللغة نعيد رسم النصوص المتغيّرة
document.addEventListener('langchange', () => {
  renderStatus();
  render();
  newOrderError.classList.add('hidden');
  settingsMsg.classList.add('hidden');
});

// ---------- الأزرار ----------
newOrderBtn.addEventListener('click', () => {
  newOrderBtn.disabled = true;
  socket.emit('order:create', {}, (res) => {
    newOrderBtn.disabled = false;
    if (res.ok) {
      newOrderError.classList.add('hidden');
      lastNumber.textContent = res.order.number;
      lastNumberBox.classList.remove('hidden');
      // حركة بسيطة عشان يبان إن الرقم تغيّر
      lastNumber.classList.remove('pop');
      void lastNumber.offsetWidth;
      lastNumber.classList.add('pop');
    } else {
      showError(newOrderError, t(ERROR_KEYS[res.error] || 'errGeneric'));
    }
  });
});

saveMaxBtn.addEventListener('click', () => {
  socket.emit('settings:setMax', { max: maxInput.value }, (res) => {
    if (res.ok) {
      settingsMsg.className = 'success';
      settingsMsg.textContent = t('savedMax', { max: res.max });
    } else {
      showError(settingsMsg, t(ERROR_KEYS[res.error] || 'errGeneric', { max: res.maxActive }));
    }
  });
});

function showError(el, msg) {
  el.className = 'error';
  el.textContent = msg;
}

// ---------- رسم قائمة الطلبات ----------
function render() {
  ordersGrid.innerHTML = '';
  activeCount.textContent = orders.length;
  emptyState.classList.toggle('hidden', orders.length > 0);

  for (const order of orders) {
    const card = orderTemplate.content.firstElementChild.cloneNode(true);
    const isReady = order.status === 'ready';

    card.classList.add(isReady ? 'is-ready' : 'is-preparing');
    card.dataset.id = order.id;
    card.querySelector('.order-number').textContent = order.number;
    card.querySelector('.badge').textContent = t(isReady ? 'statusReady' : 'statusPreparing');

    const readyBtn = card.querySelector('.btn-ready');
    const closeBtn = card.querySelector('.btn-close');
    readyBtn.textContent = t('btnReady');
    closeBtn.textContent = t('btnReceived');

    if (isReady) {
      readyBtn.remove(); // ما نحتاج زر "جاهز" لطلب جاهز أصلاً
    } else {
      readyBtn.addEventListener('click', () => {
        readyBtn.disabled = true;
        socket.emit('order:ready', { id: order.id });
      });
    }

    closeBtn.addEventListener('click', () => {
      if (!confirm(t('confirmClose', { number: order.number }))) return;
      closeBtn.disabled = true;
      socket.emit('order:close', { id: order.id });
    });

    ordersGrid.appendChild(card);
  }
  updateTimers();
}

// ---------- العدادات ----------
function updateTimers() {
  const now = Date.now() + clockOffset;
  for (const card of ordersGrid.children) {
    const order = orders.find((o) => o.id === card.dataset.id);
    if (!order) continue;

    const isReady = order.status === 'ready';
    const since = isReady ? order.readyAt : order.createdAt;
    const seconds = Math.max(0, Math.floor((now - since) / 1000));

    card.querySelector('.order-timer').textContent =
      t(isReady ? 'readySince' : 'since', { time: formatDuration(seconds) });

    // تلوين لو طال الانتظار (أكثر من 10 دقايق)
    card.classList.toggle('is-late', seconds >= 600);
  }
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

setInterval(updateTimers, 1000);
