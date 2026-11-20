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
    sens: 55, tipPref: 'auto', voice: true, sfx: true, autoNext: true, wake: true, camId: '', banter: true,
    bullOff: 1, autoCal: true
  }, store.get('settings', {}));
  // Players are {name, bot} where bot is a level id from Core.BOT_LEVELS or null.
  settings.players = settings.players.map(p => typeof p === 'string' ? { name: p, bot: null } : p);
  // What the detector has learned from corrections (thr offset, min-area factor, min elongation).
  const LEARN0 = { thr: 0, area: 1, elong: 1.5, n: 0 };
  settings.learn = Object.assign({}, LEARN0, settings.learn || {});
  const saveSettings = () => store.set('settings', settings);
  const botLevel = id => C.BOT_LEVELS.find(l => l.id === id) || C.BOT_LEVELS[2];

  // ---------------- Toast / speech ----------------
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
  }
  let deVoice = null;
  // Voices that sound natural (neural/online/premium) are preferred; the viewer can pick any German voice.
  const voiceQuality = v => (/natural|neural|online|premium|enhanced|wavenet|studio/i.test(v.name) ? 6 : 0)
    + (/google/i.test(v.name) ? 3 : 0) + (v.localService === false ? 1 : 0)
    + (/katja|conrad|amala|seraphina|florian|anna|petra|markus|helena|hedda|stefan|yannick|viktoria/i.test(v.name) ? 1 : 0)
    - (/compact|eloquence|espeak/i.test(v.name) ? 4 : 0);
  function germanVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter(v => /^de/i.test(v.lang)).sort((a, b) => voiceQuality(b) - voiceQuality(a));
  }
  function pickVoice() {
    const vs = germanVoices();
    deVoice = (settings.voiceName && vs.find(v => v.name === settings.voiceName)) || vs[0] || null;
    fillVoiceSelect();
  }
  function fillVoiceSelect() {
    const sel = document.getElementById('voiceSel'); if (!sel) return;
    const vs = germanVoices();
    sel.innerHTML = '<option value="">Automatisch (beste verfügbare)</option>' + vs.map(v =>
      `<option value="${v.name.replace(/"/g, '&quot;')}">${voiceQuality(v) >= 4 ? '★ ' : ''}${v.name.replace(/</g, '&lt;')}</option>`).join('');
    sel.value = settings.voiceName || '';
    const hint = document.getElementById('voiceHint');
    if (hint) hint.hidden = vs.some(v => voiceQuality(v) >= 4);
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  /** Speak one or more phrases in order (replaces anything still being said). */
  function say(...parts) {
    if (!settings.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      for (const text of parts.filter(Boolean)) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = (deVoice && deVoice.lang) || 'de-DE'; if (deVoice) u.voice = deVoice; u.rate = settings.voiceRate || 1.0; u.pitch = 1.0;
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
    const colors = ['#ff3d81', '#ff8a3d', '#c4ff3d', '#3de4ff', '#8f6bff', '#ffc53d', '#ffffff'];
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
  /** How a caller announces a visit total. */
  function callScore(n) {
    if (n === 180) return 'Einhundertachtzig!';
    if (n === 0) return 'Keine Punkte.';
    if (n >= 100) return n + '!';
    return n + '.';
  }
  const spokenDart = d => d.v === 0 ? 'Daneben' : d.n === 25 ? (d.m === 2 ? 'Bull' : 'fünfundzwanzig')
    : (d.m === 3 ? 'Triple ' : d.m === 2 ? 'Doppel ' : '') + d.n;

  // ---------------- Banter: praise and (friendly) abuse ----------------
  const PRAISE_T20 = [
    'Triple 20! So sieht das aus!', 'Mitten rein. Wunderschön.', 'Das ist Weltklasse, {n}!', 'Hundert Prozent Präzision.',
    'Da staunt sogar der Bot.', 'Feinste Handarbeit!', 'Die Sechzig sitzt. Respekt.', 'Wie mit dem Lineal gezogen.',
    'Der Dart wollte nirgendwo anders hin.', 'Das Board sagt danke.', '{n}, du Maschine!', 'Bitte genau so weiter.',
    'Das war Absicht, das sieht man.', 'Lehrbuch. Kapitel eins. Triple 20.', 'Pures Gold, {n}.', 'Hier wohnt die Sechzig – und du hast geklingelt.',
    'So wirft ein Profi.', 'Kaltschnäuzig versenkt!', 'Treffer versenkt, Gegner zittert.', 'Davon träumen andere nachts.'
  ];
  const PRAISE_T19 = [
    'Triple 19! Stark ausgewichen.', 'Die 57 nehmen wir gern.', 'Neunzehn mal drei – sauber!', 'Plan B mit Stil, {n}!',
    'Unten links ist auch schön.', 'Triple 19, der Geheimtipp der Profis.', 'Das ist feinste Kurskorrektur.', 'Wer braucht schon die 20?',
    'Siebenundfünfzig. Lecker.', 'Auch die 19 hat Gefühle – und du triffst sie.', 'Sauber in die Triple 19, {n}!', 'Elegant ausgewichen, voll getroffen.',
    'Respekt, das Ding sitzt.', 'Die 19 freut sich über Besuch.', 'Kalt und präzise, {n}.'
  ];
  const ABUSE = [
    'Das Board ist da drüben, {n}.', 'War das ein Wurf oder ein Unfall?', 'Meine Oma wirft besser – und die ist blind.',
    'Hast du beim Werfen die Augen zu?', '{n}, das war nichts. Gar nichts.', 'Respekt, so knapp an allem vorbei.',
    'Der Dart hat sich geschämt und ist abgehauen.', 'Hast du schon mal überlegt, Schach zu spielen?', 'Das tut sogar der Kamera weh.',
    'Mit Anlauf daneben.', 'Wurfarm im Energiesparmodus?', 'Das war ein Wurf für die Statistik. Die schlechte.',
    'Das Board fühlt sich ignoriert.', 'Wo hast du denn hingezielt? Auf die Tapete?', 'Ein Dart, ein Drama.',
    'Selbst der Bot lacht gerade.', 'Klassischer Fall von: knapp daneben ist auch vorbei.', 'Ich hab schon Fliegen besser landen sehen.',
    'Zielwasser vergessen, {n}?', 'Den Wurf lassen wir mal unkommentiert. Nein, doch nicht: furchtbar.', 'Das gibt Punktabzug in der B-Note.',
    'Ist das ein neuer Trickwurf?', 'Hast du die Brille zu Hause gelassen?', 'Bewerbung für die Kreisliga abgelehnt.',
    'Da war mehr Wind als Wurf.', 'Mutig. Falsch, aber mutig.', 'So viel Pech kann man gar nicht haben – das ist Talent.',
    'Der Dart wollte eigentlich zur Toilette.', 'Grandios! Grandios schlecht.', 'Das war so schlecht, das tut beim Zuschauen weh.',
    '{n}, ich hab dich lieb, aber das war nix.', 'Wenn du so weitermachst, wirft der nächste Spieler für dich.', 'Kurze Frage: Spielen wir dasselbe Spiel?',
    'Der Wurf hatte keine Ahnung, wo er hin soll.', 'Die Eins? Wirklich? Die EINS?', 'Ganz knapp an der Sechzig vorbei. Also so 59 Punkte knapp.',
    'Das nennt man dann wohl kreative Zielwahl.', 'Taktischer Fehlwurf, um den Gegner in Sicherheit zu wiegen?', 'Dein Dart hat Höhenangst.',
    'Hast du gerade mit links geworfen?', 'Der Pfeil war schneller beleidigt als ich.', 'Bitte nicht nochmal so. Für uns alle.',
    'Glückwunsch, du hast die Wand getroffen.', 'Der war für die Nachbarn.', 'Dartsport-Verband wurde bereits informiert.',
    'Das kommt in die Pannen-Show.', 'Super Wurf – für ein anderes Board.', 'Und das vor Publikum!',
    'Das war kein Dart, das war ein Hilferuf.', 'Die Fünf sagt danke für den Mitleidsbesuch.', 'Die Eins: die Lieblingszahl von Verlierern.',
    'Hätte, hätte, Fahrradkette.', 'Das gibt einen Platz in der Hall of Shame.', 'Würdest du bitte das Board treffen? Nur so als Idee.',
    'Ich zähl das jetzt mal als Aufwärmen.', 'Neuer Rekord im Danebenwerfen!', 'Der Dart wollte mal was anderes sehen.',
    'Treffer! Leider im falschen Feld.', 'Da hat die Hand was anderes gemacht als der Kopf.', 'Der Wurf hat Charakter. Schlechten.',
    'Kopf hoch, schlimmer geht immer. Oder doch nicht.', 'Wenn Danebenwerfen olympisch wäre: Gold.', 'Die Zielscheibe hat dich nicht verdient. Oder du sie nicht.',
    'Das war Mitleid mit dem Gegner, oder?', 'Lass mich raten: der Boden war rutschig.', 'Und wieder ein Dart für die Tonne.',
    'Physik: eins. {n}: null.', 'Ups. Und nochmal ups.', 'Also DAS wird kein Highlight-Video.', 'Hast du kurz an was anderes gedacht?',
    'Das Board ist rund, {n}. Ganz rund. Da vorne.', 'Ein Wurf wie ein Montagmorgen.', 'Gegner freut sich, Publikum weint.',
    'Mit so einer Leistung gewinnt man höchstens Mitleid.', 'Das war unterirdisch. Und zwar im Keller.', 'Ganz ehrlich? Ich hab nix gesehen. Besser so.',
    'Der Dart hat gekündigt.', 'Gut, dass das keiner gefilmt hat. Ach doch, ich.', 'Die Kamera möchte das bitte vergessen.'
  ];
  const bags = new Map();
  /** Next phrase from a shuffled bag, so nothing repeats until all were used. */
  function pick(list, name) {
    let b = bags.get(list);
    if (!b || !b.length) { b = list.map((_, i) => i).sort(() => Math.random() - 0.5); bags.set(list, b); }
    return list[b.pop()].replace(/\{n\}/g, name);
  }
  /** Phrase for this dart, or null. Abuse only for 1, 5 or a miss while no finish is on. */
  function banterFor(d, remBefore, dartsLeft, name, out) {
    if (settings.banter === false) return null;
    if (d.n === 20 && d.m === 3) return pick(PRAISE_T20, name);
    if (d.n === 19 && d.m === 3) return pick(PRAISE_T19, name);
    const bad = d.v === 0 || d.n === 1 || d.n === 5;
    if (bad && !C.checkout(remBefore, 3, out)) return pick(ABUSE, name); // finish range: a checkout exists from here
    return null;
  }

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
      visit: [], over: false,
      // Bull-off: everyone throws one dart at the bull, closest starts. res: player index -> result.
      bull: settings.bullOff && names.length > 1 ? { order: names.map((_, i) => i), pos: 0, res: {}, spots: [], round: 1 } : null
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
    if (G.bull) { bullThrow(d, meta || {}); return; }
    const st = visitState();
    if (st.done) { toast('Aufnahme ist voll – „Weiter“ drücken'); return; }
    snapshot();
    G.visit.push(Object.assign({}, d, meta || {}));
    afterChange(true);
  }

  function editDart(i, d) {
    snapshot();
    G.hold = true; advance = null; // corrected: wait for Weiter
    if (G.visit[i] && G.visit[i].auto && !G.visit[i].filled && d.v === 0) detector.learnPhantom(); // camera saw a dart that was none
    if (G.visit[i] && G.visit[i].filled && d.v > 0) detector.learnMiss(d); // a dart we did not see
    G.visit[i] = Object.assign({}, d, { manual: true });
    G.visit = G.visit.slice(0, 3);
    afterChange(false);
  }

  // ---------------- Bull-off: who starts ----------------
  const dartsLeft = () => G.bull ? 1 : 3 - G.visit.length;
  const boardClear = () => G.visit.length === 0 && !(G.bull && G.bull.spots.length); // no counted dart in the board
  function bullText(r) { return r.bull ? 'Bull' : r.manual ? r.label : r.dist > 170 ? 'daneben' : Math.round(r.dist) + ' mm'; }
  function bullSpoken(r) { return r.bull ? 'Bull!' : r.manual ? spokenDart(r) : r.dist > 170 ? 'daneben' : Math.round(r.dist / 10) < 1 ? Math.round(r.dist) + ' Millimeter' : (r.dist / 10).toFixed(1).replace('.', ',') + ' Zentimeter'; }
  function bullThrow(d, meta) {
    const B = G.bull, i = B.order[B.pos];
    snapshot();
    let dist, manual = false;
    if (meta.img && H) { const [bx, by] = C.applyH(H, meta.img[0], meta.img[1]); dist = Math.hypot(bx, by); B.spots.push(meta.img.slice()); }
    else if (meta.bp) dist = Math.hypot(meta.bp[0], meta.bp[1]);
    else { manual = true; dist = d.v === 0 ? 999 : d.n === 25 ? (d.m === 2 ? 3 : 11) : 120; } // by hand only the field is known
    const r = B.res[i] = { dist, n: d.n, m: d.m, v: d.v, label: d.label, bull: d.n === 25 && d.m === 2, manual };
    if (r.bull) sfx.triple20(); else if (d.v === 0) sfx.miss(); else sfx.hit();
    const parts = [G.players[i].name + ': ' + bullSpoken(r)];
    B.pos++;
    let spots = null;
    if (B.pos < B.order.length) {
      G.cur = B.order[B.pos];
      parts.push(G.players[G.cur].name + ', du bist dran.');
    } else {
      // Everyone has thrown: closest wins; two bulls or the same field typed by hand = throw again.
      const ranked = B.order.map(k => ({ k, r: B.res[k] })).sort((a, b) => a.r.dist - b.r.dist);
      const top = ranked[0].r;
      const same = (a, b) => (a.bull && b.bull) || ((a.manual || b.manual) && a.label === b.label) || (!a.manual && !b.manual && Math.abs(a.dist - b.dist) < 1);
      const tied = ranked.filter(o => same(o.r, top)).map(o => o.k);
      spots = B.spots; B.spots = [];
      if (tied.length > 1) {
        B.order = tied; B.pos = 0; B.res = {}; B.round++; G.cur = tied[0];
        toast('Gleichstand – nochmal auf Bull: ' + tied.map(k => G.players[k].name).join(', '), 3500);
        parts.push('Gleichstand! Nochmal.', G.players[G.cur].name + ' beginnt.');
      } else {
        const w = ranked[0].k;
        G.bull = null; G.starter = G.cur = w;
        toast(G.players[w].name + ' gewinnt das Ausbullen und beginnt!', 3500);
        parts.push(G.players[w].name + ' beginnt. Game on!');
      }
    }
    say(...parts);
    persist(); render();
    if (spots && spots.length) detector.waitForPull(spots);
  }
  function skipBull() {
    snapshot(); G.bull = null; G.cur = G.starter; persist(); render();
    detector.rearm(false); say('Game on! ' + G.players[G.cur].name + ', wirf an.');
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
      // Voice: the dart, a comment, then the visit total when the visit is over
      const dartWord = spokenDart(last);
      const idx = G.visit.length - 1;
      const remBefore = G.rem[G.cur] - G.visit.slice(0, idx).reduce((a, d) => a + d.v, 0);
      const line = st.bust || st.win ? null : banterFor(last, remBefore, 3 - idx, name, G.out);
      if (line) toast(line, 3200);
      if (st.bust) say(dartWord, 'Überworfen! Keine Punkte.');
      else if (st.win) say(dartWord, 'Game shot! ' + name + ' gewinnt das Leg.');
      else if (st.done) say(dartWord, line, callScore(st.sum));
      else {
        const r = C.checkout(st.rem, 3 - G.visit.length, G.out);
        say(dartWord, line, r ? 'Noch ' + st.rem + ': ' + r.map(spokenDart).join(', ') + '.' : null);
      }
    }
    // Bot darts are virtual: nothing to pull from the board.
    if (st.done && !isBotTurn()) {
      detector.waitForPull();
      // Against a bot the game goes on by itself; pull your darts while the bot throws.
      const nextIdx = (G.cur + 1) % G.players.length;
      if (G.players.some(p => p.bot) && (st.win || G.players[nextIdx].bot) && !G.hold) {
        startAdvance();
      }
    }
    persist(); render();
  }

  /** Darts were pulled although fewer than three were counted: the others went out (or were not seen). */
  function finishVisitEarly() {
    if (!G || G.over || visitState().done) return;
    const k = 3 - G.visit.length;
    snapshot();
    for (let i = 0; i < k; i++) G.visit.push(Object.assign(C.dart(0, 0), { auto: true, filled: true }));
    const st = visitState();
    toast((k === 1 ? '1 Dart' : k + ' Darts') + ' nicht im Board – als daneben gezählt. Antippen zum Korrigieren.', 4000);
    sfx.miss();
    say(k === 1 ? 'Ein Dart daneben.' : k + ' Darts daneben.', callScore(st.sum));
    afterChange(false);
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
    G.visit = []; G.hold = false;
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
    if (co) say(G.players[G.cur].name + ', du brauchst ' + rem + '.', co.map(spokenDart).join(', ') + '.');
  }

  function undo() {
    if (!undoStack.length) { toast('Nichts zum Zurücknehmen'); return; }
    clearTimeout(botTimer); advance = null;
    G = JSON.parse(undoStack.pop());
    // Skip back over bot throws to the last human action.
    while (undoStack.length && G.players[G.cur].bot) G = JSON.parse(undoStack.pop());
    persist();
    detector.rearm(visitState().done);
    closeModal(); render();
  }

  // ---------------- Dart bot ----------------
  let botTimer = null;

  // ---------------- Correction time before the bot throws ----------------
  const ADV_MS = 7000;
  let advance = null; // { until }
  function startAdvance() { advance = { until: performance.now() + ADV_MS }; }
  function drawAdvance() {
    if (!advance || !G) return;
    const left = Math.max(0, Math.ceil((advance.until - performance.now()) / 1000));
    const next = G.players[(G.cur + 1) % G.players.length];
    const co = $('#checkout');
    co.className = 'checkout advance';
    co.innerHTML = `<span class="k">Korrigieren?</span><span class="advtxt">${escapeHtml(next.bot ? next.name : 'Nächstes Leg')} in ${left} s</span>`
      + `<button class="advbtn" data-adv="wait">Warten</button><button class="advbtn go" data-adv="go">Weiter</button>`;
  }
  $('#checkout').addEventListener('click', e => {
    const b = e.target.closest('[data-adv]'); if (!b) return;
    const go = b.dataset.adv === 'go';
    advance = null;
    if (go) nextTurn(); else { render(); toast('Angehalten – mit „Weiter“ geht es weiter'); }
  });
  setInterval(() => {
    if (!advance) return;
    if (!G || G.over || isBotTurn() || !visitState().done || $('#game').hidden) { advance = null; return; }
    // While a correction dialog is open, the clock waits.
    if (!$('#padSheet').hidden || !$('#modal').hidden) advance.until = Math.max(advance.until, performance.now() + 3000);
    if (performance.now() >= advance.until) { advance = null; nextTurn(); return; }
    drawAdvance();
  }, 250);
  const isBotTurn = () => !!(G && !G.over && G.players[G.cur].bot);
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!isBotTurn() || $('#game').hidden || !$('#modal').hidden) return;
    if (G.bull) {
      botTimer = setTimeout(() => {
        if (!G.bull || !isBotTurn() || !$('#modal').hidden || $('#game').hidden) return;
        const s = botLevel(G.players[G.cur].bot).sigma * 1.15, g = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
        const p = [g() * s, g() * s];
        addDart(C.scoreAt(p[0], p[1]), { bot: true, bp: p });
      }, 1600);
      return;
    }
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
      if (i !== G.cur && !G.bull) {
        const r = C.checkout(G.rem[i], 3, G.out);
        if (r) { const s = document.createElement('span'); s.className = 'proute'; s.textContent = r.map(d => d.label).join(' · '); card.querySelector('.prem').after(s); }
      }
      if (p.bot) { const tag = document.createElement('span'); tag.className = 'bottag'; tag.textContent = 'Bot ' + botLevel(p.bot).name; card.querySelector('.pmeta').prepend(tag); }
      strip.appendChild(card);
      if (i === G.cur) requestAnimationFrame(() => card.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
    });
    $('#legInfo').textContent = `${G.start} · ${G.out === 'double' ? 'Double Out' : G.out === 'master' ? 'Master Out' : 'Single Out'} · Leg ${G.leg}`;

    // Checkout hint ("tippt")
    const co = $('#checkout');
    const left = 3 - G.visit.length;
    const routes = !st.done && !G.bull ? C.checkouts(st.rem, left, G.out, 3) : [];
    const rtxt = r => r.map(d => d.label).join(' · ');
    if (G.bull) {
      const B = G.bull, done = Object.keys(B.res).map(k => escapeHtml(G.players[k].name) + ' ' + bullText(B.res[k]));
      co.className = 'checkout bull';
      co.innerHTML = `<span class="k">Ausbullen${B.round > 1 ? ' · Stechen' : ''}</span> ${escapeHtml(G.players[G.cur].name)} wirft auf Bull` + (done.length ? `<span class="alt">${done.join(' · ')}</span>` : '');
    }
    else if (advance && st.done) drawAdvance();
    else if (st.bust) { co.className = 'checkout none'; co.textContent = 'Überworfen – Darts ziehen, dann Weiter'; }
    else if (st.win) { co.className = 'checkout'; co.innerHTML = '<span class="k">Game shot</span> Leg gewonnen!'; }
    else if (st.done && G.hold) { co.className = 'checkout'; co.innerHTML = '<span class="k">Korrigiert</span> Prüfen, dann „Weiter“ drücken'; }
    else if (st.done) { co.className = 'checkout none'; co.textContent = 'Darts ziehen – danach geht es automatisch weiter'; }
    else if (routes.length) {
      co.className = 'checkout';
      co.innerHTML = `<span class="k">Finish</span> <span class="route">${rtxt(routes[0])}</span>` + (routes.length > 1 ? `<span class="alt">oder ${routes.slice(1).map(rtxt).join('  ·  oder ')}</span>` : '');
    }
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

    $('#btnNext').textContent = G.bull ? 'Überspringen' : st.win ? 'Leg!' : 'Weiter';
    $('#btnNext').classList.toggle('pulse', !!(G.hold && st.done));
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
    let html = `<circle r="200" fill="#0c0a1d"/>`;
    C.SEG.forEach((n, i) => {
      const a1 = i * 18 - 9, a2 = a1 + 18, dark = i % 2 === 0;
      const single = dark ? '#1a1638' : '#2e2860', ring = dark ? '#ff3d81' : '#3de4ff';
      html += `<path d="${seg(C.R.obull, C.R.tIn, a1, a2)}" fill="${single}"/>`;
      html += `<path d="${seg(C.R.tIn, C.R.tOut, a1, a2)}" fill="${ring}"/>`;
      html += `<path d="${seg(C.R.tOut, C.R.dIn, a1, a2)}" fill="${single}"/>`;
      html += `<path d="${seg(C.R.dIn, C.R.dOut, a1, a2)}" fill="${ring}"/>`;
      const [tx, ty] = pt(185, i * 18);
      html += `<text x="${tx}" y="${ty}" fill="#f5f2ff" font-size="17" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${n}</text>`;
    });
    html += `<circle r="${C.R.obull}" fill="#8f6bff"/><circle r="${C.R.bull}" fill="#c4ff3d"/>`;
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
      $('#padMark').innerHTML = `<circle cx="${q.x}" cy="${q.y}" r="6" fill="#ffc53d" stroke="#000" stroke-width="2"/>`;
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
      else { if (d.v > 0) detector.learnMiss(d); if (G && !G.bull) G.hold = true; addDart(d, { manual: true }); }
    }, 140);
  }
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('.scrim').hidden = true);
  $$('.scrim').forEach(s => s.addEventListener('click', e => { if (e.target === s) s.hidden = true; }));

  // ---------------- Buttons ----------------
  $('#btnMiss').onclick = () => { if (G && !G.bull) G.hold = true; addDart(C.dart(0, 0), { manual: true }); };
  $('#btnPad').onclick = () => openPad(G.visit.length);
  $('#btnUndo').onclick = undo;
  $('#btnNext').onclick = () => {
    if (G && G.bull) { skipBull(); return; }
    // If camera-detected darts are still in the board, the next change is them being pulled.
    const dartsInBoard = G && G.visit.some(d => d.auto);
    if (dartsInBoard) detector.waitForPull();
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
  let camShift = [0, 0]; // live camera shift vs. calibration (video-normalised), for drawing only
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
  /** Find the board in the current camera image and place the 4 points automatically. */
  async function runAutoCal() {
    if (!stream || !video.videoWidth) { toast('Erst die Kamera starten'); return false; }
    const btn = $('#calAuto');
    btn.disabled = true; btn.textContent = 'Suche Board …';
    await new Promise(r => setTimeout(r, 40)); // let the button repaint first
    const cr = crop(), vw = video.videoWidth, vh = video.videoHeight;
    const W = 560, Hc = Math.round(W * vh / vw);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hc;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(video, cr.x0 * vw, cr.y0 * vh, cr.w * vw, cr.w * vh, 0, 0, W, Hc);
    let res;
    try { res = C.autoCalibrate(cx.getImageData(0, 0, W, Hc).data, W, Hc); } catch (e) { res = { error: 'Erkennung fehlgeschlagen' }; }
    btn.disabled = false; btn.textContent = 'Automatisch erkennen';
    if (res.points && calibrating) {
      calDraft = res.points.map(([x, y]) => d2v(x / W, y / Hc));
      calib = calDraft; updateH(); drawOverlay();
    }
    if (res.error) { toast(res.error, 4500); return false; }
    toast('Board erkannt – Gitter prüfen, dann „Fertig“', 3500);
    return true;
  }

  function startCalibration() {
    if (!stream) { toast('Erst die Kamera starten'); return; }
    const firstTime = !store.get('calib', null);
    calibrating = true; calDraft = (calib || defaultCal()).map(p => p.slice());
    calib = calDraft; updateH();
    $('#calbar').hidden = false; $('#visit').hidden = true; $('.actions').hidden = true; setStatus('off', 'Kalibrieren');
    requestAnimationFrame(fitStage);
    if (firstTime) setTimeout(() => { if (calibrating) runAutoCal(); }, 900);
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
  $('#calAuto').onclick = runAutoCal;
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
      const q = detector.procRect, c0 = crop(), [ux, uy] = v2d(q.x0, q.y0);
      ctx.drawImage(detector.debugCanvas(), ux * W, uy * Hh, q.w / c0.w * W, q.w / c0.w * Hh); ctx.globalAlpha = 1;
    }
    if (Hinv) {
      const sh = calibrating ? [0, 0] : camShift;
      const toPx = (bx, by) => { const [vx, vy] = C.applyH(Hinv, bx, by); const [u, v] = v2d(vx + sh[0], vy + sh[1]); return [u * W, v * Hh]; };
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeStyle = calibrating ? 'rgba(255,197,61,.95)' : 'rgba(61,228,255,.45)';
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
        C.SEG.forEach((n, i) => { const a = i * 18 * Math.PI / 180; const [x, y] = toPx(190 * Math.sin(a), -190 * Math.cos(a)); ctx.fillStyle = 'rgba(255,197,61,.95)'; ctx.fillText(n, x, y); });
      }
    }
    if (calibrating && calDraft) {
      calDraft.forEach((p, i) => {
        const [dx, dy] = v2d(p[0], p[1]);
        const x = dx * W, y = dy * Hh;
        ctx.beginPath(); ctx.arc(x, y, 14 * dpr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,61,129,.35)'; ctx.fill();
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
        ctx.strokeStyle = '#ff3d81'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(lx, ly, L, L);
        ctx.beginPath(); ctx.moveTo(lx + L / 2, ly + 6 * dpr); ctx.lineTo(lx + L / 2, ly + L - 6 * dpr); ctx.moveTo(lx + 6 * dpr, ly + L / 2); ctx.lineTo(lx + L - 6 * dpr, ly + L / 2); ctx.stroke();
      }
    }
    // Live preview: where a dart seems to have landed, before it is confirmed
    if (G && !calibrating && detector.preview.length) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      for (const p of detector.preview) {
        const [dx, dy] = v2d(p.img[0] + camShift[0], p.img[1] + camShift[1]);
        const x = dx * W, y = dy * Hh;
        ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = `rgba(255,197,61,${0.55 + 0.45 * pulse})`;
        ctx.beginPath(); ctx.arc(x, y, (12 + 4 * pulse) * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = `800 ${15 * dpr}px Barlow Condensed, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(p.label + '?', x + 18 * dpr, y);
        ctx.fillStyle = '#ffc53d'; ctx.fillText(p.label + '?', x + 18 * dpr, y);
      }
    }
    // Detected darts of the current visit
    if (G && !calibrating) {
      G.visit.forEach((d, i) => {
        let img = d.img;
        if (!img && d.bp && Hinv) img = C.applyH(Hinv, d.bp[0], d.bp[1]);
        if (!img) return;
        const [dx, dy] = v2d(img[0] + camShift[0], img[1] + camShift[1]);
        const x = dx * W, y = dy * Hh;
        ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = d.bot ? '#3de4ff' : d.manual ? 'rgba(169,163,207,.85)' : '#ff3d81'; ctx.fill();
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
    // emptyRef: the board without darts (taken while no darts of the current visit are in it).
    // pullSpots: where this visit's darts sit (video coords) – they must be gone before play goes on.
    let emptyRef = null, pullSpots = [], recalBusy = false;
    // Stabilisation: every frame is lined up with the anchor (the picture the calibration belongs to).
    let tracker = null, cam = [0, 0], trackBad = 0, camEdge = 1;
    let dbgCanvas = null, dbgCtx = null;
    let pr = { x0: 0, y0: 0, w: 1 };  // processed part of the video (normalised), square in normalised units
    const p2v = (x, y) => [pr.x0 + x / PW * pr.w, pr.y0 + y / PH * pr.w];
    const v2p = (vx, vy) => [(vx - pr.x0) / pr.w * PW, (vy - pr.y0) / pr.w * PH];
    let model = null, dirAt = null; // camera model: how a dart must look at each spot
    let recent = [];                 // blobs seen but not counted, for learning from corrections
    const self = {
      lastBin: null,
      preview: [],
      get procRect() { return pr; },
      learnMiss(d) { learn(d, true); },
      learnPhantom() { learn(null, false); },
      reset() { ref = null; prev = null; stable = 0; bigSince = 0; this.lastBin = null; emptyRef = null; pulling = G ? visitState().done : false; },
      waitForPull(spots) {
        pulling = true;
        pullSpots = spots ? spots.map(p => p.slice()) : G ? G.visit.filter(d => d.img).map(d => d.img.slice()) : [];
        if (stream) setStatus('pull', 'Darts ziehen');
      },
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
      const w = 480, h = Math.round(w * vh / vw); // higher resolution: thin shafts stay visible
      if (w !== PW || h !== PH) { PW = w; PH = h; proc.width = PW; proc.height = PH; needMask = true; ref = prev = null; }
      if (needMask && H) {
        // Analyse only the board region, always at full processing resolution – independent of zoom
        // and distance, so a far-away board does not shrink darts to single pixels.
        let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
        for (let k = 0; k < 72; k++) {
          const a = k / 72 * Math.PI * 2, [vx, vy] = C.applyH(Hinv, 236 * Math.sin(a), -236 * Math.cos(a));
          x0 = Math.min(x0, vx); x1 = Math.max(x1, vx); y0 = Math.min(y0, vy); y1 = Math.max(y1, vy);
        }
        const pw = Math.min(1, Math.max(x1 - x0, y1 - y0) * 1.06);
        pr = { w: pw, x0: Math.min(1 - pw, Math.max(0, (x0 + x1) / 2 - pw / 2)), y0: Math.min(1 - pw, Math.max(0, (y0 + y1) / 2 - pw / 2)) };
        mask = new Uint8Array(PW * PH); maskCount = 0;
        for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
          const [vx, vy] = p2v(x + 0.5, y + 0.5);
          const [bx, by] = C.applyH(H, vx, vy);
          if (Math.hypot(bx, by) < 228) { mask[y * PW + x] = 1; maskCount++; } // whole board incl. number ring: flights of double darts hang out there
        }
        needMask = false; ref = prev = null; tracker = null; cam = [0, 0]; camShift = [0, 0]; camEdge = 1;
        buildModel();
      }
      return !!mask;
    }
    function params() {
      const s = settings.sens, L = settings.learn, rb = Math.sqrt(maskCount / Math.PI) * 170 / 228, k = Math.max(0.5, (rb / 120) * (rb / 120)); // board radius in proc px → area scale
      return {
        thr: Math.max(14, Math.round(52 - s * 0.36 + L.thr)),            // per-pixel colour difference
        minArea: Math.round((12 + (100 - s) * 0.55) * k * L.area),         // pixels
        minElong: L.elong,
        motion: Math.round(10 * k),
        maxArea: Math.max(400 * k, maskCount * 0.16)
      };
    }
    /** Camera model from the calibration: expected direction/length of a dart at a processing pixel. */
    function buildModel() {
      model = null; dirAt = null;
      if (!Hinv || !video.videoWidth) return;
      model = C.dartModel(Hinv, video.videoWidth, video.videoHeight);
      const toProc = ([vx, vy]) => v2p(vx, vy);
      dirAt = (x, y) => {
        const [vx, vy] = p2v(x, y);
        const [bx, by] = C.applyH(H, vx, vy);
        const [fx, fy] = toProc(model.project(bx, by, 110)); // flight end of a ~11 cm dart
        const [tx, ty] = toProc(model.project(bx, by, 0));
        const len = Math.hypot(fx - tx, fy - ty) || 1e-6;
        return { ex: (fx - tx) / len, ey: (fy - ty) / len, len };
      };
    }
    /** Remember blobs that were not counted (for learning when the player enters the dart by hand). */
    function remember(list, now) {
      for (const r of list) {
        const [vx, vy] = p2v(r.x, r.y), [bx, by] = C.applyH(H, vx, vy);
        recent.push({ t: now, bx, by, area: r.area, elong: r.elong, minArea: params().minArea });
      }
      recent = recent.filter(r => now - r.t < 15000).slice(-20);
    }
    /** Adapt thresholds from a correction: a missed dart (miss=true) or a phantom. */
    function learn(d, miss) {
      if (!stream || !H || calibrating) return;
      const L = settings.learn, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      if (miss) {
        const [ax, ay] = C.aimPoint(d), now = performance.now();
        const near = recent.filter(r => now - r.t < 15000)
          .map(r => ({ r, dist: Math.hypot(r.bx - ax, r.by - ay), same: C.scoreAt(r.bx, r.by).n === d.n }))
          .filter(o => o.same || o.dist < 45).sort((a, b) => a.dist - b.dist)[0];
        if (near) {
          // The camera saw it but did not trust it: accept blobs like this one from now on.
          L.elong = clamp(Math.min(L.elong, near.r.elong - 0.05), 1.15, 2.5);
          L.area = clamp(Math.min(L.area, L.area * near.r.area / near.r.minArea * 0.95), 0.35, 2.5);
          recent = recent.filter(r => r !== near.r);
          toast('Gelernt: solche Darts zähle ich ab jetzt mit', 2600);
        } else {
          // Nothing seen at all: look more closely.
          L.thr = clamp(L.thr - 2, -16, 16); L.area = clamp(L.area * 0.9, 0.35, 2.5);
          toast('Gelernt: Erkennung jetzt etwas empfindlicher', 2600);
        }
      } else {
        L.thr = clamp(L.thr + 2, -16, 16); L.area = clamp(L.area * 1.1, 0.35, 2.5); L.elong = clamp(L.elong + 0.05, 1.15, 2.5);
        toast('Gelernt: Erkennung jetzt etwas strenger', 2600);
      }
      L.n++; saveSettings();
    }
    function blend(a, b) { for (let i = 0; i < a.length; i++) a[i] = (a[i] * 3 + b[i]) >> 2; }

    const copy = px => new Uint8ClampedArray(px);
    const changed = (a, b2, P) => C.denoise(C.diffMaskTol(a, b2, mask, PW, PH, P.thr, C.meanOffset(a, b2, mask, PW, PH), camEdge).bin, PW, PH);

    /** The camera has settled somewhere else: move the calibration there and start a new anchor. */
    function bake() {
      const mx = cam[0] / PW * pr.w, my = cam[1] / PH * pr.w;
      calib = calib.map(([x, y]) => [x + mx, y + my]); store.set('calib', calib);
      updateH(); // rebuilds mask, anchor and references on the next frame
      emptyRef = null; cam = [0, 0]; camShift = [0, 0];
    }

    /** The 4 calibration points as found by the automatic board search in the current frame (or null). */
    function findBoard() {
      const cr = crop(), vw = video.videoWidth, vh = video.videoHeight;
      const W = 560, Hc = Math.round(W * vh / vw);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hc;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(video, cr.x0 * vw, cr.y0 * vh, cr.w * vw, cr.w * vh, 0, 0, W, Hc);
      const res = C.autoCalibrate(cx.getImageData(0, 0, W, Hc).data, W, Hc);
      return res.error || !res.points ? null : res.points.map(([x, y]) => d2v(x / W, y / Hc));
    }

    // Periodic re-calibration. calBase.off: offset between the stored points and what the board search finds,
    // so a hand-tuned calibration keeps its fine-tuning. pendingCal: a correction seen once, applied when confirmed.
    let calCheckAt = 0, calBase = null, pendingCal = null, recalAt = 0, recalFails = 0;
    function refineCal() {
      recalBusy = true;
      setTimeout(() => {
        try {
          const found = findBoard(), vw = video.videoWidth, vh = video.videoHeight;
          const now = calib.map(([x, y]) => [x + camShift[0], y + camShift[1]]); // where tracking says the board is
          if (!found) { /* board search failed (light, darts, person): keep everything */ }
          else if (!calBase || calBase.calib !== calib) {
            calBase = { calib, off: now.map((p, i) => [p[0] - found[i][0], p[1] - found[i][1]]) }; pendingCal = null;
          } else {
            const want = found.map((p, i) => [p[0] + calBase.off[i][0], p[1] + calBase.off[i][1]]);
            const delta = want.map((p, i) => [(p[0] - now[i][0]) * vw, (p[1] - now[i][1]) * vh]);
            const dev = Math.max(...delta.map(d => Math.hypot(d[0], d[1])));
            if (dev > 3 && dev < 80) {
              const agree = pendingCal && Math.max(...delta.map((d, i) => Math.hypot(d[0] - pendingCal[i][0], d[1] - pendingCal[i][1]))) < 2.5;
              if (agree) {
                calib = want; store.set('calib', calib); updateH();
                ref = prev = null; emptyRef = null; tracker = null; cam = [0, 0]; camShift = [0, 0]; camEdge = 1;
                calBase = { calib, off: calBase.off }; pendingCal = null;
                self.recals = (self.recals || 0) + 1;
                toast('Kalibrierung automatisch nachgeführt', 2200);
              } else pendingCal = delta;
            } else pendingCal = null;
          }
        } catch (e) { console.error(e); }
        recalBusy = false;
      }, 0);
    }

    /** Bigger move: look for the board again in the current frame. */
    function autoRecal(reason) {
      if (recalBusy) return;
      recalBusy = true;
      setStatus('motion', 'Kamera bewegt – suche Board …');
      setTimeout(() => {
        try {
          const vw = video.videoWidth, vh = video.videoHeight;
          const raw = findBoard();
          // Keep the hand fine-tuning of the calibration (offset to what the board search finds).
          const found = raw && calBase ? raw.map((p, i) => [p[0] + calBase.off[i][0], p[1] + calBase.off[i][1]]) : raw;
          recalFails = found ? 0 : recalFails + 1;
          // Board still where the tracker says it is (someone was just standing in front): change nothing.
          const off = found ? Math.max(...found.map(([x, y], i) => Math.hypot((x - calib[i][0] - camShift[0]) * vw, (y - calib[i][1] - camShift[1]) * vh))) : 1e9;
          if (found && off < 6 && trackBad <= 12) {
            setStatus(pulling ? 'pull' : 'ready', pulling ? 'Darts ziehen' : 'Bereit – wirf!');
          } else if (found && off < 6) {
            // Board where it was, but the stabilisation lost its anchor (e.g. light changed): start a new one.
            calib = found; store.set('calib', calib); updateH();
            ref = prev = null; emptyRef = null; tracker = null; cam = [0, 0]; camShift = [0, 0]; camEdge = 1;
            if (calBase) calBase = { calib, off: calBase.off };
          } else if (found) {
            calib = found; store.set('calib', calib); updateH();
            ref = prev = null; emptyRef = null; tracker = null; cam = [0, 0]; camShift = [0, 0]; camEdge = 1;
            if (calBase) calBase = { calib, off: calBase.off };
            toast('Kamera hat sich bewegt – Board neu erkannt', 3000);
          } else if (recalFails >= 2 && trackBad > 90) { // ~8 s without hold and no board found (a person leaves sooner)
            // Board search failed twice, picture calm: keep the calibration where tracking last had it and take a
            // new reference picture, so counting can go on.
            calib = calib.map(([x, y]) => [x + camShift[0], y + camShift[1]]); store.set('calib', calib); updateH();
            ref = prev = null; emptyRef = null; tracker = null; cam = [0, 0]; camShift = [0, 0]; camEdge = 1;
            calBase = null; recalFails = 0;
            toast('Kamera hat sich bewegt – Bild neu ausgerichtet. Liegen Treffer daneben: neu kalibrieren.', 4500);
          } else if (recalFails >= 3) {
            // Not found several times in a row (a person in front fails only once or twice): ask for help.
            recalFails = 0;
            toast('Kamera hat sich bewegt. Bitte neu kalibrieren (Fadenkreuz oben rechts).', 5000);
          }
        } catch (e) { console.error(e); }
        recalBusy = false;
      }, 30);
    }

    /** Are this visit's darts gone (board looks like before the visit again where they were)? */
    function dartsGone(cur, P) {
      if (!emptyRef) return null;
      const e = changed(cur, emptyRef, P);
      if (e.count > P.maxArea) return false; // someone is still in front of the board
      if (pullSpots.length) {
        const rad = Math.max(4, Math.round(PW / 60));
        for (const [vx, vy] of pullSpots) {
          const [qx, qy] = v2p(vx, vy), px = Math.round(qx), py = Math.round(qy);
          let hit = 0, tot = 0;
          for (let yy = py - rad; yy <= py + rad; yy++) for (let xx = px - rad; xx <= px + rad; xx++) {
            if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
            tot++; if (e.bin[yy * PW + xx]) hit++;
          }
          if (hit >= Math.max(3, tot * 0.03)) return false; // something is still where that dart was
        }
        return true;
      }
      return e.count < Math.max(P.minArea * 3, maskCount * 0.01);
    }

    // armed: something moved since the last decision. Changes that appear without any movement
    // (light drift, auto-exposure) are absorbed and never counted as darts.
    // personSeen: someone (not just a dart) was in front of the board since the last decision.
    let armed = false, paused = false, cand = null, personSeen = false;
    // bursts: separate throw movements (movement after a calm moment) since the last decision. One throw
    // brings one dart, so a single movement can never add two darts (shadow, flight and tip seen apart).
    let bursts = 0;
    /** Are the darts of the current visit gone from where they were counted? */
    function visitPulled(cur, P) {
      const spots = G.visit.filter(d => d.img).map(d => d.img.slice());
      if (!spots.length) return false;
      const keep = pullSpots; pullSpots = spots;
      const gone = dartsGone(cur, P);
      pullSpots = keep;
      return gone !== false;
    }
    function tick(now) {
      if (!stream || calibrating || recalBusy || !H || video.readyState < 2 || !G || G.over) return;
      if (isBotTurn() || !$('#padSheet').hidden || !$('#modal').hidden) { paused = true; return; }
      if (!ensureSize()) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      pctx.drawImage(video, pr.x0 * vw, pr.y0 * vh, pr.w * vw, pr.w * vh, 0, 0, PW, PH);
      const raw = pctx.getImageData(0, 0, PW, PH).data;
      const L = C.luma(raw, PW, PH);
      if (!tracker) { tracker = C.makeTracker(L, mask, PW, PH); cam = [0, 0]; trackBad = 0; }
      const tr = tracker.track(L, cam);
      if (tr.ok) { cam = [tr.dx, tr.dy]; trackBad = 0; recalFails = 0; camEdge = Math.max(camEdge, Math.ceil(Math.max(Math.abs(cam[0]), Math.abs(cam[1]))) + 2); } else trackBad++;
      camShift = [cam[0] / PW * pr.w, cam[1] / PH * pr.w];
      const cur = Math.abs(cam[0]) < 0.05 && Math.abs(cam[1]) < 0.05 ? raw : C.warpShift(raw, PW, PH, cam[0], cam[1]);
      // Board out of reach of the tracker for a while and the picture is calm: find it again.
      // Lost the board (phone turned/tilted, or someone in front): count nothing – the differences would be
      // the board edges, not darts. Once the picture is calm, look for the board again.
      if (trackBad >= 4) {
        cand = null; stable = 0; self.preview = [];
        personSeen = true; armed = true; // usually someone in front of the board
        const calm = prev && C.motionCount(cur, prev, mask, PW, PH, params().thr, null, camEdge) <= params().motion;
        prev = copy(cur);
        if (calm && trackBad > 12 && now - recalAt > 4000) { recalAt = now; autoRecal(); }
        else if (!pulling && !recalBusy) setStatus('motion', 'Kamera bewegt …');
        return;
      }
      if (!ref) {
        ref = copy(cur); prev = copy(cur); stable = 0; armed = false; cand = null;
        if (!emptyRef && !pulling && boardClear()) emptyRef = copy(cur);
        return;
      }
      if (paused) {
        // Back from a pause (bot turn, dialog): darts may have been pulled meanwhile, so look once.
        paused = false; armed = true; cand = null; stable = 0; prev = copy(cur); return;
      }
      const P = params();
      const m = { count: C.motionCount(cur, prev, mask, PW, PH, P.thr, C.meanOffset(cur, prev, mask, PW, PH), camEdge) };
      prev = copy(cur);
      self.info = { ok: tr.ok, inl: +tr.inl.toFixed(2), err: +tr.err.toFixed(1), raw: [+tr.dx.toFixed(1), +tr.dy.toFixed(1)], cam: cam.map(v => +v.toFixed(1)), motion: m.count, stable, armed, thr: P.motion };
      if (m.count > P.motion) {
        stable = 0; cand = null;
        if (m.count > P.maxArea * 0.35) personSeen = true; // far more than a dart: a person/arm
        if (m.count >= Math.max(P.motion * 2, P.minArea * 0.6)) { if (stable >= 2 || !armed) bursts++; armed = true; }
        if (!pulling) setStatus('motion', 'Bewegung …');
        return;
      }
      stable++;
      // Live preview while the dart settles: show where it seems to be right away.
      if (stable < 5 && armed && !pulling && stable >= 1) {
        const pv = changed(cur, ref, P);
        if (pv.count >= P.minArea && pv.count <= P.maxArea) {
          const hs = C.findDarts(pv.bin, PW, PH, { minArea: P.minArea, minElong: P.minElong, max: dartsLeft(), tipPref: settings.tipPref, dirAt });
          self.preview = hs.map(hh => { const img = p2v(hh.x, hh.y); return { img, label: C.scoreAt(...C.applyH(H, img[0], img[1])).label }; });
          if (self.preview.length) setStatus('hit', 'Dart landet … ' + self.preview.map(p => p.label).join(', ') + '?');
        }
      }
      if (stable < 5 || now < cooldownUntil) return; // ~0.4 s quiet: the dart has stopped wobbling
      const ch = changed(cur, ref, P);
      self.lastBin = ch.bin;
      if (debugView) drawOverlay();

      if (pulling) {
        const gone = dartsGone(cur, P);
        if (gone === true || (gone === null && armed && ch.count >= P.minArea)) {
          ref = copy(cur); emptyRef = copy(cur); stable = 0; armed = false; cand = null; self.lastBin = null; pullSpots = []; personSeen = false; bursts = 0;
          pulling = false;
          if (settings.autoNext && G && visitState().done && !isBotTurn() && !G.hold) { nextTurn(); toast('Darts gezogen – nächster Spieler'); }
          else if (G && G.hold && visitState().done) toast('Korrigiert – mit „Weiter“ geht es zum nächsten Spieler', 3500);
          pulling = G ? visitState().done : false;
          if (!pulling && !isBotTurn()) setStatus('ready', 'Bereit – wirf!');
        } else {
          setStatus('pull', gone === false ? 'Darts ziehen …' : 'Darts ziehen');
          if (ch.count < P.minArea && stable % 8 === 0) blend(ref, cur);
        }
        return;
      }

      // Someone was at the board and the darts counted so far are gone again: they pulled before three
      // darts were counted, so the rest went out. Finish the visit instead of giving the next throw to them.
      if (personSeen && emptyRef && G.visit.length && !visitState().done && visitPulled(cur, P)) {
        ref = copy(cur); emptyRef = copy(cur); stable = 0; armed = false; cand = null; personSeen = false; self.lastBin = null; self.preview = [];
        finishVisitEarly();
        return;
      }

      if (ch.count < P.minArea) {
        bigSince = 0; cand = null; armed = false; personSeen = false; if (stable >= 8) bursts = 0; if (self.preview.length) { self.preview = []; drawOverlay(); }
        if (stable % 8 === 0) {
          blend(ref, cur); // follow slow light changes
          if (boardClear()) emptyRef = copy(ref);
        }
        if (stable >= 12 && boardClear() && Math.hypot(cam[0], cam[1]) > 1.5) { bake(); return; }
        // Now and then, with the board empty and calm: find the board again and follow slow drift.
        if (settings.autoCal !== false && stable >= 15 && boardClear() && !recalBusy &&
            now - calCheckAt > (calBase && calBase.calib === calib ? (pendingCal ? 6000 : 20000) : 3000)) { calCheckAt = now; refineCal(); return; }
        setStatus('ready', 'Bereit – wirf!');
        return;
      }
      if (!armed) {
        // Changed without visible movement. A clear dart shape still counts (it can land between two frames);
        // anything else is light drift and gets absorbed.
        const hs = ch.count <= P.maxArea ? C.findDarts(ch.bin, PW, PH, { minArea: P.minArea, minElong: P.minElong, max: dartsLeft(), tipPref: settings.tipPref, dirAt }) : [];
        if (hs.some(hh => !hh.unsure && hh.conf >= 0.5)) armed = true;
        else {
          // Never take a picture with a person in it as the new reference (only after ~10 s of total calm,
          // e.g. the light was switched on) – otherwise the pulled darts behind them go unnoticed.
          if (stable >= 12 && (ch.count <= P.maxArea || stable >= 120)) { remember(hs.concat(hs.rejected || []), now); ref = copy(cur); if (boardClear()) emptyRef = copy(cur); self.lastBin = null; self.preview = []; }
          return;
        }
      }
      if (ch.count > P.maxArea) {
        cand = null; personSeen = true;
        if (!bigSince) bigSince = now;
        setStatus('motion', 'Zu viel Veränderung im Bild');
        if (now - bigSince > 2500) { bigSince = 0; armed = false; autoRecal(); }
        return;
      }
      bigSince = 0;
      // Confirm: the change must look the same on two checks ~0.25 s apart (no flicker).
      if (!cand) { cand = { count: ch.count, at: stable }; return; }
      if (stable - cand.at < 3) return;
      if (Math.abs(ch.count - cand.count) > Math.max(8, 0.3 * Math.max(ch.count, cand.count))) { cand = { count: ch.count, at: stable }; return; }
      cand = null;
      // Safety net: if the changed pixels now look like the empty board again, darts were removed, not thrown.
      if (emptyRef) {
        let back = 0, tot = 0;
        for (let i = 0; i < PW * PH; i++) {
          if (!ch.bin[i]) continue;
          tot++;
          const j = i * 4;
          if (Math.max(Math.abs(cur[j] - emptyRef[j]), Math.abs(cur[j + 1] - emptyRef[j + 1]), Math.abs(cur[j + 2] - emptyRef[j + 2])) <= P.thr) back++;
        }
        if (tot && back / tot > 0.6) {
          const pulledEarly = personSeen && G.visit.length > 0 && !visitState().done && visitPulled(cur, P);
          ref = copy(cur); stable = 0; armed = false; self.lastBin = null; personSeen = false;
          if (pulledEarly) { emptyRef = copy(cur); finishVisitEarly(); return; }
          setStatus('ready', 'Darts entfernt – kein Wurf');
          return;
        }
      }
      const left = dartsLeft();
      let bin = ch.bin, gone = 0; // gone: changed pixels that show the empty board again
      if (emptyRef && G.visit.length) {
        // Where the picture is back to the empty board, a dart left (knocked out or moved), none arrived.
        bin = new Uint8Array(ch.bin);
        for (let i = 0; i < PW * PH; i++) {
          if (!bin[i]) continue;
          const j = i * 4;
          if (Math.max(Math.abs(cur[j] - emptyRef[j]), Math.abs(cur[j + 1] - emptyRef[j + 1]), Math.abs(cur[j + 2] - emptyRef[j + 2])) <= P.thr * 0.8) { bin[i] = 0; gone++; }
        }
        bin = C.denoise(bin, PW, PH).bin;
      }
      let hits = C.findDarts(bin, PW, PH, { minArea: P.minArea, minElong: P.minElong, max: 3, tipPref: settings.tipPref, dirAt });
      const rejected = hits.rejected;
      // One throw = one dart. A second find in the same check only counts when it is a clear, separate dart
      // (two quick throws); bits next to a dart already in the board are that dart being nudged.
      const old = G.visit.filter(d => d.img).map(d => v2p(d.img[0], d.img[1]));
      const near = (h, list, r) => list.some(([x, y]) => Math.hypot(h.x - x, h.y - y) < r);
      const radius = h => Math.max(6, (h.exp ? h.exp.len : PW / 20) * 0.7);
      // Distances on the board in mm (independent of how the camera looks at it).
      const mm = h => { const [vx, vy] = p2v(h.x, h.y); return C.applyH(H, vx, vy); };
      const oldMm = G.visit.filter(d => d.img).map(d => C.applyH(H, d.img[0], d.img[1]));
      const nearMm = (h, list, r) => { const [x, y] = mm(h); return list.some(([a, b]) => Math.hypot(x - a, y - b) < r); };
      const throws = Math.max(1, bursts);
      const kept = [];
      for (const h of hits) {
        const clear = !h.unsure && h.conf >= 0.5;
        if (near(h, kept.map(o => [o.x, o.y]), radius(h)) || nearMm(h, kept.map(mm), 35)) { rejected.push(h); continue; } // same dart: flight/tip apart, or its shadow
        if (near(h, old, radius(h)) && !clear && h.area < P.minArea * 1.5) continue; // an old dart nudged a bit
        if (!bursts && nearMm(h, oldMm, 40)) continue;                          // no throw: a dart settling, its shadow moving
        // A dart in the board sagged or turned: where its flight was, the empty board shows again. A new dart
        // hides the board, it never uncovers it.
        if (gone >= ch.count * 0.2 && nearMm(h, oldMm, 25)) { self.moved = (self.moved || 0) + 1; continue; }
        if (kept.length && (!clear || near(h, old, radius(h)) || kept.length >= throws)) { rejected.push(h); continue; }
        kept.push(h);
      }
      hits = kept.slice(0, left);
      self.lastBursts = bursts;
      hits.rejected = rejected;
      // A throw happened (movement, nobody at the board) and a real blob appeared, but it does not look like
      // a dart: count it anyway as "please check" rather than losing the dart.
      if (!hits.length && !personSeen && bursts) {
        const big = rejected.filter(r => r.area >= P.minArea * 0.7 && !near(r, old, radius(r))).sort((a, b) => b.area - a.area)[0];
        if (big) { big.unsure = true; big.conf = Math.min(big.conf || 0, 0.2); hits.push(big); rejected.splice(rejected.indexOf(big), 1); }
      }
      personSeen = false; bursts = 0;
      const ref0 = ref;
      ref = copy(cur); stable = 0; armed = false; cooldownUntil = now + 300; self.preview = [];
      remember(hits.rejected, now);
      self.lastHits = hits.map(hh => ({ x: hh.x, y: hh.y, area: hh.area, elong: +hh.elong.toFixed(2), len: +hh.length.toFixed(1), exp: hh.exp && { ex: +hh.exp.ex.toFixed(2), ey: +hh.exp.ey.toFixed(2), len: +hh.exp.len.toFixed(1) }, extrap: hh.extrap, align: hh.align && +hh.align.toFixed(2), unsure: !!hh.unsure, tipAtHigh: hh.tipAtHigh, axis: hh.axis }));
      if (!hits.length) {
        if (hits.rejected.length) setStatus('ready', 'Fleck ignoriert – kein Dart');
        return;
      }
      // Follow each dart's axis to the real tip with a finer threshold (hidden barrel / thin point).
      const offT = C.meanOffset(cur, ref0, mask, PW, PH);
      for (const hit of hits) {
        if (!hit.exp || settings.tipPref !== 'auto') continue;
        let ux = hit.x - 0.5 - hit.axis.cx, uy = hit.y - 0.5 - hit.axis.cy; const ul = Math.hypot(ux, uy);
        if (ul < 2) { ux = -hit.exp.ex; uy = -hit.exp.ey; } else { ux /= ul; uy /= ul; }
        const full = hit.exp.len * 140 / 110;
        if (!hit.axis) continue;
        const [nx2, ny2] = C.traceTip(cur, ref0, PW, PH, hit.x - 0.5, hit.y - 0.5, ux, uy, Math.round(Math.max(3, Math.min(full * 0.5, full - hit.length + 4))), Math.max(10, P.thr * 0.45), offT);
        hit.x = nx2 + 0.5; hit.y = ny2 + 0.5;
      }
      // Several darts can land between two checks (quick throws): count each one.
      const labels = [];
      for (const hit of hits) {
        const [nx, ny] = p2v(hit.x, hit.y);
        const [bx, by] = C.applyH(H, nx, ny);
        const d = C.scoreAt(bx, by);
        labels.push(d.label);
        addDart(d, { auto: true, img: [nx, ny], conf: +hit.conf.toFixed(2) });
      }
      if (!visitState().done) setStatus('hit', (hits.length > 1 ? hits.length + ' Darts: ' : 'Erkannt: ') + labels.join(', ') + (hits.some(hh => hh.unsure) ? ' – bitte prüfen' : ''));
    }
    let last = 0, drawnShift = [0, 0];
    (function loop(t) {
      if (t - last > 80) {
        last = t;
        try { tick(t); } catch (e) { console.error(e); }
        // Keep the overlay in step with the camera shift and let the preview ring pulse.
        if (self.preview.length || Math.abs(camShift[0] - drawnShift[0]) + Math.abs(camShift[1] - drawnShift[1]) > 0.0008) { drawnShift = camShift.slice(); drawOverlay(); }
      }
      requestAnimationFrame(loop);
    })(0);
    return self;
  })();

  // ---------------- Settings sheet ----------------
  $('#btnSettings').onclick = () => {
    $('#sens').value = settings.sens; $('#sensVal').textContent = settings.sens;
    $('#tipPref').value = settings.tipPref; $('#voice').checked = settings.voice; fillVoiceSelect(); $('#voiceRate').value = settings.voiceRate || 1; $('#sfx').checked = settings.sfx !== false;
    $('#autoNext').checked = settings.autoNext; $('#wake').checked = settings.wake; $('#banter').checked = settings.banter !== false; $('#autoCal').checked = settings.autoCal !== false;
    const L = settings.learn;
    $('#learnInfo').textContent = L.n ? `${L.n} Korrektur${L.n === 1 ? '' : 'en'} gelernt (Schwelle ${L.thr > 0 ? '+' : ''}${L.thr}, Mindestgröße ×${L.area.toFixed(2)}, Form ab ${L.elong.toFixed(2)})` : 'Noch nichts gelernt.';
    $('#camToggle').textContent = stream ? 'Kamera stoppen' : 'Kamera starten';
    $('#setSheet').hidden = false;
  };
  $('#sens').oninput = e => { settings.sens = +e.target.value; $('#sensVal').textContent = settings.sens; saveSettings(); };
  $('#tipPref').onchange = e => { settings.tipPref = e.target.value; saveSettings(); };
  $('#voice').onchange = e => { settings.voice = e.target.checked; saveSettings(); };
  $('#voiceSel').onchange = e => { settings.voiceName = e.target.value; saveSettings(); pickVoice(); say('Einhundertachtzig!'); };
  $('#voiceRate').onchange = e => { settings.voiceRate = +e.target.value; saveSettings(); say('Du brauchst 40. Doppel 20.'); };
  $('#voiceTest').onclick = () => { const was = settings.voice; settings.voice = true; say('Game on!', 'Triple 20.', 'Einhundertachtzig!'); settings.voice = was; };
  $('#sfx').onchange = e => { settings.sfx = e.target.checked; saveSettings(); if (settings.sfx) sfx.hit(); };
  $('#autoNext').onchange = e => { settings.autoNext = e.target.checked; saveSettings(); };
  $('#wake').onchange = e => { settings.wake = e.target.checked; saveSettings(); if (settings.wake) requestWake(); else if (wakeLock) wakeLock.release().catch(() => {}); };
  $('#banter').onchange = e => { settings.banter = e.target.checked; saveSettings(); };
  $('#autoCal').onchange = e => { settings.autoCal = e.target.checked; saveSettings(); };
  $('#learnReset').onclick = () => { settings.learn = Object.assign({}, LEARN0); saveSettings(); $('#learnInfo').textContent = 'Noch nichts gelernt.'; toast('Gelerntes zurückgesetzt'); };
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
    newGame(); showGame(); detector.reset();
    if (G.bull) { say('Ausbullen! Wer am nächsten am Bull ist, beginnt.', G.players[0].name + ', wirf auf Bull.'); toast('Ausbullen: jeder wirft einen Dart auf Bull', 3000); }
    else say('Game on! ' + G.players[0].name + ', wirf an.');
  };
  $('#resumeGame').onclick = () => { sfx.unlock(); showGame(); detector.reset(); };

  // Boot
  buildBoardSvg($('#padBoard'));
  G = store.get('game', null);
  showSetup();
  if (!window.isSecureContext) toast('Hinweis: Für die Kamera muss die App über https:// laufen.', 5000);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Expose for testing
  window.OcheCam = { addDart: (n, m) => addDart(C.dart(n, m), { manual: true }), nextTurn, get game() { return G; }, visitState, detInfo: () => detector.info, det: () => detector };
})();
