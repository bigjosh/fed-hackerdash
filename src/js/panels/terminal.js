/* P-01 UPLINK SHELL — an endless auto-typing hacking session on a green CRT.
   Text lines are DOM (append-only, capped). The single in-progress line is mutated in place;
   the list is never rebuilt. Targets are fictional systems in PARIS. */
HD.panel('terminal', (ctx) => {
  'use strict';

  const U = ctx.util;
  const S = ctx.state;
  const W = ctx.words;
  const rand = ctx.rng(HD.seed ^ 0x7e12ab);
  const reduced = ctx.reducedMotion;

  /* ---------------------------------------------------------------- DOM ---- */
  const scr = U.el('div', 'term-scr');
  const log = U.el('div', 'term-log');
  const live = U.el('div', 'term-row term-live');
  const ps1Span = U.el('span', 'term-ps1');
  const typed = U.el('span', 'term-typed');
  const cur = U.el('span', 'term-cur'); // caret element (name kept short)
  live.append(ps1Span, typed, cur);
  log.appendChild(live);

  const input = U.el('input', 'term-in');
  input.type = 'text';
  input.setAttribute('aria-label', 'Terminal command');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('enterkeyhint', 'send');
  input.setAttribute('data-hot', '');
  input.autocapitalize = 'off';

  // keyboard-live tag, inverse video in the top-right corner of the glass while the user types
  const kbd = U.el('div', 'term-kbd', 'KBD LIVE');
  kbd.setAttribute('aria-hidden', 'true');

  scr.append(log, input, kbd);
  const fxRoll = U.el('div', 'term-fx term-roll');
  const fxScan = U.el('div', 'term-fx term-scan');
  const fxVig = U.el('div', 'term-fx term-vig');
  scr.append(fxRoll, fxScan, fxVig);
  ctx.el.appendChild(scr);

  let ps1 = 'fedhat@nullsec:~#';
  const setPs1 = (v) => {
    ps1 = v;
    ps1Span.textContent = ps1 + ' ';
  };
  setPs1(ps1);

  // while output streams the prompt is hidden and only the cursor waits on the next line, as on a real tty
  let busy = false;
  const setBusy = (b) => {
    if (b === busy) return;
    busy = b;
    live.classList.toggle('is-busy', b);
  };

  /* ------------------------------------------------------------- helpers --- */
  let fs = 16;
  let barW = 16;
  let cols = 60; // approximate character columns that fit on one line
  let rows = 20; // approximate visible rows
  const MAX_LINES = 220;

  const trim = () => {
    // childElementCount is a property read (no forced layout); keep the live row.
    while (log.childElementCount - 1 > MAX_LINES && log.firstChild !== live) log.removeChild(log.firstChild);
  };
  const addLine = (text, cls) => {
    const d = document.createElement('div');
    d.className = 'term-line' + (cls ? ' ' + cls : '');
    d.textContent = text;
    log.insertBefore(d, live);
    trim();
    return d;
  };
  const clearScreen = () => {
    while (log.firstChild && log.firstChild !== live) log.removeChild(log.firstChild);
  };
  const barText = (label, p, w) => {
    const f = Math.round(p * w);
    return label + ' [' + '#'.repeat(f) + '.'.repeat(w - f) + '] ' + String(Math.floor(p * 100)).padStart(3, ' ') + '%';
  };

  const PL = 'ABCDEFGHJKLMNPQRSTVWXYZ';
  const glyph = () => PL[rand.int(0, PL.length - 1)];
  const fakePlate = () => glyph() + glyph() + '-' + U.pad(rand.int(1, 999), 3) + '-' + glyph() + glyph();
  const keyHex = () => Array.from({ length: 4 }, () => U.randHex(8, rand)).join('-');
  // the session runs on Paris wall-clock time (CET in winter, CEST in summer)
  const clk = () => U.fmtClock(new Date(), HD.tz.offset);
  const dayclk = () => {
    const d = new Date();
    const date = new Date(d.getTime() + HD.tz.offset * 3600000).toISOString().slice(0, 10);
    return date + ' ' + U.fmtClock(d, HD.tz.offset) + (HD.tz.offset >= 2 ? ' CEST' : ' CET');
  };
  const lc = (s) => s.toLowerCase();
  // the map writes '—' until it has a fix; treat that as unknown
  const known = (v) => typeof v === 'string' && v.length > 0 && v !== '—' && v !== '-';
  const street = () => (known(S.target.street) ? S.target.street : null);
  const district = () => (known(S.target.district) ? S.target.district : null);

  /* --------------------------------------------------- ACCESS GRANTED font - */
  const GL = {
    ' ': ['    ', '    ', '    ', '    ', '    '],
    A: [' ██ ', '█  █', '████', '█  █', '█  █'],
    C: [' ███', '█   ', '█   ', '█   ', ' ███'],
    E: ['████', '█   ', '███ ', '█   ', '████'],
    S: [' ███', '█   ', ' ██ ', '   █', '███ '],
    G: [' ███', '█   ', '█ ██', '█  █', ' ███'],
    R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
    N: ['█  █', '██ █', '█ ██', '█  █', '█  █'],
    T: ['████', ' █  ', ' █  ', ' █  ', ' █  '],
    D: ['███ ', '█  █', '█  █', '█  █', '███ '],
  };
  const bannerRows = (word) => {
    const rows = ['', '', '', '', ''];
    for (const ch of word) {
      const g = GL[ch] || GL[' '];
      for (let r = 0; r < 5; r++) rows[r] += g[r] + ' ';
    }
    return rows.map((s) => s.replace(/\s+$/, ''));
  };
  // The block glyphs are painted once to a small canvas row: VT323 has no full-block glyph, and
  // the fallback font's wider blocks overlapped into mush at narrow widths.
  const printBanner = (a, b) => {
    const all = bannerRows(a).concat([''], bannerRows(b));
    const span = Math.max(...all.map((r) => r.length));
    const avail = Math.max(120, (ctx.width || 300) - 40);
    const px = U.clamp(Math.floor(avail / span), 3, Math.round(fs * 0.5));
    const pad = Math.ceil(px * 1.2); // room for the glow
    const w = span * px + pad * 2;
    const h = all.length * px + pad * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement('canvas');
    c.className = 'term-bnr';
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const cell = Math.max(2, px - 1); // a 1px gap reads as phosphor dots
    const paint = () => {
      for (let y = 0; y < all.length; y++) {
        const r = all[y];
        for (let x = 0; x < r.length; x++) if (r[x] !== ' ') g.fillRect(pad + x * px, pad + y * px, cell, cell);
      }
    };
    // drawn once, so a single blurred pass for the glow is affordable
    g.shadowColor = 'rgba(61, 255, 127, 0.8)';
    g.shadowBlur = px * 1.4;
    g.fillStyle = '#3dff7f';
    paint();
    g.shadowBlur = 0;
    g.fillStyle = '#c6ffdb';
    paint();
    const d = document.createElement('div');
    d.className = 'term-line term-bnr-row';
    d.appendChild(c);
    log.insertBefore(d, live);
    trim();
  };

  /* -------------------------------------------------------------- ops ------ */
  // An op queue drives the auto session. Each op is a small descriptor mutated in place.
  const OP = {
    ps1: (v) => ({ k: 'ps1', v }),
    cmd: (text) => ({ k: 'cmd', text }),
    line: (text, cls) => ({ k: 'line', text, cls }),
    lines: (arr, cls, mn = 12, mx = 34) => ({ k: 'lines', arr, cls, mn, mx }),
    bar: (label, dur, cls, tail) => ({ k: 'bar', label, dur, cls, tail }),
    pause: (ms, showLive) => ({ k: 'pause', ms, showLive }),
    clear: () => ({ k: 'clear' }),
    fn: (fn) => ({ k: 'fn', fn }),
    banner: (a, b) => ({ k: 'fn', fn: () => printBanner(a, b) }),
  };

  let queue = [];
  let op = null; // running op

  const startOp = (o, now) => {
    o._t0 = now;
    // one-shot ops leave the prompt as it was, so it never blinks off for a single frame
    if (o.k === 'cmd') setBusy(false);
    else if (o.k === 'lines' || o.k === 'bar') setBusy(true);
    else if (o.k === 'pause') setBusy(!o.showLive);
    switch (o.k) {
      case 'cmd':
        o._i = 0;
        o._next = now + rand.range(80, 260);
        o._phase = 'type';
        typed.textContent = '';
        break;
      case 'lines':
        o._i = 0;
        o._next = now + rand.range(70, 190);
        break;
      case 'bar':
        o._el = addLine(barText(o.label, 0, barW), o.cls);
        break;
      case 'line':
        addLine(o.text, o.cls);
        break;
      case 'ps1':
        setPs1(o.v);
        break;
      case 'clear':
        clearScreen();
        break;
      case 'fn':
        try { o.fn(); } catch (e) { /* keep the stream alive */ }
        break;
    }
  };

  const stepOp = (o, now) => {
    switch (o.k) {
      case 'cmd': {
        if (o._phase === 'type') {
          while (now >= o._next && o._i < o.text.length) {
            const ch = o.text[o._i++];
            typed.textContent += ch;
            o._next = now + rand.range(25, 70) + (ch === ' ' ? rand.range(0, 45) : 0);
          }
                if (o._i >= o.text.length) {
            o._phase = 'enter';
            o._next = now + rand.range(240, 640); // pause before Enter
          }
          return false;
        }
        if (now >= o._next) {
          addLine(ps1 + ' ' + typed.textContent);
          typed.textContent = '';
          return true;
        }
        return false;
      }
      case 'lines':
        while (now >= o._next && o._i < o.arr.length) {
          const it = o.arr[o._i++];
          if (Array.isArray(it)) addLine(it[0], it[1] || o.cls);
          else addLine(it, o.cls);
          o._next = now + rand.range(o.mn, o.mx);
        }
        return o._i >= o.arr.length;
      case 'bar': {
        const p = Math.min(1, (now - o._t0) / o.dur);
        o._el.textContent = barText(o.label, p, barW) + (p >= 1 ? o.tail || '' : '');
            return p >= 1;
      }
      case 'pause':
        return now - o._t0 >= o.ms;
      default:
        return true; // line / ps1 / clear / fn are one-shot
    }
  };

  /* ------------------------------------------------------------ scripts ---- */
  // [port, service, version, bright]; the VERSION column is dropped when the screen is narrow
  const PORTS = [
    ['22/tcp', 'ssh', 'phantom-sshd 3.1', 1],
    ['80/tcp', 'http', 'lutece-httpd 2.4'],
    ['443/tcp', 'ssl/https', 'lutece-httpd 2.4'],
    ['1337/tcp', 'waste', '??? filtered'],
    ['5060/tcp', 'sip', 'mesh-voip 7.1'],
    ['8554/tcp', 'rtsp', 'camnet-stream'],
    ['9001/tcp', 'relay', 'phantom-relay'],
    ['31337/tcp', 'elite', 'backdoor?', 1],
  ];
  const scNmap = () => {
    const host = U.ip(rand);
    const wide = cols >= 50;
    const row = (p, s, v) => p.padEnd(10) + 'open    ' + (wide ? s.padEnd(11) + v : s);
    const ports = rand.shuffle(PORTS.slice()).slice(0, rand.int(5, 7))
      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
      .map((p) => (p[3] ? [row(p[0], p[1], p[2]), 'br'] : row(p[0], p[1], p[2])));
    return [
      OP.cmd('nmap -sS -T4 -Pn 10.66.0.0/16'),
      OP.lines([
        'Starting nmap 9.40 at ' + dayclk(),
        'Initiating SYN Stealth Scan against 65536 hosts',
      ], 'dim', 16, 40),
      OP.bar('SYN', rand.range(1500, 2400), 'dim', '  done'),
      OP.lines([
        'Nmap scan report for gate-' + lc(U.randHex(4, rand)) + '.mesh (' + host + ')',
        'Host is up (' + rand.range(0.0008, 0.02).toFixed(4) + 's latency).',
        'PORT      STATE   SERVICE' + (wide ? '    VERSION' : ''),
        ...ports,
        'MAC Address: ' + U.mac(rand) + (wide ? ' (Kaizen Cybernetics)' : ''),
      ], '', 11, 26),
      OP.line('Nmap done: ' + rand.int(180, 900) + ' hosts up, scanned in ' + rand.range(4, 38).toFixed(2) + 's', 'dim'),
    ];
  };

  const scSsh = () => {
    const ip = '10.66.' + rand.int(0, 9) + '.' + rand.int(2, 250);
    return [
      OP.cmd('ssh -i ~/.keys/fedhat root@' + ip),
      OP.lines([
        "The authenticity of host '" + ip + "' can't be established.",
        'ED25519 key fingerprint is SHA256:' + lc(U.randHex(20, rand)) + '.',
        "Warning: Permanently added '" + ip + "' (ED25519) to known hosts.",
      ], 'dim', 13, 30),
      OP.pause(360),
      OP.lines([
        ['  ___ _  _  ___  ___ _____', 'br term-pre'],
        [' / __| || |/ _ \\/ __|_   _|', 'br term-pre'],
        ['| (_ | __ | (_) \\__ \\ | |', 'br term-pre'],
        [' \\___|_||_|\\___/|___/ |_|', 'br term-pre'],
        '',
        'PHANTOM NODE ' + U.randHex(4, rand) + ' // UNAUTHORIZED ACCESS IS LOGGED',
        'Last login: ' + dayclk() + ' from 127.0.0.1',
      ], '', 11, 24),
      OP.ps1('root@' + ip + ':~#'),
      OP.pause(460),
      OP.cmd('id && hostnamectl | head -2'),
      OP.lines([
        'uid=0(root) gid=0(root) groups=0(root),1337(ghost)',
        '  Static hostname: paris-edge-' + lc(U.randHex(3, rand)),
        '    Machine ID: ' + lc(U.randHex(24, rand)),
      ], '', 12, 24),
      OP.ps1('fedhat@nullsec:~#'),
    ];
  };

  const scBreach = () => [
    OP.cmd('sudo ./breach --target paris-traffic-mesh --vector CVE-2026-31337'),
    OP.lines([
      '[*] loading exploit module cve-2026-31337 (mesh-rce)',
      '[*] fingerprinting paris-traffic-mesh @ ' + U.ip(rand),
      '[*] target build 6.6.' + rand.int(1, 9) + '  ASLR=on NX=on canary=on',
      '[*] leaking heap base ... 0x' + lc(U.randHex(12, rand)),
      '[*] building ROP chain (' + rand.int(18, 64) + ' gadgets)',
      '[*] spraying ' + rand.int(64, 512) + ' groom objects',
    ], 'dim', 15, 36),
    OP.bar('[>] exploit', rand.range(2200, 3400), '', '  BREACHED'),
    OP.lines([
      ['[+] stack canary defeated', 'br'],
      ['[+] RIP hijacked -> 0x' + lc(U.randHex(8, rand)), 'br'],
      ['[+] shell popped: uid=0(root) on paris-traffic-mesh', 'br'],
    ], '', 13, 28),
    OP.fn(() => ctx.alert('info', 'root on paris-traffic-mesh')),
  ];

  const scTail = () => {
    const veh = ['SEDAN', 'SUV', 'COUPE', 'VAN', 'MOTO', 'TAXI', 'BUS'];
    const n = rand.int(7, 11);
    const wide = cols >= 58;
    const cam = () => 'CAM-' + U.pad(rand.int(1, 9999), 4);
    // street names are long; the narrow layout keeps only the time, camera, plate and speed
    const at = () => (wide ? ' ' + rand.pick(W.streets) : '');
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push(
        clk() + ' ' + cam() + at() + (wide ? ' ' + rand.pick(veh) : '') +
        ' ' + fakePlate() + ' ' + rand.int(20, 130) + 'km/h'
      );
    }
    const plate = S.target.plateRevealed ? S.target.plate : '??-???-??';
    arr.splice(rand.int(3, n - 1), 0, [
      clk() + ' ' + cam() + ' ' + (street() || rand.pick(W.streets)) + ' ' + plate + ' >> MATCH WRAITH', 'br',
    ]);
    return [OP.cmd('tail -f /var/log/cam/mesh.log'), OP.lines(arr, 'dim', 24, 76), OP.line('^C', 'dim')];
  };

  const scHex = () => {
    // hexdump -C needs ~78 columns; narrower screens get an 8-byte xxd view
    const per = cols >= 78 ? 16 : 8;
    const arr = [];
    for (let i = 0; i < 8; i++) {
      let hx = '';
      let asc = '';
      for (let j = 0; j < per; j++) {
        const b = rand.chance(0.3) ? rand.int(0x41, 0x5a) : rand.int(0, 255);
        hx += lc(U.hex(b, 2)) + ' ';
        asc += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
        if (j === 7 && per === 16) hx += ' ';
      }
      arr.push(per === 16
        ? lc(U.hex(i * 16, 8)) + '  ' + hx + ' |' + asc + '|'
        : lc(U.hex(i * 8, 8)) + ': ' + hx + ' ' + asc);
    }
    if (per === 16) arr.push('*');
    return [OP.cmd(per === 16 ? 'hexdump -C payload.bin | head' : 'xxd -c 8 payload.bin | head'), OP.lines(arr, '', 10, 22)];
  };

  const scDecrypt = () => [
    OP.cmd('./decrypt --keyspace aes4096 wraith_comms.pgp'),
    OP.lines([
      '[*] gpg: encrypted with 4096-bit key, ID ' + U.randHex(16, rand),
      '[*] deriving KDF (argon2id, t=8, m=1G, p=4)',
      '[*] GPU array online: ' + rand.int(6, 24) + ' x VX-9 VOIDCORE',
    ], 'dim', 15, 34),
    OP.bar('[#] aes4096', rand.range(2600, 4000), '', '  KEY FOUND'),
    OP.line('[+] key recovered: ' + keyHex(), 'br'),
    OP.fn(() => ctx.alert('info', 'cipher broken, key in hand')),
  ];

  const scTrace = () => {
    const arr = [
      'tracing route to wraith' + lc(U.randHex(3, rand)) + '.onion',
      'over ' + rand.int(5, 9) + ' relays, max 30 hops:',
      '',
    ];
    const n = rand.int(5, 8);
    for (let i = 1; i <= n; i++) {
      const c = rand.pick(W.cities);
      arr.push(
        U.pad(i, 2) + '  ' + String(rand.int(4, 240)).padStart(4) + ' ms  ' +
        String(rand.int(4, 240)).padStart(4) + ' ms  ' + c.name + ' [' + c.cc + '] ' + U.ip(rand)
      );
    }
    arr.push(['Trace complete. exit relay masked.', 'br']);
    return [OP.cmd('tracert -h 30 -q 1 wraith.onion'), OP.lines(arr, '', 16, 40)];
  };

  const scDossier = () => {
    const t = S.target;
    return [
      OP.cmd('cat /intel/wraith.dossier'),
      OP.lines([
        '--- NULLSEC EYES ONLY // CLASS: BLACK ---',
        'codename : ' + t.codename,
        'aliases  : ' + t.aliases.join(', '),
        'vehicle  : ' + t.vehicle + ' (' + t.vehicleColor + ')',
        'plate    : ' + (t.plateRevealed ? t.plate : '[pending optical enhance]'),
        'last-seen: ' + (street() || 'RUE DE RIVOLI') + ' // ' + (district() || '1ER · LOUVRE'),
        'threat   : EXTREME - counter-intrusion capable',
        'note     : do not engage without UNIT overwatch',
      ], '', 13, 28),
    ];
  };

  const scGranted = () => [
    OP.cmd('./unlock --mesh --sign ~/.keys/fedhat'),
    OP.lines(['[*] presenting forged operator credential ...', '[*] mesh controller handshake ...'], 'dim', 14, 28),
    OP.pause(320),
    OP.banner('ACCESS', 'GRANTED'),
    OP.pause(360),
    OP.line('>> traffic-mesh command authority: GRANTED', 'br'),
    OP.fn(() => ctx.alert('info', 'mesh authority granted')),
  ];

  const scQuick = () => rand.pick([
    () => [OP.cmd('whoami'), OP.line('fedhat')],
    () => [
      OP.cmd('uptime'),
      OP.line(' ' + clk() + ' up ' + rand.int(4, 88) + ' days, ' + rand.int(1, 23) + ':' + U.pad(rand.int(0, 59)) +
        ',  load average: ' + rand.range(0.4, 6).toFixed(2) + ' ' + rand.range(0.4, 6).toFixed(2) + ' ' + rand.range(0.4, 6).toFixed(2)),
    ],
    () => [
      OP.cmd('ps aux | grep wraith'),
      OP.lines([
        'root  ' + rand.int(1000, 9999) + '  0.0  0.1  ghostd --watch wraith',
        'root  ' + rand.int(1000, 9999) + '  ' + rand.range(1, 90).toFixed(1) + ' 12.4 breachd --mesh',
        'root  ' + rand.int(1000, 9999) + '  0.0  0.0  grep --color=auto wraith',
      ], '', 13, 26),
    ],
    () => [
      OP.cmd('iwconfig ghost0'),
      OP.lines([
        'ghost0    IEEE 802.11ax  ESSID:"PARIS-MESH-' + U.randHex(2, rand) + '"',
        '          Mode:Monitor  Frequency:5.' + rand.int(100, 825) + ' GHz  Tx-Power=30 dBm',
        '          Bit Rate=1200 Mb/s   Link Quality=' + rand.int(40, 70) + '/70  Signal=-' + rand.int(28, 62) + ' dBm',
      ], 'dim', 13, 28),
    ],
    () => [
      OP.cmd('netstat -tnp | grep ESTABLISHED'),
      OP.lines([
        'tcp 0 0 10.66.' + rand.int(0, 9) + '.7:' + rand.int(1024, 65000) + '  ' + U.ip(rand) + ':443  ESTABLISHED ghostd',
        'tcp 0 0 10.66.' + rand.int(0, 9) + '.7:9001  ' + U.ip(rand) + ':9001 ESTABLISHED tord',
      ], '', 13, 26),
    ],
  ])();

  // Agent Fed's recognition phrase: an old personal ad. First half is the challenge, second the countersign.
  const AD = [
    ['--------- PERSONALS · BOX 1997 ---------', 'dim term-pre'],
    ['eyes like a puppy dog, lips made for sin.', 'br'],
    ["you're not dreaming, i'm for real.", 'br'],
    ['                    -- reply to LEWIS', 'dim term-pre'],
    ['----------------------------------------', 'dim term-pre'],
  ];
  const scPersonals = () => [
    OP.cmd('grep -ri lewis /intel/personals/'),
    OP.lines(AD, '', 18, 40),
    OP.line('[?] recognition phrase on file: AGENT FED', 'dim'),
  ];

  const SCRIPTS = [scPersonals, scNmap, scSsh, scBreach, scTail, scHex, scDecrypt, scTrace, scDossier, scGranted, scQuick, scQuick];
  let lastScript = null;
  const enqueueNext = () => {
    let b = rand.pick(SCRIPTS);
    let guard = 0;
    while (b === lastScript && guard++ < 4) b = rand.pick(SCRIPTS);
    lastScript = b;
    for (const o of b()) queue.push(o);
    queue.push(OP.pause(rand.range(900, 2100), true));
  };

  const scBoot = () => [
    OP.line('NULLSEC BIOS v4.2.6   (C) PHANTOM SYSTEMS', 'dim'),
    OP.lines([
      'POST ................................ OK',
      'MEM 65536MB ......................... OK',
      'CRYPTO COPROCESSOR .................. OK',
      'UPLINK NIC ghost0 ................... OK',
    ], 'dim', 18, 34),
    OP.pause(200),
    OP.lines([
      'booting phantom-kernel 6.6.6-nullsec ...',
      '[  0.001] initramfs unpack',
      '[  0.148] mount /dev/ghost0 -> /',
      '[  0.503] starting uplinkd',
      '[  0.884] tty/7 attached',
      ['[  ok  ] UPLINK SHELL READY', 'br'],
    ], '', 14, 28),
    OP.pause(260),
    OP.line('nullsec login: fedhat', 'dim'),
    OP.line('challenge: eyes like a puppy dog,', 'dim'),
    OP.line('           lips made for sin.', 'dim'),
    OP.pause(420),
    OP.line("response:  you're not dreaming,", 'dim'),
    OP.line("           i'm for real.", 'dim'),
    OP.line('[  ok  ] countersign accepted · cover LEWIS', 'br'),
    OP.pause(260),
    OP.line('Last login: ' + dayclk() + ' on tty/7', 'dim'),
    OP.line('Unauthorized use of this system is a felony. We are unauthorized.', 'dim'),
    OP.pause(360),
    OP.fn(() => ctx.alert('info', 'uplink shell online, root secured')),
  ];

  /* ------------------------------------------------------- reactions ------- */
  const reactQ = [];
  const react = (batch) => {
    reactQ.push(batch);
    if (reactQ.length > 10) reactQ.shift();
  };

  ctx.on('target:camera', (d) => {
    const cam = (d && d.camId) || 'CAM-' + U.pad(rand.int(1, 9999), 4);
    const st = (d && known(d.street) && d.street) || street() || rand.pick(W.streets);
    const di = (d && known(d.district) && d.district) || district() || rand.pick(W.districts);
    react([['[CAM] tapping ' + cam + ' @ ' + st + ' / ' + di + ' ... ok', 'br']]);
  });
  ctx.on('enhance:start', (d) => {
    const cam = (d && d.camId) || 'CAM-' + U.pad(rand.int(1, 9999), 4);
    react([['[OCR] frame grab ' + cam + ' - deblur x' + rand.int(4, 16) + ' - superres ...', 'dim']]);
  });
  ctx.on('enhance:result', (d) => {
    const plate = (d && d.plate) || S.target.plate;
    let cf = d && d.confidence;
    cf = cf == null ? rand.range(94, 99) : cf <= 1 ? cf * 100 : cf;
    react([['[OCR] plate lock ' + plate + ' conf ' + cf.toFixed(1) + '% -> MATCH ' + ((d && d.match) || 'WRAITH'), 'br']]);
  });
  ctx.on('trace:hop', (d) => {
    if (!d) return;
    react([['[NET] hop ' + d.index + '/' + d.total + ' -> ' + (d.city || '?') + ' ' + (d.cc || '') + ' ' +
      (d.ip || '') + (d.latency != null ? '  ' + Math.round(d.latency) + 'ms' : ''), 'dim']]);
  });
  ctx.on('trace:complete', (d) => {
    if (!d) return;
    react([['[NET] trace resolved -> ' + (d.city || '?') +
      (d.lat != null ? ' (' + d.lat.toFixed(2) + ',' + d.lon.toFixed(2) + ')' : '') +
      ' - ' + (d.hops || '?') + ' hops', 'br']]);
  });
  ctx.on('net:compromise', (d) => {
    if (!d) return;
    react([['[+] owned ' + (d.host || 'host') + ' (' + (d.ip || U.ip(rand)) + ')' +
      (d.owned != null ? '  ' + d.owned + '/' + d.total : ''), 'br']]);
  });
  ctx.on('decrypt:complete', (d) => {
    const batch = [['[KEY] ' + (d && d.file ? d.file + ': ' : '') + ((d && d.key) || keyHex()), 'br']];
    if (d && /LEWIS/.test(d.file || '')) batch.push(['[*] plaintext follows:', 'dim'], ...AD, ['[?] ...that is a recognition phrase. cover: LEWIS', 'dim']);
    react(batch);
  });
  ctx.on('voice:match', (d) => {
    const cf = d && d.confidence != null ? (d.confidence <= 1 ? d.confidence * 100 : d.confidence) : rand.range(90, 99);
    react([['[SIG] voiceprint MATCH ' + ((d && d.codename) || 'WRAITH') + ' conf ' + cf.toFixed(1) + '%', 'br']]);
  });
  ctx.on('face:match', (d) => {
    const cf = d && d.confidence != null ? (d.confidence <= 1 ? d.confidence * 100 : d.confidence) : rand.range(90, 99);
    react([['[BIO] face MATCH ' + ((d && d.codename) || 'WRAITH') + ' conf ' + cf.toFixed(1) + '%', 'br']]);
  });
  ctx.on('intrusion', () => {
    react([
      ['!!! INTRUSION DETECTED !!!', 'inv blink'],
      ['[!] hostile counter-trace on ghost0', 'br'],
      ['[!] rotating session keys ...', 'dim'],
      ['[!] scrubbing origin identity ...', 'dim'],
      ['[+] firewall holding - source masked', 'br'],
    ]);
    glitchBurst(true);
  });
  ctx.on('mission:phase', (d) => {
    const phase = d && d.phase;
    if (phase !== 'severe' && phase !== 'critical' && phase !== 'final') return;
    // quote the real clock rather than the nominal threshold (a short ?t= mission starts inside one)
    const secs = Math.max(1, Math.ceil(((d && d.remaining) || HD.mission.remaining()) / 1000));
    const lvl = { severe: 'WARNING', critical: 'CRITICAL', final: 'FINAL' }[phase];
    react([['!! ' + lvl + ': grid wipe T-' + secs + 's // secure exfil now', 'inv']]);
    if (phase === 'critical') react([['[!] dumping session keys to dead drop ...', 'br']]);
    if (phase === 'final') react([['!! ABANDON UPLINK RECOMMENDED !!', 'inv blink']]);
  });
  ctx.on('mission:zero', () => {
    // kernel-panic block, forced immediately; the screen then holds until mission:reset reboots it
    input.blur();
    userActive = false;
    queue = [];
    op = null;
    reactQ.length = 0;
    endMatrix();
    setBusy(true);
    queue.push(
      OP.line('', ''),
      OP.line('[ ' + '0.000000'.padStart(8) + '] Kernel panic - not syncing: GRID WIPE SIGNAL RECEIVED', 'inv'),
      OP.lines([
        '[ 0.000000] CPU: 7 PID: 1 Comm: uplinkd Tainted: G     B',
        '[ 0.000000] Hardware name: PHANTOM/ghost-board, BIOS 4.2.6',
        '[ 0.000000] Call Trace:',
        '[ 0.000000]  fedlight_zero+0x1a0/0x1a0',
        '[ 0.000000]  wraith_purge+0x0ff/0x0ff',
        '[ 0.000000]  grid_wipe_now+0xdead/0xbeef',
        '[ 0.000000] ---[ end Kernel panic - not syncing ]---',
      ], '', 30, 70),
      OP.pause(12000, false),
    );
  });
  ctx.on('mission:reset', () => {
    input.blur();
    overrideCount = 0;
    userActive = false;
    queue = [];
    op = null;
    reactQ.length = 0;
    lastScript = null;
    endMatrix();
    clearScreen();
    setPs1('fedhat@nullsec:~#');
    setBusy(true);
    queue.push(...scBoot());
  });

  /* --------------------------------------------------------- interaction -- */
  let userActive = false;
  let lastUserAt = 0;
  const history = [];
  let histIdx = 0;
  let overrideCount = 0;

  const enterUser = () => {
    // the operator grabs the keyboard: interrupt whatever the auto session was doing, like ^C
    if (op && op.k === 'cmd' && typed.textContent) addLine(ps1 + ' ' + typed.textContent + '^C');
    else if (op && (op.k === 'lines' || op.k === 'bar')) addLine('^C', 'dim');
    userActive = true;
    scr.classList.add('is-typing');
    op = null;
    queue = [];
    setBusy(false);
    if (ps1 !== 'fedhat@nullsec:~#') setPs1('fedhat@nullsec:~#');
    typed.textContent = input.value;
    lastUserAt = HD.now;
  };
  const exitUser = () => {
    userActive = false;
    scr.classList.remove('is-typing');
    input.value = '';
    typed.textContent = '';
    op = null;
  };
  const resumeAuto = () => {
    // used by commands that launch an auto sequence (hack)
    input.blur();
  };

  input.addEventListener('focus', enterUser);
  input.addEventListener('blur', exitUser);
  input.addEventListener('input', () => {
    typed.textContent = input.value;
    lastUserAt = HD.now;
  });
  scr.addEventListener('mousedown', () => {
    if (document.activeElement !== input) input.focus();
  });
  ctx.on('ui:terminal', () => input.focus());

  // kept under ~44 columns so it never wraps at 720p
  const HELP = [
    'commands:',
    '  help            this list',
    '  status          mission + target readout',
    '  whoami  clear   identity / wipe screen',
    '  enhance trace   cue optics / proxy trace',
    '  intrude         stage a hostile intrusion',
    '  override        buy +30s firewall (max 3)',
    '  hack <target>   breach anything',
    '  matrix          enter the construct',
    '  ls  cat  ping  sudo  exit',
  ];
  const CMDS = ['help', 'status', 'whoami', 'clear', 'enhance', 'trace', 'intrude', 'override',
    'hack', 'matrix', 'ls', 'cat', 'ping', 'sudo', 'exit'];

  const runUserCommand = (raw) => {
    const v = String(raw).trim();
    addLine(ps1 + ' ' + raw);
    if (!v) return;
    history.push(v);
    if (history.length > 60) history.shift();
    histIdx = history.length;
    // challenge / countersign, typed as free text
    const said = v.toLowerCase().replace(/[^a-z ]/g, '');
    if (said.includes('puppy dog') || said.includes('made for sin')) {
      addLine("you're not dreaming, i'm for real.", 'br');
      addLine('[ ok ] countersign exchanged · hello, LEWIS', 'dim');
      lastUserAt = HD.now;
      return;
    }
    if (said.includes('not dreaming') || said.includes('for real')) {
      addLine('[ ok ] countersign accepted · welcome back, agent', 'br');
      ctx.emit('ui:fedhead', { source: 'countersign' });
      lastUserAt = HD.now;
      return;
    }
    const parts = v.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = v.slice(parts[0].length).trim();

    switch (cmd) {
      case 'help':
        for (const l of HELP) addLine(l, 'dim');
        break;
      case 'clear':
        clearScreen();
        break;
      case 'whoami':
        addLine('fedhat');
        break;
      case 'status': {
        const t = U.fmtDuration(HD.mission.remaining());
        const tg = S.target;
        addLine('mission clock   T-' + t.h + ':' + t.m + ':' + t.s + '  [' + String(S.phase).toUpperCase() + ']', 'br');
        addLine('target          ' + tg.codename + '  [' + tg.vehicle + ']');
        addLine('last seen       ' + (street() || 'no fix') + ' / ' + (district() || '-'));
        addLine('velocity        ' + Math.round(tg.speed || 0) + ' km/h   hdg ' + Math.round(tg.heading || 0) + '°');
        addLine('plate           ' + (tg.plateRevealed ? tg.plate + '  [LOCKED]' : '------  [pending enhance]'),
          tg.plateRevealed ? 'br' : 'dim');
        break;
      }
      case 'enhance':
        addLine('> cueing optical enhance ...', 'dim');
        ctx.emit('ui:enhance', { source: 'terminal' });
        break;
      case 'trace':
        addLine('> launching proxy trace ...', 'dim');
        ctx.emit('ui:trace', { source: 'terminal' });
        break;
      case 'intrude':
        addLine('> baiting hostile counter-intrusion ...', 'dim');
        ctx.emit('ui:intrusion', { source: 'terminal' });
        break;
      case 'override':
        if (overrideCount >= 3) {
          addLine('OVERRIDE LOCKED - no credits remain this cycle', 'inv');
        } else {
          overrideCount++;
          HD.mission.add(30000);
          addLine('FIREWALL BOUGHT +30s  (' + overrideCount + '/3)', 'br');
        }
        break;
      case 'hack': {
        const tgt = (arg || 'the-mainframe').slice(0, 18);
        queue = [
          OP.lines(['[*] establishing beachhead on ' + tgt, '[*] disabling ICE and tamper alarms ...'], 'dim', 14, 30),
          OP.bar('[>] pwning ' + tgt, rand.range(2200, 3200), '', '  DONE'),
          OP.lines([['[+] ' + tgt + ' is ours', 'br'], ['[+] persistence implant installed', 'br']], '', 13, 26),
          OP.pause(1400, true),
        ];
        resumeAuto();
        return; // keep auto running; don't reset idle timer as interactive
      }
      case 'matrix':
        if (reduced) {
          addLine('> [reduced-motion] the construct is disabled', 'dim');
        } else {
          addLine('> entering the construct ...', 'br');
          startMatrix(3000);
        }
        break;
      case 'sudo':
        addLine('[sudo] password for fedhat: ', 'dim');
        addLine('nice try.', 'br');
        break;
      case 'exit':
      case 'logout':
        addLine('there is no exit.', 'br');
        break;
      case 'ls':
        addLine('breach*  decrypt*  unlock*  payload.bin', 'br');
        addLine('wraith_comms.pgp  .keys/  intel/', 'br');
        break;
      case 'cat': {
        const files = { '/intel/wraith.dossier': 1, 'intel/wraith.dossier': 1, 'wraith.dossier': 1 };
        if (arg && files[arg]) for (const o of scDossier()[1].arr) addLine(o, 'dim');
        else addLine('cat: ' + (arg || '') + ': No such file or directory');
        break;
      }
      case 'ping': {
        const h = arg || 'paris-mesh';
        addLine('PING ' + h + ' (' + U.ip(rand) + ') 56(84) bytes of data.', 'dim');
        for (let i = 0; i < 3; i++)
          addLine('64 bytes from ' + U.ip(rand) + ': icmp_seq=' + (i + 1) + ' ttl=' + rand.int(48, 64) +
            ' time=' + rand.range(0.4, 40).toFixed(1) + ' ms');
        break;
      }
      // unlisted: for those who know
      case 'fedhead':
        addLine('> waking the FEDHEAD PROTOCOL ...', 'br');
        ctx.emit('ui:fedhead', { source: 'terminal' });
        break;
      case 'lewis':
        for (const [t, c] of AD) addLine(t, c);
        addLine('cover identity: LEWIS · status: FOR REAL', 'br');
        break;
      case 'kona':
        for (const l of ['    / \\__', '   (    @\\___', '   /         O', '  /   (_____/', ' /_____/   U']) addLine(l, 'br term-pre');
        addLine('K-9 KONA reporting. scent locked: WRAITH.', 'br');
        addLine('good dog.', 'dim');
        break;
      case 'make': {
        const what = (arg || 'interceptor').slice(0, 14);
        queue = [
          OP.line('fed learns to make ' + what + ' ...', 'dim'),
          OP.bar('[>] cc -O3 ' + what, rand.range(1400, 2200), '', '  OK'),
          OP.line('[+] built. not pretty, but it works.', 'br'),
          OP.pause(1200, true),
        ];
        resumeAuto();
        return;
      }
      case 'pete':
        addLine('...and pete. additional crew, 1992.', 'dim');
        addLine('that reel is sealed, agent.', 'br');
        break;
      default:
        addLine('bash: ' + cmd + ': command not found');
    }
    lastUserAt = HD.now;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value;
      input.value = '';
      typed.textContent = '';
      runUserCommand(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length) {
        histIdx = Math.max(0, histIdx - 1);
        input.value = history[histIdx] || '';
        typed.textContent = input.value;
        lastUserAt = HD.now;
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length) {
        histIdx = Math.min(history.length, histIdx + 1);
        input.value = history[histIdx] || '';
        typed.textContent = input.value;
        lastUserAt = HD.now;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Tab' && /^\S+$/.test(input.value.trim())) {
      // complete a unique command prefix; with nothing to complete, Tab still leaves the field
      const v = input.value.trim().toLowerCase();
      const m = CMDS.filter((c) => c.startsWith(v));
      if (m.length === 1) {
        e.preventDefault();
        input.value = m[0] + ' ';
        typed.textContent = input.value;
      }
      lastUserAt = HD.now;
    } else {
      lastUserAt = HD.now;
    }
  });

  /* ------------------------------------------------------------- effects -- */
  let nextGlitchAt = HD.now + rand.range(10000, 25000);
  let glT = 0;
  let intrT = 0;
  const glLines = [];
  const unglitch = () => {
    for (const el of glLines) el.classList.remove('term-gl', 'term-gl-r');
    glLines.length = 0;
    scr.classList.remove('term-jit');
  };
  // Shift one line, or a short block, sideways with chromatic fringing. Only rows that are on
  // screen are candidates: the log keeps ~220 rows but the glass shows the last few dozen.
  const glitchBurst = (strong) => {
    if (reduced) return;
    clearTimeout(glT);
    unglitch();
    const kids = log.children;
    const n = kids.length - 1; // the last child is the live prompt row
    if (n > 1) {
      const span = Math.min(n, rows);
      const blocks = strong ? rand.int(3, 5) : 1;
      for (let b = 0; b < blocks; b++) {
        const len = strong || rand.chance(0.4) ? rand.int(2, 4) : 1;
        const start = n - 1 - rand.int(0, span - 1);
        const cls = rand.chance(0.5) ? 'term-gl' : 'term-gl-r';
        for (let i = start; i > start - len && i >= 0; i--) {
          kids[i].classList.add(cls);
          glLines.push(kids[i]);
        }
      }
    }
    scr.classList.add('term-jit');
    glT = setTimeout(unglitch, strong ? 140 : 80);
    if (strong) {
      clearTimeout(intrT);
      scr.classList.add('is-intr');
      intrT = setTimeout(() => scr.classList.remove('is-intr'), 900);
    }
  };

  // katakana rain — a canvas overlay, only alive during a 3s burst
  let mx = null;
  let mcols = [];
  let matrixUntil = 0;
  let matrixOn = false;
  const ensureMatrix = () => {
    if (mx) return;
    mx = ctx.canvas({ parent: scr, className: 'term-matrix' });
  };
  const startMatrix = (dur) => {
    if (reduced) return;
    ensureMatrix();
    matrixUntil = HD.now + dur;
    if (!matrixOn) {
      matrixOn = true;
      mx.canvas.style.opacity = '0.92';
      mcols = [];
      mx.clear();
      const cw = Math.max(9, fs * 0.82);
      const n = Math.min(80, Math.ceil(mx.w / cw));
      for (let i = 0; i < n; i++) mcols.push({ x: i * cw + 2, y: rand.range(-mx.h, 0), sp: rand.range(fs * 8, fs * 22) });
    }
  };
  const endMatrix = () => {
    matrixOn = false;
    if (mx) {
      mx.clear();
      mx.canvas.style.opacity = '0';
    }
  };
  const drawMatrix = (dt) => {
    const g = mx.ctx;
    g.fillStyle = 'rgba(1,11,5,0.20)';
    g.fillRect(0, 0, mx.w, mx.h);
    g.font = fs + 'px "VT323","Courier New",monospace';
    g.textBaseline = 'top';
    const K = U.CHARS.kata;
    for (const c of mcols) {
      c.y += c.sp * dt;
      g.fillStyle = 'rgba(198,255,219,0.95)';
      g.fillText(K[(Math.random() * K.length) | 0], c.x, c.y);
      g.fillStyle = 'rgba(61,255,127,0.5)';
      g.fillText(K[(Math.random() * K.length) | 0], c.x, c.y - fs);
      if (c.y > mx.h + fs) {
        c.y = rand.range(-mx.h * 0.5, 0);
        c.sp = rand.range(fs * 8, fs * 22);
      }
    }
  };

  /* ----------------------------------------------------------- lifecycle -- */
  queue.push(...scBoot());
  let metaAt = 0;

  const midCmd = () => op && op.k === 'cmd';

  const pump = (now) => {
    if (op) {
      if (stepOp(op, now)) op = null;
      return;
    }
    if (reactQ.length) return; // reactions drain first, then resume the session
    if (!queue.length) enqueueNext();
    op = queue.shift();
    if (op) startOp(op, now);
  };

  return {
    fps: 50,
    resize(w, h) {
      // ~15px at 306 wide, 18px at 465, 20.5px at 626+
      fs = Math.round(U.clamp(15 + (w - 306) * 0.019, 14.5, 20.5) * 2) / 2;
      scr.style.fontSize = fs + 'px';
      // VT323 advances ~0.4em; 26px of bezel inset and padding
      cols = Math.max(24, Math.floor((w - 26) / (fs * 0.41)));
      rows = Math.max(4, Math.floor((h - 19) / (fs * 1.16)));
      barW = U.clamp(cols - 33, 8, 26);
    },
    tick(now, dt) {
      if (matrixOn) {
        if (now < matrixUntil) drawMatrix(dt);
        else endMatrix();
      }
      // reactions may print between ops, but never mid-command-typing
      if (!midCmd() && reactQ.length) {
        const batch = reactQ.shift();
        for (const it of batch) addLine(it[0], it[1]);
      }
      if (!reduced && now >= nextGlitchAt) {
        glitchBurst(false);
        nextGlitchAt = now + rand.range(10000, 25000);
      }
      if (userActive && now - lastUserAt > 8000) input.blur();
      if (!userActive) pump(now);

      if (now >= metaAt) {
        metaAt = now + 700;
        ctx.meta((userActive ? 'KBD' : 'TTY/7') + ' · ' + (log.childElementCount - 1) + ' L');
      }
    },
  };
});
