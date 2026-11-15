// =============================================================
//  اللغات — كل نصوص الموقع بالعربي والإنجليزي في مكان واحد
//
//  طريقة الاستخدام في HTML:
//    <span data-i18n="activate"></span>                 ← النص
//    <input data-i18n-placeholder="numberPlaceholder">  ← النص الباهت داخل الحقل
//  وفي JavaScript:
//    t('readySince', { time: '01:30' })  ← "جاهز منذ 01:30"
//
//  اللغة الافتراضية عربي، والاختيار ينحفظ في الجهاز.
// =============================================================

const TEXTS = {
  ar: {
    // عام
    appName: 'المنبه',
    switchLang: 'English',
    connected: 'متصل',
    disconnected: 'غير متصل — جاري إعادة الاتصال…',

    // لوحة الكاشير
    cashierTitle: 'لوحة الكاشير',
    printQr: '🖨️ طباعة QR',
    newOrder: '+ طلب جديد',
    newNumber: 'الرقم الجديد',
    tellCustomer: 'بلّغ العميل بهذا الرقم',
    activeOrders: 'الطلبات النشطة',
    noActiveOrders: 'ما فيه طلبات نشطة حالياً',
    settings: '⚙️ الإعدادات',
    maxLabel: 'أعلى رقم للطلبات (بعده يرجع الترقيم إلى 1)',
    save: 'حفظ',
    savedMax: 'تم الحفظ ✅ الأرقام الحين من 1 إلى {max}',
    statusPreparing: 'قيد التحضير',
    statusReady: 'جاهز',
    btnReady: 'جاهز',
    btnReceived: 'تم الاستلام',
    since: 'منذ {time}',
    readySince: 'جاهز منذ {time}',
    confirmClose: 'تأكيد استلام الطلب رقم {number}؟',
    errAllBusy: 'كل الأرقام مشغولة! سلّم بعض الطلبات أو ارفع الحد من الإعدادات.',
    errInvalidMax: 'اكتب رقم صحيح بين 1 و 9999.',
    errMaxBelowActive: 'ما يصير الحد أقل من رقم طلب نشط حالياً ({max}).',
    errGeneric: 'صار خطأ، حاول مرة ثانية.',

    // صفحة العميل
    enterNumber: 'اكتب رقم طلبك',
    numberPlaceholder: 'مثلاً 27',
    activate: '🔔 فعّل التنبيه',
    keepOpen: '📱 خلّ الصفحة مفتوحة عشان يوصلك التنبيه',
    reactivate: '🔔 اضغط هنا لإعادة تفعيل التنبيه',
    orderNo: 'طلب رقم',
    notReady: 'طلبك مو جاهز',
    isReady: 'طلبك جاهز ✅',
    stopAlarm: '🔕 إيقاف التنبيه',
    changeNumber: 'رقم غلط؟ غيّر الرقم',
    thanks: 'شكراً لك!',
    thanksBody: 'تم استلام طلبك رقم {number}. بالعافية',
    trackAnother: 'متابعة طلب آخر',
    offline: 'انقطع الاتصال… جاري إعادة الاتصال',
    errEmpty: 'اكتب رقم طلبك أول',
    errOffline: 'ما فيه اتصال بالسيرفر، تأكد من الإنترنت',
    errWrongNumber: 'الرقم غير صحيح',
    confirmReceived: 'متأكد إنك استلمت طلبك؟',
    titleReady: '🔔 طلبك جاهز!',

    // صفحة الـ QR
    qrTitle: 'طباعة رمز QR',
    qrIntro: 'اطبع هذي الورقة وحطها عند الكاشير. العميل يصوّرها بجواله ويفتح صفحة التنبيه.',
    qrPrint: '🖨️ طباعة',
    qrBack: '← رجوع للوحة الكاشير',
    qrLink: 'الرابط داخل الكود:',
    qrChooseLink: 'اختر الرابط المناسب:',
    qrLocalNote: '⚠️ هذا رابط جهازك في الشبكة المحلية، يشتغل بس للي متصلين على نفس الواي فاي. لما ننقل الموقع لاستضافة حقيقية، اطبع الكود من جديد.',
  },

  en: {
    appName: 'Pager',
    switchLang: 'عربي',
    connected: 'Connected',
    disconnected: 'Disconnected — reconnecting…',

    cashierTitle: 'Cashier',
    printQr: '🖨️ Print QR',
    newOrder: '+ New order',
    newNumber: 'New number',
    tellCustomer: 'Tell the customer this number',
    activeOrders: 'Active orders',
    noActiveOrders: 'No active orders',
    settings: '⚙️ Settings',
    maxLabel: 'Highest order number (numbering restarts at 1 after it)',
    save: 'Save',
    savedMax: 'Saved ✅ Numbers now go from 1 to {max}',
    statusPreparing: 'Preparing',
    statusReady: 'Ready',
    btnReady: 'Ready',
    btnReceived: 'Picked up',
    since: 'Waiting {time}',
    readySince: 'Ready for {time}',
    confirmClose: 'Confirm order #{number} was picked up?',
    errAllBusy: 'All numbers are in use! Close some orders or raise the limit in Settings.',
    errInvalidMax: 'Enter a whole number between 1 and 9999.',
    errMaxBelowActive: 'The limit can’t be lower than an active order number ({max}).',
    errGeneric: 'Something went wrong, please try again.',

    enterNumber: 'Enter your order number',
    numberPlaceholder: 'e.g. 27',
    activate: '🔔 Turn on alert',
    keepOpen: '📱 Keep this page open to get the alert',
    reactivate: '🔔 Tap here to turn the alert back on',
    orderNo: 'Order',
    notReady: 'Not ready yet',
    isReady: 'Your order is ready ✅',
    stopAlarm: '🔕 Stop alert',
    changeNumber: 'Wrong number? Change it',
    thanks: 'Thank you!',
    thanksBody: 'Order #{number} has been picked up. Enjoy!',
    trackAnother: 'Track another order',
    offline: 'Connection lost… reconnecting',
    errEmpty: 'Please enter your order number',
    errOffline: 'No connection to the server, check your internet',
    errWrongNumber: 'Invalid order number',
    confirmReceived: 'Did you pick up your order?',
    titleReady: '🔔 Your order is ready!',

    qrTitle: 'Print QR code',
    qrIntro: 'Print this sheet and place it at the counter. Customers scan it to open the alert page.',
    qrPrint: '🖨️ Print',
    qrBack: '← Back to cashier',
    qrLink: 'Link inside the code:',
    qrChooseLink: 'Choose the right link:',
    qrLocalNote: '⚠️ This is your computer’s local network address — it only works for people on the same Wi-Fi. When the site moves to real hosting, print a new code.',
  },
};

const I18n = (() => {
  let lang = 'ar';
  try { lang = localStorage.getItem('pager.lang') === 'en' ? 'en' : 'ar'; } catch {}

  // ترجمة نص، مع تعويض المتغيرات مثل {number}
  function t(key, vars = {}) {
    const text = TEXTS[lang][key] ?? TEXTS.ar[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  }

  // تطبيق اللغة على كل العناصر اللي فيها data-i18n
  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      document.title = t(el.dataset.i18nTitle);
    });
  }

  function toggle() {
    lang = lang === 'ar' ? 'en' : 'ar';
    try { localStorage.setItem('pager.lang', lang); } catch {}
    apply();
    // نبلّغ باقي الكود عشان يعيد رسم النصوص المتغيّرة (العدادات، البطاقات…)
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }

  // أي زر عليه class="lang-btn" يقلب اللغة
  document.addEventListener('click', (e) => {
    if (e.target.closest('.lang-btn')) toggle();
  });

  apply();
  return { t, apply, toggle, get lang() { return lang; } };
})();

const t = I18n.t;
