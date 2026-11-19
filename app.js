/* OcheCam app: game flow, camera, calibration, auto detection, manual input. */
(() => {
  'use strict';
  const C = window.Core;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // ---------------- Storage ----------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ochecam.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ochecam.' + k, JSON.stringify(v)); } catch {} }
  };

  const settings = Object.assign({
    players: ['Spieler 1', 'Spieler 2'], start: 501, out: 'double', legs: 2,
    sens: 55, tipPref: 'auto', voice: true, sfx: true, autoNext: true, wake: true, camId: ''
  }, store.get('settings', {}));
  // Players are {name, bot} where bot is a level id from Core.BOT_LEVELS or null.
  settings.players = settings.players.map(p => typeof p === 'string' ? { name: p, bot: null } : p);
  const saveSettings = () => store.set('settings', settings);
  const botLevel = id => C.BOT_LEVELS.find(l => l.id === id) || C.BOT_LEVELS[2];

  // ---------------- Toast / speech ----------------
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
  }
  let deVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices().filter(v => /^de/i.test(v.lang));
    // Prefer natural-sounding voices (online/neural), then any German voice.
    const score = v => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 3 : 0)
      + (/katja|conrad|amala|anna|petra|markus|helena|hedda|stefan|yannick/i.test(v.name) ? 1 : 0) + (v.localService ? 0 : 1);
    deVoice = vs.sort((a, b) => score(b) - score(a))[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  /** Speak one or more phrases in order (replaces anything still being said). */
  function say(...parts) {
    if (!settings.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      for (const text of parts.filter(Boolean)) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'de-DE'; if (deVoice) u.voice = deVoice; u.rate = 1.0; u.pitch = 1.0;
        speechSynthesis.speak(u);
      }
    } catch {}
  }

  // ---------------- Sound effects (synthesised, work offline) ----------------
  const sfx = (() => {
    let ac = null, master = null;
    function ctx() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        ac = new AC(); master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(freq, t0, dur, type = 'sine', vol = 0.5, slideTo) {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(), now = a.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, now + t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, now + t0 + dur);
      g.gain.setValueAtTime(0.0001, now + t0);
      g.gain.exponentialRampToValueAtTime(vol, now + t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      o.connect(g); g.connect(master); o.start(now + t0); o.stop(now + t0 + dur + 0.05);
    }
    function noise(t0, dur, vol = 0.4, hp = 1000) {
      const a = ctx(); if (!a) return;
      const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master); src.start(a.currentTime + t0);
    }
    const on = () => settings.sfx !== false;
    return {
      unlock() { ctx(); },
      // Short "thock" into the board + bright confirmation blip
      hit() { if (!on()) return; noise(0, 0.05, 0.5, 1800); tone(180, 0, 0.09, 'triangle', 0.5, 90); tone(880, 0.03, 0.12, 'sine', 0.25); },
      miss() { if (!on()) return; tone(260, 0, 0.32, 'sawtooth', 0.18, 110); },
      bust() { if (!on()) return; tone(330, 0, 0.22, 'square', 0.16); tone(220, 0.22, 0.4, 'square', 0.16, 150); },
      // Party popper + sparkle arpeggio
      triple20() {
        if (!on()) return;
        noise(0, 0.12, 0.6, 2500); noise(0.08, 0.5, 0.25, 6000);
        [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.05 + i * 0.06, 0.25, 'triangle', 0.28));
        [2637, 3136, 2349, 2794].forEach((f, i) => tone(f, 0.35 + i * 0.07, 0.15, 'sine', 0.12));
      },
      fanfare() {
        if (!on()) return;
        noise(0, 0.15, 0.6, 2000);
        [[523, 0], [659, .12], [784, .24], [1047, .36], [784, .52], [1047, .64]].forEach(([f, t]) => { tone(f, t, .28, 'sawtooth', .14); tone(f * 2, t, .2, 'triangle', .08); });
        noise(0.5, 0.8, 0.22, 5000);
      }
    };
  })();

  // ---------------- Confetti ----------------
  function confetti(amount = 140) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas'); cv.className = 'confetti';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; document.body.appendChild(cv);
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const colors = ['#d8443a', '#2e9b5c', '#e9dcc0', '#f0b54a', '#5ab0f0', '#ffffff'];
    const ps = Array.from({ length: amount }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 60, y: innerHeight * 0.45,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 15 - 5, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, col: colors[(Math.random() * colors.length) | 0]
    }));
    const t0 = performance.now();
    (function frame(t) {
      const el = t - t0; c.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.42; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.globalAlpha = Math.max(0, 1 - el / 2600);
        c.fillStyle = p.col; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); c.restore();
      }
      if (el < 2600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  const spokenDart = d => d.v === 0 ? 'Daneben' : d.n === 25 ? (d.m === 2 ? 'Bull' : 'fünfundzwanzig')
    : (d.m === 3 ? 'Triple ' : d.m === 2 ? 'Doppel ' : '') + d.n;

  // ---------------- Setup screen ----------------
  function renderPlayers() {
    const box = $('#playerList'); box.innerHTML = '';
    settings.players.forEach((pl, i) => {
      const row = document.createElement('div'); row.className = 'prow';
      const inp = document.createElement('input');
      inp.id = 'player' + i; inp.value = pl.name; inp.maxLength = 18; inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Name Spieler ' + (i + 1));
      inp.addEventListener('input', () => { pl.name = inp.value; saveSettings(); });
      row.appendChild(inp);
      if (pl.bot) {
        row.classList.add('isbot');
        const sel = document.createElement('select');
        sel.id = 'botlevel' + i; sel.className = 'botsel'; sel.setAttribute('aria-label', 'Stärke des Bots');
        sel.innerHTML = C.BOT_LEVELS.map(l => `<option value="${l.id}">${l.name} · Ø ${l.avg}</option>`).join('');
        sel.value = pl.bot;
        sel.onchange = () => {
          const oldDefault = 'Bot ' + botLevel(pl.bot).name;
          pl.bot = sel.value;
          if (pl.name === oldDefault) { pl.name = 'Bot ' + botLevel(pl.bot).name; inp.value = pl.name; }
          saveSettings();
        };
        row.appendChild(sel);
      }
      if (settings.players.length > 1) {
        const del = document.createElement('button');
        del.className = 'iconbtn'; del.setAttribute('aria-label', 'Spieler entfernen');
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        del.onclick = () => { settings.players.splice(i, 1); saveSettings(); renderPlayers(); };
        row.appendChild(del);
      }
      box.appendChild(row);
    });
    $('#addPlayer').hidden = $('#addBot').hidden = settings.players.length >= 8;
  }
  $('#addPlayer').onclick = () => {
    const humans = settings.players.filter(p => !p.bot).length;
    settings.players.push({ name: 'Spieler ' + (humans + 1), bot: null }); saveSettings(); renderPlayers();
  };
  $('#addBot').onclick = () => { settings.players.push({ name: 'Bot Liga', bot: 'league' }); saveSettings(); renderPlayers(); };
  $$('.chips').forEach(group => {
    const key = group.dataset.opt;
    const sync = () => group.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(String(settings[key]) === c.dataset.v)));
    group.addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      settings[key] = isNaN(+c.dataset.v) ? c.dataset.v : +c.dataset.v; saveSettings(); sync();
    });
    sync();
  });

  // ---------------- Game model ----------------
  let G = null;            // current game
  let undoStack = [];

  function newGame() {
    const names = settings.players.map((p, i) => (p.name || '').trim() || (p.bot ? 'Bot' : 'Spieler ' + (i + 1)));
    G = {
      start: settings.start, out: settings.out, legsToWin: settings.legs,
      players: names.map((name, i) => ({ name, bot: settings.players[i].bot || null, legs: 0, pts: 0, darts: 0, f9pts: 0, f9darts: 0, high: 0, best: 0, tons: 0 })),
      leg: 1, starter: 0, cur: 0,
      rem: names.map(() => settings.start),
      legDarts: names.map(() => 0),
      visit: [], over: false
    };
    undoStack = [];
    persist();
  }
  const persist = () => store.set('game', G);
  const snapshot = () => { undoStack.push(JSON.stringify(G)); if (undoStack.length > 200) undoStack.shift(); };

  /** Evaluate the current visit: remaining, bust, win, done. */
  function visitState(g = G) {
    let rem = g.rem[g.cur], bust = false, win = false;
    for (let i = 0; i < g.visit.length; i++) {
      const d = g.visit[i];
      const r = rem - d.v;
      const minLeft = g.out === 'single' ? 0 : 2;
      if (r < 0 || (r > 0 && r < minLeft)) { bust = true; break; }
      if (r === 0) {
        if (C.isFinish(d, g.out)) { win = true; rem = 0; }
        else bust = true;
        break;
      }
      rem = r;
    }
    const sum = g.visit.reduce((a, d) => a + d.v, 0);
    return { rem: bust ? g.rem[g.cur] : rem, bust, win, sum, done: bust || win || g.visit.length >= 3 };
  }

  function addDart(d, meta) {
    if (!G || G.over) return;
    const st = visitState();
    if (st.done) { toast('Aufnahme ist voll – „Weiter“ drücken'); return; }
    snapshot();
    G.visit.push(Object.assign({}, d, meta || {}));
    afterChange(true);
  }

  function editDart(i, d) {
    snapshot();
    G.visit[i] = Object.assign({}, d, { manual: true });
    G.visit = G.visit.slice(0, 3);
    afterChange(false);
  }

  function afterChange(announce) {
    const st = visitState();
    if (announce) {
      const last = G.visit[G.visit.length - 1];
      const name = G.players[G.cur].name;
      // Sound for the dart itself
      if (st.bust) sfx.bust();
      else if (last.v === 0) sfx.miss();
      else if (last.n === 20 && last.m === 3) { sfx.triple20(); confetti(st.done && st.sum === 180 ? 260 : 120); }
      else sfx.hit();
      if (st.win) setTimeout(() => { sfx.fanfare(); confetti(260); }, 350);
      // Voice: the dart, then the visit total when the visit is over
      const dartWord = spokenDart(last);
      if (st.bust) say(dartWord, 'Überworfen! Keine Punkte.');
      else if (st.win) say(dartWord, 'Game shot! ' + name + ' gewinnt das Leg.');
      else if (st.done) say(dartWord, st.sum === 180 ? 'Einhundertachtzig!' : st.sum === 0 ? 'Keine Punkte.' : 'Insgesamt ' + st.sum + '.');
      else say(dartWord);
    }
    // Bot darts are virtual: nothing to pull from the board.
    if (st.done && !isBotTurn()) detector.waitForPull();
    persist(); render();
  }

  /** Commit current visit and go to next player (or next leg / end of match). */
  function nextTurn() {
    if (!G || G.over) return;
    snapshot();
    const st = visitState();
    const p = G.players[G.cur];
    // A visit that ends early (Weiter pressed) counts as 3 darts unless the leg was won.
    const darts = st.win ? G.visit.length : 3;
    const scored = st.bust ? 0 : st.sum;
    p.darts += darts; p.pts += scored;
    G.legDarts[G.cur] += darts;
    const thrownBefore = G.legDarts[G.cur] - darts;
    if (thrownBefore < 9) { p.f9pts += scored; p.f9darts += darts; }
    if (scored > p.high) p.high = scored;
    if (scored >= 100) p.tons++;
    G.visit = [];
    if (st.win) {
      p.legs++;
      if (!p.best || G.legDarts[G.cur] < p.best) p.best = G.legDarts[G.cur];
      if (p.legs >= G.legsToWin) { G.over = true; persist(); render(); showMatchOver(G.cur); return; }
      const winner = G.cur;
      G.leg++; G.starter = (G.starter + 1) % G.players.length; G.cur = G.starter;
      G.rem = G.players.map(() => G.start); G.legDarts = G.players.map(() => 0);
      persist(); render();
      showLegWon(winner);
      return;
    }
    G.rem[G.cur] = st.rem;
    G.cur = (G.cur + 1) % G.players.length;
    persist(); render();
    announceTurn();
  }

  function announceTurn() {
    const rem = G.rem[G.cur];
    const co = C.checkout(rem, 3, G.out);
    if (co) say(G.players[G.cur].name + ', du brauchst ' + rem);
  }

  function undo() {
    if (!undoStack.length) { toast('Nichts zum Zurücknehmen'); return; }
    clearTimeout(botTimer);
    G = JSON.parse(undoStack.pop());
    // Skip back over bot throws to the last human action.
    while (undoStack.length && G.players[G.cur].bot) G = JSON.parse(undoStack.pop());
    persist();
    detector.rearm(visitState().done);
    closeModal(); render();
  }

  // ---------------- Dart bot ----------------
  let botTimer = null;
  const isBotTurn = () => !!(G && !G.over && G.players[G.cur].bot);
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!isBotTurn() || $('#game').hidden || !$('#modal').hidden) return;
    const st = visitState();
    if (st.done) { botTimer = setTimeout(() => { if (isBotTurn() && !$('#game').hidden && $('#modal').hidden) nextTurn(); }, 2800); return; }
    botTimer = setTimeout(() => {
      if (!isBotTurn() || !$('#modal').hidden || $('#game').hidden) return;
      const s = visitState();
      if (s.done) return;
      const lvl = botLevel(G.players[G.cur].bot);
      const t = C.botThrow(s.rem, 3 - G.visit.length, G.out, lvl.sigma);
      addDart(t.dart, { bot: true, bp: t.point });
    }, G.visit.length ? 1100 : 1500);
  }

  // ---------------- Rendering ----------------
  const avg = (pts, darts) => darts ? (pts / darts * 3).toFixed(1) : '–';
  function render() {
    if (!G) return;
    const st = visitState();
    // Players
    const strip = $('#strip'); strip.innerHTML = '';
    G.players.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'pcard' + (i === G.cur ? ' active' : '');
      const rem = i === G.cur ? st.rem : G.rem[i];
      const legs = Array.from({ length: G.legsToWin }, (_, k) => `<i class="${k < p.legs ? 'won' : ''}"></i>`).join('');
      card.innerHTML = `<div class="legs" aria-label="${p.legs} Legs">${legs}</div>
        <span class="pname"></span><span class="prem num">${rem}</span>
        <span class="pmeta"><span>Ø ${avg(p.pts, p.darts)}</span><span>${G.legDarts[i]} D</span></span>`;
      card.querySelector('.pname').textContent = p.name;
      if (p.bot) { const tag = document.createElement('span'); tag.className = 'bottag'; tag.textContent = 'Bot ' + botLevel(p.bot).name; card.querySelector('.pmeta').prepend(tag); }
      strip.appendChild(card);
      if (i === G.cur) requestAnimationFrame(() => card.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
    });
    $('#legInfo').textContent = `${G.start} · ${G.out === 'double' ? 'Double Out' : G.out === 'master' ? 'Master Out' : 'Single Out'} · Leg ${G.leg}`;

    // Checkout hint ("tippt")
    const co = $('#checkout');
    const left = 3 - G.visit.length;
    const route = !st.done ? C.checkout(st.rem, left, G.out) : null;
    if (st.bust) { co.className = 'checkout none'; co.textContent = 'Überworfen – Darts ziehen, dann Weiter'; }
    else if (st.win) { co.className = 'checkout'; co.innerHTML = '<span class="k">Game shot</span> Leg gewonnen!'; }
    else if (route) { co.className = 'checkout'; co.innerHTML = '<span class="k">Weg</span> ' + route.map(d => d.label).join(' · '); }
    else if (st.done) { co.className = 'checkout none'; co.textContent = 'Darts ziehen – danach geht es automatisch weiter'; }
    else { co.className = 'checkout none'; co.textContent = st.rem <= 180 && G.out !== 'single' ? 'Kein Finish möglich – stellen' : 'Noch kein Finish-Bereich'; }

    // Visit slots
    const v = $('#visit'); v.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = G.visit[i];
      const b = document.createElement('button');
      b.className = 'slot' + (d ? ' filled' : '') + (d && d.conf != null && d.conf < 0.45 && !d.manual ? ' unsure' : '') + (!d && i === G.visit.length && !st.done ? ' next' : '');
      b.innerHTML = d ? `<span class="l num">${d.label}</span><span class="v">${d.v} Pkt${d.bot ? ' · Bot' : d.auto && !d.manual ? ' · Kamera' : ''}</span>` : `<span class="l num" style="color:var(--muted)">–</span><span class="v">Dart ${i + 1}</span>`;
      b.setAttribute('aria-label', d ? `Dart ${i + 1}: ${d.label}, antippen zum Korrigieren` : `Dart ${i + 1} eintippen`);
      b.onclick = () => openPad(d ? i : G.visit.length);
      v.appendChild(b);
    }
    const sum = document.createElement('div');
    sum.className = 'vsum' + (st.bust ? ' bust' : st.win ? ' win' : '');
    sum.innerHTML = `<b class="num">${st.bust ? 'BUST' : st.sum}</b><small>${st.win ? 'Check!' : 'Aufnahme'}</small>`;
    v.appendChild(sum);

    $('#btnNext').textContent = st.win ? 'Leg!' : 'Weiter';
    const botTurn = isBotTurn();
    ['#btnMiss', '#btnPad', '#btnNext'].forEach(s => { $(s).disabled = botTurn; });
    if (botTurn && stream) setStatus('bot', G.players[G.cur].name + ' wirft …');
    else if (stream && !calibrating && $('#status').dataset.k === 'bot') detector.pulling ? setStatus('pull', 'Darts ziehen') : setStatus('ready', 'Bereit – wirf!');
    drawOverlay();
    scheduleBot();
  }

  // ---------------- Modals ----------------
  function closeModal() { $('#modal').hidden = true; }
  function statsTable() {
    return `<div class="statgrid"><span class="h">Spieler</span><span class="h">Ø</span><span class="h">First 9</span><span class="h">Legs</span>` +
      G.players.map(p => `<span>${escapeHtml(p.name)}</span><span>${avg(p.pts, p.darts)}</span><span>${avg(p.f9pts, p.f9darts)}</span><span>${p.legs}</span>`).join('') + '</div>';
  }
  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function showLegWon(i) {
    const p = G.players[i];
    $('#modalCard').innerHTML = `<span class="label">Leg ${G.leg - 1}</span><h2>${escapeHtml(p.name)}</h2><p class="hint">gewinnt das Leg. Nächstes Leg beginnt ${escapeHtml(G.players[G.cur].name)}.</p>${statsTable()}<button class="primary" id="mOk">Nächstes Leg</button>`;
    $('#modal').hidden = false;
    $('#mOk').onclick = () => { closeModal(); announceTurn(); render(); };
  }
  function showMatchOver(i) {
    const p = G.players[i];
    say('Game shot and the match! ' + p.name);
    $('#modalCard').innerHTML = `<span class="label">Match gewonnen</span><h2>${escapeHtml(p.name)}</h2>${statsTable()}<button class="primary" id="mAgain">Revanche</button><button class="secondary" id="mUndo">Letzten Wurf zurücknehmen</button><button class="secondary" id="mHome">Zum Menü</button>`;
    $('#modal').hidden = false;
    $('#mAgain').onclick = () => { closeModal(); newGame(); render(); announceTurn(); };
    $('#mUndo').onclick = undo;
    $('#mHome').onclick = () => { closeModal(); showSetup(); };
  }

  // ---------------- Manual pad ----------------
  let padIndex = 0, padMod = 0;
  function buildBoardSvg(svg) {
    const NS = 'http://www.w3.org/2000/svg';
    const pt = (r, a) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)];
    const seg = (r1, r2, a1, a2) => {
      const [x1, y1] = pt(r1, a1), [x2, y2] = pt(r2, a1), [x3, y3] = pt(r2, a2), [x4, y4] = pt(r1, a2);
      return `M${x1} ${y1}L${x2} ${y2}A${r2} ${r2} 0 0 1 ${x3} ${y3}L${x4} ${y4}A${r1} ${r1} 0 0 0 ${x1} ${y1}Z`;
    };
    let html = `<circle r="200" fill="#111"/>`;
    C.SEG.forEach((n, i) => {
      const a1 = i * 18 - 9, a2 = a1 + 18, dark = i % 2 === 0;
      const single = dark ? '#1b1b1b' : '#e9dcc0', ring = dark ? '#d8443a' : '#2e9b5c';
      html += `<path d="${seg(C.R.obull, C.R.tIn, a1, a2)}" fill="${single}"/>`;
      html += `<path d="${seg(C.R.tIn, C.R.tOut, a1, a2)}" fill="${ring}"/>`;
      html += `<path d="${seg(C.R.tOut, C.R.dIn, a1, a2)}" fill="${single}"/>`;
      html += `<path d="${seg(C.R.dIn, C.R.dOut, a1, a2)}" fill="${ring}"/>`;
      const [tx, ty] = pt(185, i * 18);
      html += `<text x="${tx}" y="${ty}" fill="#efe8d8" font-size="17" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${n}</text>`;
    });
    html += `<circle r="${C.R.obull}" fill="#2e9b5c"/><circle r="${C.R.bull}" fill="#d8443a"/>`;
    html += `<g id="padMark"></g>`;
    svg.innerHTML = html;
    svg.addEventListener('click', e => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      const q = p.matrixTransform(svg.getScreenCTM().inverse());
      let d = C.scoreAt(q.x, q.y);
      const r = Math.hypot(q.x, q.y);
      if (r > C.R.dOut && r <= 200) { // tap on number ring = single of that number
        let a = (Math.atan2(q.x, -q.y) * 180 / Math.PI + 369) % 360;
        d = C.dart(C.SEG[Math.floor(a / 18) % 20], 1);
      }
      if (padMod && d.n && d.n !== 25) d = C.dart(d.n, padMod);
      if (padMod === 3 && d.n === 25) d = C.dart(25, 2);
      $('#padMark').innerHTML = `<circle cx="${q.x}" cy="${q.y}" r="6" fill="#f0b54a" stroke="#000" stroke-width="2"/>`;
      submitPad(d);
    });
  }
  function openPad(i) {
    if (!G || G.over) return;
    if (isBotTurn()) { toast('Der Bot ist am Zug'); return; }
    const st = visitState();
    if (i >= G.visit.length && st.done) { toast('Aufnahme ist voll – „Weiter“ drücken'); return; }
    padIndex = i; setMod(0);
    $('#padTitle').textContent = i < G.visit.length ? `Dart ${i + 1} korrigieren` : `Dart ${i + 1} eintippen`;
    $('#padMark').innerHTML = '';
    $('#padSheet').hidden = false;
  }
  function setMod(m) { padMod = m; $$('#mods button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.m === m))); }
  $('#mods').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMod(+b.dataset.m); });
  $$('.quick button').forEach(b => b.onclick = () => {
    const q = +b.dataset.q; submitPad(q === 0 ? C.dart(0, 0) : q === 25 ? C.dart(25, 1) : C.dart(25, 2));
  });
  function submitPad(d) {
    setTimeout(() => {
      $('#padSheet').hidden = true;
      if (padIndex < G.visit.length) editDart(padIndex, d);
      else addDart(d, { manual: true });
    }, 140);
  }
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('.scrim').hidden = true);
  $$('.scrim').forEach(s => s.addEventListener('click', e => { if (e.target === s) s.hidden = true; }));

  // ---------------- Buttons ----------------
  $('#btnMiss').onclick = () => addDart(C.dart(0, 0), { manual: true });
  $('#btnPad').onclick = () => openPad(G.visit.length);
  $('#btnUndo').onclick = undo;
  $('#btnNext').onclick = () => {
    // If camera-detected darts are still in the board, the next change is them being pulled.
    const dartsInBoard = G && G.visit.some(d => d.auto);
    nextTurn(); detector.rearm(dartsInBoard, false);
  };
  $('#btnMenu').onclick = () => showSetup();

  // ---------------- Camera ----------------
  const video = $('#video'), overlay = $('#overlay'), stage = $('#stage');
  let stream = null;
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Kamera nicht verfügbar. Seite muss über https:// geöffnet sein.', 4500); return;
    }
    stopCamera();
    const video_c = settings.camId ? { deviceId: { exact: settings.camId } } : { facingMode: { ideal: 'environment' } };
    Object.assign(video_c, { width: { ideal: 1920 }, height: { ideal: 1440 } });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
    } catch (err) {
      if (settings.camId) { settings.camId = ''; saveSettings(); return startCamera(); }
      toast('Kamera-Zugriff verweigert: ' + (err.name || err), 4500); return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    await new Promise(r => video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true }));
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    $('#camEmpty').hidden = true; applyView();
    $('#camToggle').textContent = 'Kamera stoppen';
    fitStage(); listCameras();
    try { const tr = stream.getVideoTracks()[0]; tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch {}
    detector.reset();
    if (!calib) startCalibration(); else setStatus('ready', 'Bereit – wirf!');
    requestWake();
  }
  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.srcObject = null;
    $('#camEmpty').hidden = false; $('#camToggle').textContent = 'Kamera starten';
    setStatus('off', 'Kamera aus');
  }
  async function listCameras() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const sel = $('#camSelect');
      sel.innerHTML = '<option value="">Rückkamera (Standard)</option>' +
        devs.map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || 'Kamera ' + (i + 1))}</option>`).join('');
      sel.value = settings.camId || '';
    } catch {}
  }
  $('#camStart').onclick = startCamera;
  $('#camToggle').onclick = () => { stream ? stopCamera() : startCamera(); $('#setSheet').hidden = true; };
  $('#camSelect').onchange = e => { settings.camId = e.target.value; saveSettings(); startCamera(); };

  function fitStage() {
    // Keep the stage within the available height while keeping the video aspect.
    const wrap = $('#stageWrap');
    const ar = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    const maxW = wrap.clientWidth, maxH = wrap.clientHeight;
    let w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr);
    drawOverlay();
  }
  window.addEventListener('resize', () => setTimeout(fitStage, 60));

  let wakeLock = null;
  async function requestWake() {
    if (!settings.wake || !('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stream) requestWake(); });

  function setStatus(k, text) { const s = $('#status'); s.dataset.k = k; s.querySelector('span').textContent = text; }

  // ---------------- Calibration ----------------
  // Stored as 4 normalized image points [[x,y]...] for 20, 6, 3, 11.
  let needMask = true; // detection mask must be rebuilt (calibration, zoom or size changed)
  let calib = store.get('calib', null);
  let H = null, Hinv = null; // image(norm) -> board(mm), board -> image
  function updateH() {
    if (!calib) { H = Hinv = null; return; }
    H = C.homography(calib, C.CAL_BOARD);
    Hinv = C.homography(C.CAL_BOARD, calib);
    needMask = true;
  }
  updateH();
  let calibrating = false, calDraft = null, drag = null, pan = null;

  // Digital zoom: the visible crop of the camera image. Calibration points stay in full-video
  // coordinates, so zooming or panning never breaks an existing calibration.
  let view = Object.assign({ z: 1, cx: 0.5, cy: 0.5 }, store.get('view', {}));
  function crop() {
    const w = 1 / view.z;
    return { w, x0: Math.min(1 - w, Math.max(0, view.cx - w / 2)), y0: Math.min(1 - w, Math.max(0, view.cy - w / 2)) };
  }
  const v2d = (x, y) => { const c = crop(); return [(x - c.x0) / c.w, (y - c.y0) / c.w]; };
  const d2v = (x, y) => { const c = crop(); return [c.x0 + x * c.w, c.y0 + y * c.w]; };
  function applyView() {
    const c = crop(); view.cx = c.x0 + c.w / 2; view.cy = c.y0 + c.w / 2;
    Object.assign(video.style, { width: view.z * 100 + '%', height: view.z * 100 + '%', left: -c.x0 * view.z * 100 + '%', top: -c.y0 * view.z * 100 + '%' });
    $('#zoom').value = view.z; $('#zoomVal').textContent = view.z.toFixed(1) + '×';
    store.set('view', view); needMask = true; drawOverlay();
  }
  $('#zoom').addEventListener('input', e => { view.z = +e.target.value; applyView(); });
  const defaultCal = () => [[0.5, 0.12], [0.8, 0.5], [0.5, 0.88], [0.2, 0.5]].map(q => d2v(q[0], q[1]));
  function startCalibration() {
    if (!stream) { toast('Erst die Kamera starten'); return; }
    calibrating = true; calDraft = (calib || defaultCal()).map(p => p.slice());
    calib = calDraft; updateH();
    $('#calbar').hidden = false; $('#visit').hidden = true; $('.actions').hidden = true; setStatus('off', 'Kalibrieren');
    requestAnimationFrame(fitStage);
    drawOverlay();
  }
  function finishCalibration() {
    calibrating = false; calib = calDraft; store.set('calib', calib); updateH();
    $('#calbar').hidden = true; $('#visit').hidden = false; $('.actions').hidden = false; detector.reset(); setStatus('ready', 'Bereit – wirf!');
    requestAnimationFrame(fitStage);
    toast('Kalibrierung gespeichert'); drawOverlay();
  }
  $('#btnCal').onclick = () => calibrating ? finishCalibration() : startCalibration();
  $('#calDone').onclick = finishCalibration;
  $('#calReset').onclick = () => { calDraft = defaultCal(); calib = calDraft; updateH(); drawOverlay(); };

  const evPos = e => { const r = overlay.getBoundingClientRect(); return { r, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  overlay.addEventListener('pointerdown', e => {
    if (!calibrating) return;
    const { r, x, y } = evPos(e);
    let best = -1, bd = Infinity;
    calDraft.forEach((p, i) => { const [dx, dy] = v2d(p[0], p[1]); const d = Math.hypot((dx - x) * r.width, (dy - y) * r.height); if (d < bd) { bd = d; best = i; } });
    if (bd <= 70) drag = { i: best, sx: x, sy: y, px: calDraft[best][0], py: calDraft[best][1] };
    else if (view.z > 1.01) pan = { sx: x, sy: y, cx: view.cx, cy: view.cy, w: crop().w };
    else return;
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener('pointermove', e => {
    if (!drag && !pan) return;
    const { x, y } = evPos(e);
    if (pan) { view.cx = pan.cx - (x - pan.sx) * pan.w; view.cy = pan.cy - (y - pan.sy) * pan.w; applyView(); return; }
    // Relative drag (finger does not cover the point) at half speed for precision.
    const w = crop().w;
    calDraft[drag.i] = [drag.px + (x - drag.sx) * 0.5 * w, drag.py + (y - drag.sy) * 0.5 * w];
    calib = calDraft; updateH(); drawOverlay();
  });
  const endDrag = () => { pan = null; if (drag) { drag = null; drawOverlay(); } };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  // ---------------- Overlay drawing ----------------
  let debugView = false;
  $('#btnDebug').onclick = () => { debugView = !debugView; $('#btnDebug').setAttribute('aria-pressed', String(debugView)); drawOverlay(); };
  function drawOverlay() {
    const ctx = overlay.getContext('2d');
    const W = overlay.width, Hh = overlay.height;
    ctx.clearRect(0, 0, W, Hh);
    if (!stream) return;
    const dpr = W / (overlay.clientWidth || 1);
    if (debugView && detector.lastBin) {
      ctx.globalAlpha = 0.65; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(detector.debugCanvas(), 0, 0, W, Hh); ctx.globalAlpha = 1;
    }
    if (Hinv) {
      const toPx = (bx, by) => { const [vx, vy] = C.applyH(Hinv, bx, by); const [u, v] = v2d(vx, vy); return [u * W, v * Hh]; };
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeStyle = calibrating ? 'rgba(240,181,74,.95)' : 'rgba(239,232,216,.38)';
      for (const r of [C.R.bull, C.R.obull, C.R.tIn, C.R.tOut, C.R.dIn, C.R.dOut]) {
        ctx.beginPath();
        for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2; const [x, y] = toPx(r * Math.sin(a), -r * Math.cos(a)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = (i * 18 + 9) * Math.PI / 180;
        const [x1, y1] = toPx(C.R.obull * Math.sin(a), -C.R.obull * Math.cos(a));
        const [x2, y2] = toPx(C.R.dOut * Math.sin(a), -C.R.dOut * Math.cos(a));
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      if (calibrating) {
        ctx.font = `700 ${13 * dpr}px Barlow Condensed, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        C.SEG.forEach((n, i) => { const a = i * 18 * Math.PI / 180; const [x, y] = toPx(190 * Math.sin(a), -190 * Math.cos(a)); ctx.fillStyle = 'rgba(240,181,74,.95)'; ctx.fillText(n, x, y); });
      }
    }
    if (calibrating && calDraft) {
      calDraft.forEach((p, i) => {
        const [dx, dy] = v2d(p[0], p[1]);
        const x = dx * W, y = dy * Hh;
        ctx.beginPath(); ctx.arc(x, y, 14 * dpr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(216,68,58,.35)'; ctx.fill();
        ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 5 * dpr, y); ctx.lineTo(x + 5 * dpr, y); ctx.moveTo(x, y - 5 * dpr); ctx.lineTo(x, y + 5 * dpr); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `800 ${14 * dpr}px Barlow Condensed, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(C.CAL_NUMS[i], x, y - 22 * dpr);
      });
      if (drag) { // magnifier
        const p = calDraft[drag.i];
        const vw = video.videoWidth, vh = video.videoHeight;
        const zoomSrc = 0.08 * vw * crop().w, L = Math.min(W, Hh) * 0.36;
        const lx = v2d(p[0], p[1])[0] < 0.5 ? W - L - 8 * dpr : 8 * dpr, ly = 50 * dpr;
        ctx.save(); ctx.beginPath(); ctx.rect(lx, ly, L, L); ctx.clip();
        ctx.drawImage(video, p[0] * vw - zoomSrc / 2, p[1] * vh - zoomSrc / 2, zoomSrc, zoomSrc, lx, ly, L, L);
        ctx.restore();
        ctx.strokeStyle = '#f0b54a'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(lx, ly, L, L);
        ctx.beginPath(); ctx.moveTo(lx + L / 2, ly + 6 * dpr); ctx.lineTo(lx + L / 2, ly + L - 6 * dpr); ctx.moveTo(lx + 6 * dpr, ly + L / 2); ctx.lineTo(lx + L - 6 * dpr, ly + L / 2); ctx.stroke();
      }
    }
    // Detected darts of the current visit
    if (G && !calibrating) {
      G.visit.forEach((d, i) => {
        let img = d.img;
        if (!img && d.bp && Hinv) img = C.applyH(Hinv, d.bp[0], d.bp[1]);
        if (!img) return;
        const [dx, dy] = v2d(img[0], img[1]);
        const x = dx * W, y = dy * Hh;
        ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = d.bot ? '#5ab0f0' : d.manual ? 'rgba(147,161,152,.8)' : '#f0b54a'; ctx.fill();
        ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.font = `800 ${15 * dpr}px Barlow Condensed, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(`${i + 1}: ${d.label}`, x + 11 * dpr, y);
        ctx.fillStyle = '#fff'; ctx.fillText(`${i + 1}: ${d.label}`, x + 11 * dpr, y);
      });
    }
  }
  // Keep the magnifier live while dragging.
  (function loupeLoop() { if (drag) drawOverlay(); requestAnimationFrame(loupeLoop); })();

  // ---------------- Detector ----------------
  const detector = (() => {
    const proc = $('#proc');
    const pctx = proc.getContext('2d', { willReadFrequently: true });
    let PW = 0, PH = 0, mask = null, maskCount = 0;
    let ref = null, prev = null, stable = 0, pulling = false, bigSince = 0, cooldownUntil = 0;
    let dbgCanvas = null, dbgCtx = null;
    const self = {
      lastBin: null,
      reset() { ref = null; prev = null; stable = 0; bigSince = 0; this.lastBin = null; pulling = G ? visitState().done : false; },
      waitForPull() { pulling = true; if (stream) setStatus('pull', 'Darts ziehen'); },
      get pulling() { return pulling; },
      rearm(done, newRef) { pulling = !!done; stable = 0; if (newRef) ref = null; if (stream && !calibrating && !isBotTurn()) pulling ? setStatus('pull', 'Darts ziehen') : setStatus('ready', 'Bereit – wirf!'); },
      debugCanvas() {
        if (!dbgCanvas) { dbgCanvas = document.createElement('canvas'); }
        if (dbgCanvas.width !== PW) { dbgCanvas.width = PW; dbgCanvas.height = PH; dbgCtx = dbgCanvas.getContext('2d'); }
        const img = dbgCtx.createImageData(PW, PH);
        for (let i = 0; i < PW * PH; i++) {
          const j = i * 4;
          if (self.lastBin && self.lastBin[i]) { img.data[j] = 255; img.data[j + 1] = 60; img.data[j + 2] = 40; img.data[j + 3] = 255; }
          else if (mask && !mask[i]) { img.data[j + 3] = 110; }
        }
        dbgCtx.putImageData(img, 0, 0);
        return dbgCanvas;
      }
    };
    function ensureSize() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) return false;
      const w = 360, h = Math.round(w * vh / vw);
      if (w !== PW || h !== PH) { PW = w; PH = h; proc.width = PW; proc.height = PH; needMask = true; ref = prev = null; }
      if (needMask && H) {
        mask = new Uint8Array(PW * PH); maskCount = 0;
        for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
          const [vx, vy] = d2v((x + 0.5) / PW, (y + 0.5) / PH);
          const [bx, by] = C.applyH(H, vx, vy);
          if (Math.hypot(bx, by) < 182) { mask[y * PW + x] = 1; maskCount++; }
        }
        needMask = false; ref = prev = null;
      }
      return !!mask;
    }
    function params() {
      const s = settings.sens; // 1..100
      return {
        thr: Math.round(52 - s * 0.36),            // per-pixel colour difference
        minArea: Math.round(12 + (100 - s) * 0.55), // pixels at 360px width
        motion: 10,
        maxArea: Math.max(400, maskCount * 0.16)
      };
    }
    function blend(a, b) { for (let i = 0; i < a.length; i++) a[i] = (a[i] * 3 + b[i]) >> 2; }

    function tick(now) {
      if (!stream || calibrating || !H || video.readyState < 2 || !G || G.over || isBotTurn()) return;
      if (!$('#padSheet').hidden || !$('#modal').hidden) return;
      if (!ensureSize()) return;
      const cr = crop(), vw = video.videoWidth, vh = video.videoHeight;
      pctx.drawImage(video, cr.x0 * vw, cr.y0 * vh, cr.w * vw, cr.w * vh, 0, 0, PW, PH);
      const cur = pctx.getImageData(0, 0, PW, PH).data;
      if (!ref) { ref = new Uint8ClampedArray(cur); prev = new Uint8ClampedArray(cur); stable = 0; return; }
      const P = params();
      const m = C.denoise(C.diffMask(cur, prev, mask, PW, PH, P.thr).bin, PW, PH);
      prev = new Uint8ClampedArray(cur);
      if (m.count > P.motion) { stable = 0; if (!pulling) setStatus('motion', 'Bewegung …'); return; }
      stable++;
      if (stable < 4 || now < cooldownUntil) return;
      const ch = C.denoise(C.diffMask(cur, ref, mask, PW, PH, P.thr).bin, PW, PH);
      self.lastBin = ch.bin;
      if (debugView) drawOverlay();
      if (ch.count < P.minArea) {
        bigSince = 0;
        if (stable % 8 === 0) blend(ref, cur); // follow slow light changes
        if (!pulling) setStatus('ready', 'Bereit – wirf!');
        return;
      }
      if (pulling) {
        // Board changed after a finished visit: darts were pulled.
        ref = new Uint8ClampedArray(cur); stable = 0; self.lastBin = null;
        if (settings.autoNext && G && visitState().done) { nextTurn(); toast('Darts gezogen – nächster Spieler'); }
        pulling = G ? visitState().done : false;
        if (!pulling) setStatus('ready', 'Bereit – wirf!');
        return;
      }
      if (ch.count > P.maxArea) {
        if (!bigSince) bigSince = now;
        setStatus('motion', 'Zu viel Veränderung im Bild');
        if (now - bigSince > 2500) { ref = new Uint8ClampedArray(cur); bigSince = 0; toast('Board-Referenz neu aufgenommen'); }
        return;
      }
      bigSince = 0;
      const hit = C.findDart(ch.bin, PW, PH, { minArea: P.minArea, tipPref: settings.tipPref });
      ref = new Uint8ClampedArray(cur); stable = 0; cooldownUntil = now + 350;
      if (!hit) return;
      const [nx, ny] = d2v(hit.x / PW, hit.y / PH);
      const [bx, by] = C.applyH(H, nx, ny);
      const d = C.scoreAt(bx, by);
      setStatus('hit', 'Erkannt: ' + d.label);
      addDart(d, { auto: true, img: [nx, ny], conf: +hit.conf.toFixed(2) });
    }
    let last = 0;
    (function loop(t) {
      if (t - last > 80) { last = t; try { tick(t); } catch (e) { console.error(e); } }
      requestAnimationFrame(loop);
    })(0);
    return self;
  })();

  // ---------------- Settings sheet ----------------
  $('#btnSettings').onclick = () => {
    $('#sens').value = settings.sens; $('#sensVal').textContent = settings.sens;
    $('#tipPref').value = settings.tipPref; $('#voice').checked = settings.voice; $('#sfx').checked = settings.sfx !== false;
    $('#autoNext').checked = settings.autoNext; $('#wake').checked = settings.wake;
    $('#camToggle').textContent = stream ? 'Kamera stoppen' : 'Kamera starten';
    $('#setSheet').hidden = false;
  };
  $('#sens').oninput = e => { settings.sens = +e.target.value; $('#sensVal').textContent = settings.sens; saveSettings(); };
  $('#tipPref').onchange = e => { settings.tipPref = e.target.value; saveSettings(); };
  $('#voice').onchange = e => { settings.voice = e.target.checked; saveSettings(); };
  $('#sfx').onchange = e => { settings.sfx = e.target.checked; saveSettings(); if (settings.sfx) sfx.hit(); };
  $('#autoNext').onchange = e => { settings.autoNext = e.target.checked; saveSettings(); };
  $('#wake').onchange = e => { settings.wake = e.target.checked; saveSettings(); if (settings.wake) requestWake(); else if (wakeLock) wakeLock.release().catch(() => {}); };
  $('#refReset').onclick = () => { detector.reset(); $('#setSheet').hidden = true; toast('Referenz wird neu aufgenommen'); };

  // ---------------- Screens ----------------
  function showSetup() {
    $('#game').hidden = true; $('#setup').hidden = false;
    $('#resumeGame').hidden = !(G && !G.over);
    renderPlayers();
  }
  function showGame() {
    $('#setup').hidden = true; $('#game').hidden = false;
    requestAnimationFrame(fitStage);
    render();
    if (!stream && navigator.mediaDevices && window.isSecureContext) startCamera();
  }
  $('#startGame').onclick = () => {
    if ('speechSynthesis' in window) try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
    sfx.unlock();
    newGame(); showGame(); detector.reset(); say('Game on! ' + G.players[0].name + ', wirf an.');
  };
  $('#resumeGame').onclick = () => { sfx.unlock(); showGame(); detector.reset(); };

  // Boot
  buildBoardSvg($('#padBoard'));
  G = store.get('game', null);
  showSetup();
  if (!window.isSecureContext) toast('Hinweis: Für die Kamera muss die App über https:// laufen.', 5000);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Expose for testing
  window.OcheCam = { addDart: (n, m) => addDart(C.dart(n, m), { manual: true }), nextTurn, get game() { return G; }, visitState };
})();
