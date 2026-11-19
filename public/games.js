// =============================================================
//  ألعاب الانتظار
//  6 ألعاب خفيفة بدون صوت، في 3 فئات:
//   😌 رايقة: فقاعات، ذاكرة      🧠 ذكاء: رتّب الأرقام، تسلسل
//   ⚡ سريعة: التقط، كدّس
//
//  - تنفتح فوق صفحة العميل وهو ينتظر
//  - تنقفل فوراً لما يجهز الطلب (customer.js يستدعي Games.close)
//  - أفضل نتيجة لكل لعبة تنحفظ في الجوال
//  - الألوان تجي من ملف التصميم (متغيرات --g-*)
// =============================================================

const Games = (() => {
  const $ = (sel) => overlay.querySelector(sel);
  const overlay = document.getElementById('gamesOverlay');
  const menuView = $('.games-menu');
  const playView = $('.games-play');
  const stage = $('.game-stage');
  const titleEl = $('.game-title');
  const scoreEl = $('.game-score');
  const bestEl = $('.game-best');
  const resultEl = $('.game-result');

  const games = [];      // كل الألعاب المسجّلة
  let current = null;    // اللعبة الشغالة { def, inst }

  // ---------- أدوات مشتركة ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function colors() {
    const cs = getComputedStyle(overlay);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      bg: v('--g-bg'), fg: v('--g-fg'), muted: v('--g-muted'),
      accent: v('--g-accent'), hot: v('--g-hot'),
      list: [v('--g-c1'), v('--g-c2'), v('--g-c3'), v('--g-c4')],
    };
  }

  const bestStore = {
    get(id) { try { return JSON.parse(localStorage.getItem('pager.best.' + id)); } catch { return null; } },
    set(id, v) { try { localStorage.setItem('pager.best.' + id, JSON.stringify(v)); } catch {} },
  };
  const isBetter = (def, score, best) =>
    best == null || (def.lowerIsBetter ? score < best : score > best);

  // لوحة رسم بحجم المساحة المتاحة (وحادة على شاشات الجوال)
  function makeCanvas(host) {
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    host.appendChild(canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = host.clientWidth;
    const h = host.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx, w, h };
  }

  // حلقة الحركة: تتوقف لما تختفي الصفحة (توفير بطارية)
  function loop(step) {
    let id = 0, last = performance.now(), paused = false;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!paused) step(dt);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return {
      stop() { cancelAnimationFrame(id); },
      pause(p) { paused = p; last = performance.now(); },
    };
  }

  // مكان اللمسة داخل اللوحة
  function pointerPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- واجهة اللعبة (النتيجة / النهاية) ----------
  function makeApi(def) {
    let lastScore = 0;
    return {
      colors: colors(),
      setScore(value, labelKey = 'score') {
        lastScore = value;
        scoreEl.textContent = `${t(labelKey)}: ${value}`;
      },
      // للألعاب اللي ما لها نهاية (مثل الفقاعات): نحفظ الأفضل عند الخروج
      saveBest(value) {
        if (value > 0 && isBetter(def, value, bestStore.get(def.id))) bestStore.set(def.id, value);
      },
      end(score, { won = false, labelKey = 'score' } = {}) {
        const best = bestStore.get(def.id);
        // صفر في لعبة "الأعلى أفضل" ما يعتبر رقم قياسي
        const newBest = (def.lowerIsBetter || score > 0) && isBetter(def, score, best);
        if (newBest) bestStore.set(def.id, score);
        showResult(def, score, labelKey, won, newBest);
      },
      get lastScore() { return lastScore; },
    };
  }

  function showResult(def, score, labelKey, won, newBest) {
    resultEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'result-card';
    const h = document.createElement('h3');
    h.textContent = won ? t('youWon') : t('gameOver');
    const p = document.createElement('p');
    p.textContent = `${t(labelKey)}: ${score}`;
    box.append(h, p);
    if (newBest) {
      const nb = document.createElement('p');
      nb.className = 'new-best';
      nb.textContent = t('newBest');
      box.append(nb);
    }
    const again = document.createElement('button');
    again.className = 'btn';
    again.textContent = t('playAgain');
    again.addEventListener('click', () => start(def));
    const menu = document.createElement('button');
    menu.className = 'btn btn-secondary';
    menu.textContent = t('otherGames');
    menu.addEventListener('click', showMenu);
    box.append(again, menu);
    resultEl.append(box);
    resultEl.hidden = false;
    renderBest(def);
  }

  function renderBest(def) {
    const best = bestStore.get(def.id);
    bestEl.textContent = best == null ? '' : `${t('best')}: ${best}`;
  }

  // ---------- القائمة ----------
  const CATEGORIES = [
    { id: 'relax', name: 'catRelax', desc: 'catRelaxDesc' },
    { id: 'brain', name: 'catBrain', desc: 'catBrainDesc' },
    { id: 'arcade', name: 'catArcade', desc: 'catArcadeDesc' },
  ];

  function renderMenu() {
    const list = $('.games-list');
    list.innerHTML = '';
    for (const cat of CATEGORIES) {
      const sec = document.createElement('section');
      sec.className = 'game-cat';
      const h = document.createElement('h3');
      h.innerHTML = `<span></span> <small></small>`;
      h.firstElementChild.textContent = t(cat.name);
      h.lastElementChild.textContent = t(cat.desc);
      const row = document.createElement('div');
      row.className = 'game-row';
      for (const def of games.filter((g) => g.cat === cat.id)) {
        const btn = document.createElement('button');
        btn.className = 'game-card';
        btn.dataset.game = def.id;
        const best = bestStore.get(def.id);
        btn.innerHTML = `<span class="g-icon"></span><b></b><span class="g-desc"></span><span class="g-best"></span>`;
        btn.querySelector('.g-icon').textContent = def.icon;
        btn.querySelector('b').textContent = t(def.name);
        btn.querySelector('.g-desc').textContent = t(def.desc);
        btn.querySelector('.g-best').textContent = best == null ? '' : `${t('best')}: ${best}`;
        btn.addEventListener('click', () => start(def));
        row.append(btn);
      }
      sec.append(h, row);
      list.append(sec);
    }
  }

  function stopGame() {
    if (current) {
      current.inst?.destroy?.();
      current = null;
    }
    stage.innerHTML = '';
    resultEl.hidden = true;
  }

  function showMenu() {
    stopGame();
    renderMenu();
    playView.hidden = true;
    menuView.hidden = false;
  }

  function start(def) {
    stopGame();
    menuView.hidden = true;
    playView.hidden = false;
    titleEl.textContent = `${def.icon} ${t(def.name)}`;
    scoreEl.textContent = '';
    renderBest(def);
    // ننتظر إطار عشان المساحة تاخذ حجمها قبل ما نرسم
    requestAnimationFrame(() => {
      const api = makeApi(def);
      current = { def, inst: def.mount(stage, api) };
    });
  }

  function open() {
    overlay.hidden = false;
    document.body.classList.add('games-open');
    showMenu();
  }

  function close() {
    if (overlay.hidden) return;
    stopGame();
    overlay.hidden = true;
    document.body.classList.remove('games-open');
  }

  overlay.querySelectorAll('.games-close').forEach((b) => b.addEventListener('click', close));
  $('.games-back').addEventListener('click', showMenu);

  document.addEventListener('visibilitychange', () => {
    current?.inst?.pause?.(document.hidden);
  });
  document.addEventListener('langchange', () => {
    if (!overlay.hidden && !menuView.hidden) renderMenu();
    if (current) {
      titleEl.textContent = `${current.def.icon} ${t(current.def.name)}`;
      renderBest(current.def);
    }
  });

  // =============================================================
  //  😌 1) فقاعات — بدون نهاية، تفقع على راحتك
  // =============================================================
  games.push({
    id: 'bubbles', cat: 'relax', icon: '🫧', name: 'gBubbles', desc: 'gBubblesDesc',
    mount(host, api) {
      const { canvas, ctx, w, h } = makeCanvas(host);
      const c = api.colors;
      let bubbles = [], pops = [], score = 0, spawnIn = 0, time = 0;
      api.setScore(0, 'popped');

      function spawn() {
        const golden = Math.random() < 0.07;
        const r = golden ? 24 : rand(18, 40);
        bubbles.push({
          x: rand(r, w - r), y: h + r, r, golden,
          vy: rand(35, 75), phase: rand(0, 6.28),
          color: golden ? c.accent : pick(c.list),
        });
      }

      function onDown(e) {
        const p = pointerPos(canvas, e);
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 8) {
            bubbles.splice(i, 1);
            pops.push({ x: b.x, y: b.y, r: b.r, color: b.color, t: 0 });
            score += b.golden ? 5 : 1;
            api.setScore(score, 'popped');
            break;
          }
        }
      }
      canvas.addEventListener('pointerdown', onDown);

      const lp = loop((dt) => {
        time += dt;
        spawnIn -= dt;
        if (spawnIn <= 0 && bubbles.length < 16) { spawn(); spawnIn = rand(0.25, 0.6); }
        ctx.clearRect(0, 0, w, h);
        for (const b of bubbles) {
          b.y -= b.vy * dt;
          b.x += Math.sin(time * 1.5 + b.phase) * 12 * dt;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = b.color;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = b.golden ? 4 : 2.5;
          ctx.strokeStyle = b.color;
          ctx.stroke();
          ctx.beginPath(); // لمعة صغيرة
          ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.18, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,.8)';
          ctx.fill();
          if (b.golden) {
            ctx.fillStyle = c.fg;
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+5', b.x, b.y);
          }
        }
        bubbles = bubbles.filter((b) => b.y > -b.r);
        for (const p of pops) {
          p.t += dt;
          const k = p.t / 0.3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + k * 0.7), 0, Math.PI * 2);
          ctx.globalAlpha = Math.max(0, 1 - k);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        pops = pops.filter((p) => p.t < 0.3);
      });

      return {
        pause: lp.pause,
        destroy() { lp.stop(); canvas.removeEventListener('pointerdown', onDown); api.saveBest(score); },
      };
    },
  });

  // =============================================================
  //  😌 2) ذاكرة — طابق الأزواج بأقل عدد حركات
  // =============================================================
  games.push({
    id: 'memory', cat: 'relax', icon: '🃏', name: 'gMemory', desc: 'gMemoryDesc', lowerIsBetter: true,
    mount(host, api) {
      const faces = ['☕', '🍩', '🧁', '🍪', '🥐', '🍫', '🍓', '🍋'];
      const deck = [...faces, ...faces].sort(() => Math.random() - 0.5);
      let first = null, lock = false, moves = 0, matched = 0;
      const timers = [];
      api.setScore(0, 'moves');

      const grid = document.createElement('div');
      grid.className = 'tile-grid g4';
      deck.forEach((face) => {
        const card = document.createElement('button');
        card.className = 'mem-card';
        card.innerHTML = '<span class="back"></span><span class="front"></span>';
        card.querySelector('.front').textContent = face;
        card.addEventListener('click', () => flip(card, face));
        grid.append(card);
      });
      host.append(grid);

      function flip(card, face) {
        if (lock || card.classList.contains('open')) return;
        card.classList.add('open');
        if (!first) { first = { card, face }; return; }
        moves++;
        api.setScore(moves, 'moves');
        if (first.face === face) {
          first.card.classList.add('done');
          card.classList.add('done');
          first = null;
          if (++matched === faces.length) {
            timers.push(setTimeout(() => api.end(moves, { won: true, labelKey: 'moves' }), 500));
          }
        } else {
          lock = true;
          const a = first.card;
          first = null;
          timers.push(setTimeout(() => { a.classList.remove('open'); card.classList.remove('open'); lock = false; }, 700));
        }
      }
      return { destroy() { timers.forEach(clearTimeout); } };
    },
  });

  // =============================================================
  //  🧠 3) رتّب الأرقام — حرّك المربعات لين تصير 1..8
  // =============================================================
  games.push({
    id: 'slide', cat: 'brain', icon: '🔢', name: 'gSlide', desc: 'gSlideDesc', lowerIsBetter: true,
    mount(host, api) {
      const N = 3;
      let tiles = [1, 2, 3, 4, 5, 6, 7, 8, 0]; // 0 = الفراغ
      let moves = 0;
      let done = false;
      const timers = [];
      const neighbors = (i) => {
        const r = Math.floor(i / N), c = i % N, out = [];
        if (r > 0) out.push(i - N);
        if (r < N - 1) out.push(i + N);
        if (c > 0) out.push(i - 1);
        if (c < N - 1) out.push(i + 1);
        return out;
      };
      // نخربطها بحركات صحيحة، فتكون دائماً قابلة للحل
      let empty = 8, prev = -1;
      for (let k = 0; k < 120; k++) {
        const opts = neighbors(empty).filter((n) => n !== prev);
        const n = pick(opts);
        [tiles[empty], tiles[n]] = [tiles[n], tiles[empty]];
        prev = empty; empty = n;
      }
      if (tiles.join() === '1,2,3,4,5,6,7,8,0') { [tiles[0], tiles[1]] = [tiles[1], tiles[0]]; [tiles[3], tiles[4]] = [tiles[4], tiles[3]]; }
      api.setScore(0, 'moves');

      const grid = document.createElement('div');
      grid.className = 'tile-grid g3';
      host.append(grid);

      function render() {
        grid.innerHTML = '';
        tiles.forEach((v, i) => {
          const b = document.createElement('button');
          b.className = v ? 'slide-tile' : 'slide-tile empty';
          if (v && v === i + 1) b.classList.add('in-place');
          b.textContent = v || '';
          if (v) b.addEventListener('click', () => move(i));
          grid.append(b);
        });
      }
      function move(i) {
        if (done) return;
        const e = tiles.indexOf(0);
        if (!neighbors(i).includes(e)) return;
        [tiles[i], tiles[e]] = [tiles[e], tiles[i]];
        moves++;
        api.setScore(moves, 'moves');
        render();
        if (tiles.join() === '1,2,3,4,5,6,7,8,0') {
          done = true;
          timers.push(setTimeout(() => api.end(moves, { won: true, labelKey: 'moves' }), 400));
        }
      }
      render();
      return { destroy() { timers.forEach(clearTimeout); } };
    },
  });

  // =============================================================
  //  🧠 4) تسلسل — احفظ المربعات اللي تنوّر وأعدها
  // =============================================================
  games.push({
    id: 'sequence', cat: 'brain', icon: '💡', name: 'gSequence', desc: 'gSequenceDesc',
    mount(host, api) {
      const seq = [];
      let input = 0, round = 0, accepting = false, over = false;
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));
      api.setScore(0, 'round');

      const wrap = document.createElement('div');
      wrap.className = 'seq-wrap';
      const status = document.createElement('div');
      status.className = 'seq-status';
      const grid = document.createElement('div');
      grid.className = 'tile-grid g3';
      const cells = [];
      for (let i = 0; i < 9; i++) {
        const b = document.createElement('button');
        b.className = 'seq-tile';
        b.addEventListener('pointerdown', () => press(i));
        cells.push(b);
        grid.append(b);
      }
      wrap.append(status, grid);
      host.append(wrap);

      function light(i, ms, cls = 'lit') {
        cells[i].classList.add(cls);
        later(() => cells[i].classList.remove(cls), ms);
      }

      function nextRound() {
        accepting = false;
        input = 0;
        seq.push(Math.floor(Math.random() * 9));
        status.textContent = t('watch');
        const speed = Math.max(260, 560 - round * 25);
        seq.forEach((cell, k) => later(() => light(cell, speed * 0.7), 500 + k * speed));
        later(() => { accepting = true; status.textContent = t('yourTurn'); }, 500 + seq.length * speed);
      }

      function press(i) {
        if (!accepting || over) return;
        if (i === seq[input]) {
          light(i, 200);
          input++;
          if (input === seq.length) {
            accepting = false;
            round++;
            api.setScore(round, 'round');
            status.textContent = '✓';
            later(nextRound, 700);
          }
        } else {
          over = true;
          accepting = false;
          light(i, 900, 'wrong');
          light(seq[input], 900);
          later(() => api.end(round, { labelKey: 'round' }), 900);
        }
      }

      later(nextRound, 300);
      return { destroy() { timers.forEach(clearTimeout); } };
    },
  });

  // =============================================================
  //  ⚡ 5) التقط — التقط القهوة وابعد عن الفلفل
  // =============================================================
  games.push({
    id: 'catch', cat: 'arcade', icon: '☕', name: 'gCatch', desc: 'gCatchDesc',
    mount(host, api) {
      const { canvas, ctx, w, h } = makeCanvas(host);
      const c = api.colors;
      const trayW = Math.min(110, w * 0.28), trayY = h - 46;
      let trayX = w / 2, targetX = w / 2;
      let items = [], spawnIn = 0.6, score = 0, lives = 3, time = 0, over = false, hurt = 0;
      api.setScore(0);

      const onMove = (e) => { targetX = pointerPos(canvas, e).x; };
      canvas.addEventListener('pointerdown', onMove);
      canvas.addEventListener('pointermove', onMove);

      function lose() {
        lives--;
        hurt = 0.3;
        if (lives <= 0 && !over) {
          over = true;
          lp.stop();
          setTimeout(() => api.end(score), 300);
        }
      }

      const lp = loop((dt) => {
        time += dt;
        const speedUp = 1 + time / 40;
        spawnIn -= dt;
        if (spawnIn <= 0) {
          const bad = Math.random() < Math.min(0.45, 0.2 + time / 120);
          items.push({ x: rand(20, w - 20), y: -20, bad, vy: rand(120, 170) * speedUp, rot: rand(-1, 1) });
          spawnIn = Math.max(0.35, 0.9 - time / 60);
        }
        trayX += (targetX - trayX) * Math.min(1, dt * 14);
        trayX = Math.max(trayW / 2, Math.min(w - trayW / 2, trayX));

        ctx.clearRect(0, 0, w, h);
        if (hurt > 0) { hurt -= dt; ctx.fillStyle = c.hot; ctx.globalAlpha = 0.15; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }

        ctx.font = '30px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const it of items) {
          it.y += it.vy * dt;
          ctx.fillText(it.bad ? '🌶️' : '☕', it.x, it.y);
          const inTray = it.y >= trayY - 14 && it.y <= trayY + 10 && Math.abs(it.x - trayX) < trayW / 2 + 12;
          if (inTray) {
            it.gone = true;
            if (it.bad) lose(); else { score++; api.setScore(score); }
          } else if (it.y > h + 20) {
            it.gone = true;
            if (!it.bad) lose(); // طاحت القهوة!
          }
        }
        items = items.filter((it) => !it.gone);

        // الصينية
        ctx.fillStyle = c.accent;
        ctx.strokeStyle = c.fg;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(trayX - trayW / 2, trayY, trayW, 14, 7);
        else ctx.rect(trayX - trayW / 2, trayY, trayW, 14); // جوالات قديمة
        ctx.fill();
        ctx.stroke();

        // القلوب
        ctx.font = '18px serif';
        ctx.textAlign = 'left';
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = i < lives ? 1 : 0.2;
          ctx.fillText('❤️', 10 + i * 24, 18);
        }
        ctx.globalAlpha = 1;
      });

      return {
        pause: lp.pause,
        destroy() {
          lp.stop();
          canvas.removeEventListener('pointerdown', onMove);
          canvas.removeEventListener('pointermove', onMove);
        },
      };
    },
  });

  // =============================================================
  //  ⚡ 6) كدّس — نزّل القطعة فوق اللي تحتها، واللي يطلع برا ينقص
  // =============================================================
  games.push({
    id: 'stack', cat: 'arcade', icon: '🧱', name: 'gStack', desc: 'gStackDesc',
    mount(host, api) {
      const { canvas, ctx, w, h } = makeCanvas(host);
      const c = api.colors;
      const BH = 26;                         // ارتفاع القطعة
      const baseW = Math.min(w * 0.6, 240);
      let stack = [{ x: (w - baseW) / 2, w: baseW }];
      let mover = null, falling = [], camY = 0, score = 0, over = false;
      api.setScore(0);

      function newMover() {
        const top = stack[stack.length - 1];
        const fromLeft = stack.length % 2 === 0;
        // تبدأ من طرف الشاشة (داخلها) عشان أول ضغطة ما تكون خسارة مضمونة
        mover = { x: fromLeft ? 0 : w - top.w, w: top.w, dir: fromLeft ? 1 : -1, speed: 150 + score * 9 };
      }
      newMover();

      function drop() {
        if (over) return;
        const top = stack[stack.length - 1];
        let x = mover.x, wid = mover.w;
        if (Math.abs(x - top.x) < 5) x = top.x; // نزلة مثالية: ما ينقص شي
        const left = Math.max(x, top.x);
        const right = Math.min(x + wid, top.x + top.w);
        const overlap = right - left;
        if (overlap <= 0) {
          over = true;
          falling.push({ x, w: wid, y: stack.length, vy: 0 });
          mover = null;
          setTimeout(() => api.end(score), 700);
          return;
        }
        // الجزء اللي طلع برا يطيح
        if (x < left) falling.push({ x, w: left - x, y: stack.length, vy: 0 });
        if (x + wid > right) falling.push({ x: right, w: x + wid - right, y: stack.length, vy: 0 });
        stack.push({ x: left, w: overlap });
        score++;
        api.setScore(score);
        newMover();
      }
      canvas.addEventListener('pointerdown', drop);

      // y من تحت: الطبقة رقم n
      const screenY = (n) => h - 40 - (n + 1) * BH + camY;

      const lp = loop((dt) => {
        if (mover) {
          mover.x += mover.dir * mover.speed * dt;
          if (mover.x + mover.w >= w) { mover.x = w - mover.w; mover.dir = -1; }
          if (mover.x <= 0) { mover.x = 0; mover.dir = 1; }
        }
        const targetCam = Math.max(0, (stack.length + 1) * BH - h * 0.55);
        camY += (targetCam - camY) * Math.min(1, dt * 6);

        ctx.clearRect(0, 0, w, h);
        const draw = (b, n, color) => {
          ctx.fillStyle = color;
          ctx.strokeStyle = c.fg;
          ctx.lineWidth = 2;
          ctx.fillRect(b.x, screenY(n), b.w, BH - 2);
          ctx.strokeRect(b.x, screenY(n), b.w, BH - 2);
        };
        stack.forEach((b, n) => draw(b, n, n === 0 ? c.fg : c.list[n % c.list.length]));
        if (mover) draw(mover, stack.length, c.accent);
        for (const f of falling) {
          f.vy += 900 * dt;
          f.y -= (f.vy * dt) / BH;
          draw(f, f.y, c.muted);
        }
        falling = falling.filter((f) => screenY(f.y) < h + 50);
      });

      return {
        pause: lp.pause,
        destroy() { lp.stop(); canvas.removeEventListener('pointerdown', drop); },
      };
    },
  });

  return { open, close, isOpen: () => !overlay.hidden };
})();
