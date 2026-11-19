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
  checkAccess(); // نتأكد إن الجهاز مسموح له يدخل اللوحة
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
  $('gamesToggle').checked = !!state.gamesEnabled;
  render();
});

// لما تتغيّر اللغة نعيد رسم النصوص المتغيّرة
document.addEventListener('langchange', () => {
  renderStatus();
  renderLock();
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
    } else if (res.error === 'UNAUTHORIZED') {
      showLock('login');
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
    } else if (res.error === 'UNAUTHORIZED') {
      showLock('login');
    } else {
      showError(settingsMsg, t(ERROR_KEYS[res.error] || 'errGeneric', { max: res.maxActive }));
    }
  });
});

// تشغيل/إطفاء ألعاب الانتظار (يوصل لجوالات العملاء فوراً)
$('gamesToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  socket.emit('settings:setGames', { enabled }, (res) => {
    const msg = $('gamesMsg');
    if (res.ok) {
      msg.className = 'success';
      msg.textContent = t(res.enabled ? 'gamesOn' : 'gamesOff');
    } else if (res.error === 'UNAUTHORIZED') {
      showLock('login');
    } else {
      e.target.checked = !enabled;
      showError(msg, t('errGeneric'));
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
    card.querySelector('.order-label').textContent = t('orderNo');
    card.querySelector('.order-number').textContent = order.number;
    card.querySelector('.badge').textContent = t(isReady ? 'statusReady' : 'statusPreparing');
    // نفس الحالة كنص تحت خط التثقيب (يستخدمه تصميم التذكرة)
    card.querySelector('.order-timer').dataset.status = t(isReady ? 'statusReady' : 'statusPreparing');

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

    // بدون رسالة تأكيد — عندنا مهلة 5 ثواني للتراجع بدلها
    closeBtn.addEventListener('click', () => {
      closeBtn.disabled = true;
      socket.emit('order:close', { id: order.id });
    });

    // خلال المهلة: نخفي الأزرار ونعرض العد التنازلي + زر التراجع
    if (order.pending) {
      card.classList.add('is-pending');
      card.querySelector('.order-actions').classList.add('hidden');
      const box = card.querySelector('.order-pending');
      box.classList.remove('hidden');

      // شريط يتناقص لين تخلص المهلة (يكمل من مكانه حتى لو انرسمت القائمة من جديد)
      const remaining = Math.max(0, order.pending.until - (Date.now() + clockOffset));
      const bar = box.querySelector('.pending-bar span');
      bar.style.animationDuration = order.pending.total + 'ms';
      bar.style.animationDelay = -(order.pending.total - remaining) + 'ms';

      const undoBtn = box.querySelector('.btn-undo');
      undoBtn.textContent = t('undo');
      undoBtn.addEventListener('click', () => {
        undoBtn.disabled = true;
        socket.emit('order:undo', { id: order.id });
      });
    }

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

    // العد التنازلي للمهلة
    if (order.pending) {
      const left = Math.max(1, Math.ceil((order.pending.until - now) / 1000));
      card.querySelector('.pending-text').textContent =
        t(order.pending.type === 'ready' ? 'pendingReady' : 'pendingClose', { seconds: left });
    }

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

setInterval(updateTimers, 250); // كل ربع ثانية عشان العد التنازلي يكون دقيق

// =============================================================
//  رمز الدخول (PIN)
//  - أول مرة: الكاشير يختار رمز (ويكتبه مرتين للتأكيد)
//  - بعدها: أي جهاز جديد لازم يكتب الرمز مرة وحدة
//  - الجهاز يحفظ "تذكرة دخول" عشان ما يطلب الرمز كل مرة
// =============================================================
const lockView = $('lockView');
const appView = $('appView');
const pinForm = $('pinForm');
const pinInput = $('pinInput');
const pinConfirmInput = $('pinConfirmInput');
const pinError = $('pinError');
const pinSubmit = $('pinSubmit');
const lockedOutMsg = $('lockedOutMsg');

const TOKEN_KEY = 'pager.cashierToken';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const saveToken = (tk) => { try { localStorage.setItem(TOKEN_KEY, tk); } catch {} };
const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} };

