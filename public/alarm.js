// =============================================================
//  التنبيه — الصوت + الاهتزاز + منع انطفاء الشاشة
//
//  الصوت نولّده بالكود (Web Audio API) بدل ملف صوت:
//  رنة بيجر: "بيب-بيب-بيب" ثم سكتة، وتتكرر بدون توقف لين يوقفها العميل.
//
//  ⚠️ قيود المتصفحات:
//   - الصوت ما يشتغل إلا بعد ما يضغط العميل زر (فعّل التنبيه). عشان كذا unlock().
//   - الاهتزاز يشتغل في أندرويد فقط (آيفون ما يدعمه من المتصفح).
//   - منع انطفاء الشاشة (Wake Lock) يحتاج https، فما يشتغل في التجربة المحلية.
// =============================================================

const Alarm = (() => {
  let ctx = null;          // محرك الصوت
  let loopTimer = null;    // مؤقت تكرار الرنة
  let vibrateTimer = null; // مؤقت تكرار الاهتزاز
  let wakeLock = null;
  let ringing = false;
  let master = null;       // التحكم بالصوت العام (عشان نرفعه بالتدريج)
  let gentleTimer = null;  // نغمة المرحلة الهادية
  let escalateTimer = null;

  const PATTERN_MS = 1400; // طول الدورة الوحدة (3 بيبات + سكتة)

  // التنبيه المتدرّج (عشان ما يخرّع العميل):
  //  المرحلة 1: نغمة هادية "دينغ-دونغ" تعلى بالتدريج + اهتزازة وحدة، بدون وميض
  //  المرحلة 2 (لو ما تفاعل): الرنين الكامل المتكرر، والصوت بعد يعلى بالتدريج
  const GENTLE_MS = 5000;  // مدة المرحلة الهادية
  const RAMP_SEC = 3;      // مدة ارتفاع صوت الرنين الكامل

  // يُستدعى من داخل ضغطة زر — يفك قفل الصوت في المتصفح
  function unlock() {
    // آيفون: نطلب إن الصوت يطلع حتى لو الجوال على الصامت (Safari 17+)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();

    // صوت صامت قصير — بعض المتصفحات (خصوصاً آيفون) تحتاجه عشان "تفتح" الصوت
    const buffer = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
    return true;
  }

  function isUnlocked() {
    return !!ctx && ctx.state === 'running';
  }

  // بيبة وحدة
  function beep(startAt, freq, duration, volume = 0.35, type = 'square') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    // نرفع وننزل الصوت بنعومة عشان ما يطلع "طقّة"
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.01);
    gain.gain.setValueAtTime(volume, startAt + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain).connect(master);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  // دورة رنة البيجر: 3 بيبات سريعة
  function playPattern() {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.05;
    beep(t,        2400, 0.12);
    beep(t + 0.20, 2400, 0.12);
    beep(t + 0.40, 2400, 0.12);
  }

  // رنة قصيرة وهادية — نسمّعها للعميل عند التفعيل عشان يتأكد إن الصوت شغال
  function testChime() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    beep(t,        1320, 0.10, 0.2);
    beep(t + 0.14, 1760, 0.14, 0.2);
  }

  // نغمة المرحلة الهادية: "دينغ-دونغ" ناعمة
  function softChime() {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.05;
    beep(t, 880, 0.45, 0.3, 'sine');
    beep(t + 0.45, 660, 0.6, 0.3, 'sine');
  }

  // نغيّر مستوى الصوت العام بالتدريج
  function rampVolume(from, to, sec) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(from, t);
    master.gain.linearRampToValueAtTime(to, t + sec);
  }

  // onEscalate: يُستدعى لما نبدأ المرحلة الثانية (عشان الصفحة تشغّل الوميض)
  function start({ onEscalate } = {}) {
    if (ringing) return;
    ringing = true;

    // المرحلة 1: هادية
    rampVolume(0.2, 0.8, GENTLE_MS / 1000);
    softChime();
    gentleTimer = setInterval(softChime, 2500);
    if ('vibrate' in navigator) navigator.vibrate(250);

    // المرحلة 2: الرنين الكامل
    escalateTimer = setTimeout(() => {
      clearInterval(gentleTimer);
      rampVolume(0.35, 1, RAMP_SEC);
      playPattern();
      loopTimer = setInterval(playPattern, PATTERN_MS);
      if ('vibrate' in navigator) {
        const vib = () => navigator.vibrate([400, 200, 400, 200, 400]);
        vib();
        vibrateTimer = setInterval(vib, PATTERN_MS + 600);
      }
      onEscalate?.();
    }, GENTLE_MS);
  }

  function stop() {
    ringing = false;
    clearInterval(loopTimer);
    clearInterval(vibrateTimer);
    clearInterval(gentleTimer);
    clearTimeout(escalateTimer);
    loopTimer = vibrateTimer = gentleTimer = escalateTimer = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
    if (ctx && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(1, ctx.currentTime); }
  }

  function isRinging() {
    return ringing;
  }

  // ---------- منع انطفاء الشاشة ----------
  function wakeLockSupported() {
    return 'wakeLock' in navigator; // غير متوفر بدون https
  }

  async function keepScreenOn() {
    if (!wakeLockSupported()) return false;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    } catch {
      return false;
    }
  }

  async function releaseScreen() {
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  // لما يرجع العميل للصفحة: نشغّل الصوت من جديد ونطلب منع انطفاء الشاشة مرة ثانية
  // (المتصفح يلغيهم تلقائياً لما تختفي الصفحة)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (wakeLock === null && keepScreenOn.wanted) keepScreenOn();
  });

  return {
    unlock, isUnlocked, testChime, start, stop, isRinging,
    wakeLockSupported,
    keepScreenOn: () => { keepScreenOn.wanted = true; return keepScreenOn(); },
    releaseScreen: () => { keepScreenOn.wanted = false; return releaseScreen(); },
  };
})();
