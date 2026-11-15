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

  const PATTERN_MS = 1400; // طول الدورة الوحدة (3 بيبات + سكتة)

  // يُستدعى من داخل ضغطة زر — يفك قفل الصوت في المتصفح
  function unlock() {
    // آيفون: نطلب إن الصوت يطلع حتى لو الجوال على الصامت (Safari 17+)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
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
  function beep(startAt, freq, duration, volume = 0.35) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    // نرفع وننزل الصوت بنعومة عشان ما يطلع "طقّة"
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.01);
    gain.gain.setValueAtTime(volume, startAt + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain).connect(ctx.destination);
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

  function start() {
    if (ringing) return;
    ringing = true;

    playPattern();
    loopTimer = setInterval(playPattern, PATTERN_MS);

    if ('vibrate' in navigator) {
      const vib = () => navigator.vibrate([400, 200, 400, 200, 400]);
      vib();
      vibrateTimer = setInterval(vib, PATTERN_MS + 600);
    }
  }

  function stop() {
    ringing = false;
    clearInterval(loopTimer);
    clearInterval(vibrateTimer);
    loopTimer = vibrateTimer = null;
    if ('vibrate' in navigator) navigator.vibrate(0);
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