let lockMode = null; // 'setup' (أول مرة) أو 'login'

function checkAccess() {
  socket.emit('cashier:status', {}, ({ pinSet }) => {
    if (!pinSet) return showLock('setup');
    const token = getToken();
    if (!token) return showLock('login');
    socket.emit('cashier:join', { token }, (res) => {
      if (res.ok) showApp();
      else { clearToken(); showLock('login'); }
    });
  });
}

function showApp() {
  lockMode = null;
  lockView.classList.add('hidden');
  appView.classList.remove('hidden');
}

function showLock(mode, { lockedOut = false } = {}) {
  lockMode = mode;
  appView.classList.add('hidden');
  lockView.classList.remove('hidden');
  lockedOutMsg.classList.toggle('hidden', !lockedOut);
  pinInput.value = '';
  pinConfirmInput.value = '';
  pinError.classList.add('hidden');
  renderLock();
  pinInput.focus();
}

function renderLock() {
  if (!lockMode) return;
  const setup = lockMode === 'setup';
  $('lockTitle').textContent = t(setup ? 'setupTitle' : 'loginTitle');
  $('lockHint').textContent = t(setup ? 'setupHint' : 'loginHint');
  pinSubmit.textContent = t(setup ? 'savePinAndEnter' : 'enter');
  pinConfirmInput.classList.toggle('hidden', !setup);
  $('forgotPin').classList.toggle('hidden', setup);
}

function showPinError(msg) {
  pinError.textContent = msg;
  pinError.classList.remove('hidden');
}

pinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pin = pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) return showPinError(t('errPinFormat'));

  if (lockMode === 'setup') {
    if (pin !== pinConfirmInput.value.trim()) return showPinError(t('errPinMismatch'));
    socket.emit('cashier:setup', { pin }, handleAuthReply);
  } else {
    socket.emit('cashier:login', { pin }, handleAuthReply);
  }
});

function handleAuthReply(res) {
  if (res.ok) {
    saveToken(res.token);
    showApp();
    return;
  }
  pinInput.value = '';
  if (res.error === 'WRONG_PIN') showPinError(t('errWrongPin'));
  else if (res.error === 'LOCKED') showPinError(t('errLocked', { seconds: res.seconds }));
  else if (res.error === 'INVALID_PIN') showPinError(t('errPinFormat'));
  else if (res.error === 'PIN_ALREADY_SET') showLock('login'); // أحد ثاني اختار الرمز قبلنا
  else showPinError(t('errGeneric'));
}

// الرمز تغيّر من جهاز ثاني ← نطلع ونطلب الرمز الجديد
socket.on('cashier:locked', () => {
  clearToken();
  showLock('login', { lockedOut: true });
});

// زر "قفل": يطلع هذا الجهاز من اللوحة
$('lockBtn').addEventListener('click', () => {
  socket.emit('cashier:logout', {}, () => {});
  clearToken();
  showLock('login');
});

// تغيير الرمز من الإعدادات
const pinChangeMsg = $('pinChangeMsg');
$('changePinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const currentPin = $('currentPinInput').value.trim();
  const newPin = $('newPinInput').value.trim();
  if (!/^\d{4}$/.test(newPin)) return showError(pinChangeMsg, t('errPinFormat'));

  socket.emit('cashier:changePin', { currentPin, newPin }, (res) => {
    if (res.ok) {
      saveToken(res.token);
      $('currentPinInput').value = '';
      $('newPinInput').value = '';
      pinChangeMsg.className = 'success';
      pinChangeMsg.textContent = t('pinChanged');
    } else if (res.error === 'UNAUTHORIZED') {
      showLock('login');
    } else {
      showError(pinChangeMsg, t(res.error === 'WRONG_PIN' ? 'errWrongPin' : 'errPinFormat'));
    }
  });
});
