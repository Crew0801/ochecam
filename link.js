/* OcheCam link: a second phone as extra camera. Direct WebRTC data channel between the phones (PeerJS);
   the public PeerJS broker is only used to find each other (connection code). */
window.OcheLink = (() => {
  'use strict';
  const LIBS = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
  const PREFIX = 'ochecam-link-v1-';
  const useBC = /[?&]link=bc\b/.test(location.search); // local tests: frames of one browser talk via BroadcastChannel
  const HB_MS = 1500, DEAD_MS = 7000;

  let libP = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  function loadLib() {
    if (window.Peer) return Promise.resolve();
    if (!libP) libP = loadScript(LIBS[0]).catch(() => loadScript(LIBS[1])).catch(e => { libP = null; throw e; });
    return libP;
  }
  const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

  /** Wrap a raw channel: JSON messages, heartbeat, and "dead" detection (a phone that just vanished). */
  function wrap(sendRaw, onDead) {
    let lastRx = Date.now(), closed = false;
    const hb = setInterval(() => {
      if (closed) return;
      sendRaw({ t: 'hb' });
      if (Date.now() - lastRx > DEAD_MS) { w.close(); onDead(); }
    }, HB_MS);
    const w = {
      send(m) { if (!closed) try { sendRaw(m); } catch {} },
      rx() { lastRx = Date.now(); },
      close() { closed = true; clearInterval(hb); },
      get closed() { return closed; }
    };
    return w;
  }

  // ---------- BroadcastChannel (tests only) ----------
  function bcHost(code, h) {
    const ch = new BroadcastChannel('ochecam-link-' + code);
    let peer = null, w = null;
    const drop = () => { if (w) w.close(); w = null; peer = null; h.onClose(); };
    ch.onmessage = e => {
      const x = e.data || {};
      if (x.hello) {
        if (w) w.close();
        peer = x.hello; w = wrap(m => ch.postMessage({ to: peer, m }), drop);
        ch.postMessage({ to: peer, ok: 1 }); h.onOpen(w);
      } else if (w && x.from === peer && x.m) { w.rx(); if (x.m.t !== 'hb') h.onData(x.m); }
    };
    setTimeout(() => h.onReady && h.onReady(), 0);
    return { close() { if (w) w.close(); ch.close(); } };
  }
  function bcJoin(code, h) {
    const ch = new BroadcastChannel('ochecam-link-' + code), id = Math.random().toString(36).slice(2);
    let w = null, dead = false, t = null;
    const hello = () => { if (!dead && !w) { ch.postMessage({ hello: id }); t = setTimeout(hello, 2000); } };
    ch.onmessage = e => {
      const x = e.data || {};
      if (x.to !== id) return;
      if (x.ok && !w) { clearTimeout(t); w = wrap(m => ch.postMessage({ from: id, m }), () => { w = null; h.onClose(); hello(); }); h.onOpen(w); }
      else if (w && x.m) { w.rx(); if (x.m.t !== 'hb') h.onData(x.m); }
    };
    hello();
    return { close() { dead = true; clearTimeout(t); if (w) w.close(); ch.close(); } };
  }

  // ---------- PeerJS ----------
  function peerHost(code, h) {
    let peer = null, conn = null, w = null, dead = false, retryT = null;
    const drop = c => { if (c !== conn) return; if (w) w.close(); conn = null; w = null; h.onClose(); };
    function start() {
      if (dead) return;
      peer = new window.Peer(PREFIX + code, { debug: 0 });
      peer.on('open', () => { h.onError && h.onError(null); h.onReady && h.onReady(); });
      peer.on('connection', c => {
        c.on('open', () => {
          if (conn && conn !== c) { const old = conn; drop(old); try { old.close(); } catch {} }
          conn = c; w = wrap(m => c.send(m), () => { const old = conn; drop(old); try { old && old.close(); } catch {} });
          h.onOpen(w);
        });
        c.on('data', m => { if (c === conn && w) { w.rx(); if (m && m.t !== 'hb') h.onData(m); } });
        c.on('close', () => drop(c));
        c.on('error', () => {});
      });
      peer.on('disconnected', () => { if (!dead && !peer.destroyed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }, 2000); });
      peer.on('error', e => {
        if (dead) return;
        h.onError && h.onError(e.type);
        if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
          try { peer.destroy(); } catch {}
          clearTimeout(retryT); retryT = setTimeout(start, 4000);
        }
      });
    }
    loadLib().then(start, () => h.onError && h.onError('lib'));
    return { close() { dead = true; clearTimeout(retryT); if (w) w.close(); try { peer && peer.destroy(); } catch {} } };
  }
  function peerJoin(code, h) {
    let peer = null, conn = null, w = null, dead = false, retryT = null, openT = null;
    function retry(ms) { clearTimeout(retryT); clearTimeout(openT); if (!dead) retryT = setTimeout(connect, ms); }
    function connect() {
      if (dead || (conn && conn.open)) return;
      if (!peer || peer.destroyed) {
        peer = new window.Peer({ debug: 0 });
        peer.on('open', connect);
        peer.on('disconnected', () => { if (!dead && !peer.destroyed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }, 2000); });
        peer.on('error', e => {
          if (dead) return;
          h.onError && h.onError(e.type);
          if (e.type === 'peer-unavailable') retry(3000);
          else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) { try { peer.destroy(); } catch {} retry(4000); }
        });
        return;
      }
      if (!peer.open) return;
      const c = conn = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
      openT = setTimeout(() => { if (!c.open) { try { c.close(); } catch {} h.onError && h.onError('timeout'); retry(1000); } }, 15000);
      c.on('open', () => {
        clearTimeout(openT); h.onError && h.onError(null);
        w = wrap(m => c.send(m), () => { try { c.close(); } catch {} lost(c); });
        h.onOpen(w);
      });
      c.on('data', m => { if (c === conn && w) { w.rx(); if (m && m.t !== 'hb') h.onData(m); } });
      c.on('close', () => lost(c));
      c.on('error', () => {});
    }
    function lost(c) {
      if (c !== conn) return;
      const was = !!w; if (w) w.close(); w = null; conn = null;
      if (was) h.onClose();
      retry(2000);
    }
    loadLib().then(connect, () => { h.onError && h.onError('lib'); retry(5000); });
    return { close() { dead = true; clearTimeout(retryT); clearTimeout(openT); if (w) w.close(); try { peer && peer.destroy(); } catch {} } };
  }

  return {
    newCode,
    /** Main phone: wait for a second camera under this code. */
    host: (code, h) => useBC ? bcHost(code, h) : peerHost(code, h),
    /** Second phone: connect to the main phone with this code (keeps retrying). */
    join: (code, h) => useBC ? bcJoin(code, h) : peerJoin(code, h),
    loadQr: () => window.qrcode ? Promise.resolve() : loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js')
  };
})();
