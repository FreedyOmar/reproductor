/* ==========================================================
   Aurora · Reproductor de música con partículas que forman fotos
   - Música:  carpeta  music/
   - Fotos:   carpeta  fotos/
   ========================================================== */
(() => {
  'use strict';

  /* ---------- CONFIGURACIÓN ----------
     Si tu servidor NO muestra el listado de carpetas, escribe aquí
     los nombres de los archivos manualmente, por ejemplo:
       tracks: ['cancion1.mp3', 'Artista - Tema.mp3'],
       photos: ['foto1.jpg', 'foto2.png'],
  */
  const CONFIG = {
    musicFolder: 'music/',
    photosFolder: 'fotos/',
    tracks: [],
    photos: [],
    photoInterval: 14000,     // ms entre fotos mientras suena la música
    particles: 8500,          // escritorio
    particlesMobile: 4500,    // móvil
  };

  const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i;
  const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  const TOP = 70;       // alto de la barra superior
  const BOTTOM = 200;   // espacio reservado para el reproductor

  const $ = (id) => document.getElementById(id);
  const rand = Math.random;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- Elementos ---------- */
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const spec = $('spectrum');
  const sctx = spec.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });

  /* ---------- Estado ---------- */
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0;
  let tracks = [], photos = [];
  let trackIdx = 0, photoIdx = 0;
  let shuffle = false, repeat = 0; // 0 = no, 1 = todas, 2 = una
  let transStart = 0, photoToken = 0, currentSource = null;
  let rect = { x: 0, y: 0, w: 0, h: 0 }, photoA = 0;
  const REVEAL_MS = 1900; // tiempo que tardan las partículas en armar la foto
  const TEXT_HOLD = 3000; // ms que se muestra el nombre antes de formar la imagen
  let phase = 'idle';     // 'idle' | 'text' | 'image'
  let accentCss = '#7c5cff', currentLabel = '';

  const audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = 0.8;
  let actx = null, analyser = null, freq = null;

  /* ---------- Partículas ---------- */
  const N = innerWidth < 700 ? CONFIG.particlesMobile : CONFIG.particles;
  const px = new Float32Array(N), py = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N);
  const tx = new Float32Array(N), ty = new Float32Array(N);
  const psz = new Float32Array(N), pdelay = new Float32Array(N), pph = new Float32Array(N);
  const pcol = new Array(N).fill('rgb(255,255,255)');

  // Objetivos de la imagen (i...) y del texto (t...)
  const itx = new Float32Array(N), ity = new Float32Array(N), ipsz = new Float32Array(N), idelay = new Float32Array(N);
  const ipcol = new Array(N).fill('rgb(255,255,255)');
  const ttx = new Float32Array(N), tty = new Float32Array(N), tpsz = new Float32Array(N), tdelay = new Float32Array(N);
  const tpcol = new Array(N).fill('rgb(255,255,255)');

  const mouse = { x: -999, y: -999, active: false };

  /* ==========================================================
     Utilidades
     ========================================================== */
  const cleanName = (n) => n.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  const fmt = (s) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };
  const setRangeFill = (el, ratio) => el.style.setProperty('--p', (clamp(ratio, 0, 1) * 100) + '%');

  async function listFolder(folder, re) {
    try {
      const res = await fetch(folder, { cache: 'no-store' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = [];
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href').split('?')[0].split('#')[0];
        let name = href.split('/').pop();
        try { name = decodeURIComponent(name); } catch (e) { /* noop */ }
        if (re.test(name)) out.push(name);
      });
      return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (e) {
      return [];
    }
  }

  const toItems = (names, folder) =>
    names.map((name) => ({ name, src: folder + encodeURIComponent(name) }));

  /* ==========================================================
     Canvas / tamaño
     ========================================================== */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, W, H);

    const r = spec.getBoundingClientRect();
    spec.width = Math.max(1, r.width * DPR);
    spec.height = Math.max(1, r.height * DPR);

    cx = W / 2;
    cy = TOP + (H - TOP - BOTTOM) / 2;
  }

  /* ==========================================================
     Imágenes de ejemplo (si la carpeta fotos/ está vacía)
     ========================================================== */
  function demoImage(i) {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 500;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 800, 500);
    const k = ((i % 3) + 3) % 3;

    if (k === 0) {
      const gr = g.createRadialGradient(400, 250, 10, 400, 250, 210);
      gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.35, '#ff9f43');
      gr.addColorStop(0.75, '#ff3d81'); gr.addColorStop(1, '#2a0a3a');
      g.fillStyle = gr; g.beginPath(); g.arc(400, 250, 210, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#7c5cff'; g.lineWidth = 8;
      g.beginPath(); g.arc(400, 250, 240, 0, Math.PI * 2); g.stroke();
    } else if (k === 1) {
      const cols = ['#00e5ff', '#7c5cff', '#ff5ca8', '#ffd166', '#06d6a0'];
      for (let r = 5; r >= 0; r--) {
        g.strokeStyle = cols[r % cols.length]; g.lineWidth = 16;
        g.beginPath(); g.arc(400, 250, 30 + r * 38, 0, Math.PI * 2); g.stroke();
      }
    } else {
      const cols = ['#ff5ca8', '#7c5cff', '#00e5ff', '#06d6a0'];
      for (let b = 0; b < 4; b++) {
        g.strokeStyle = cols[b]; g.lineWidth = 22; g.lineCap = 'round';
        g.beginPath();
        for (let x = 60; x <= 740; x += 8) {
          const y = 250 + Math.sin(x / 70 + b * 0.9) * (70 + b * 18) + (b - 1.5) * 28;
          x === 60 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = '300 22px sans-serif'; g.textAlign = 'center';
    g.fillText('Añade tus fotos en la carpeta fotos/', 400, 485);
    return c;
  }

  /* ==========================================================
     Foto → objetivos de las partículas
     ========================================================== */
  const imgCache = new Map();

  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  }

  async function getSource(i) {
    if (!photos.length) return demoImage(i);
    const p = photos[i];
    if (!imgCache.has(p.src)) {
      try { imgCache.set(p.src, await loadImage(p.src)); }
      catch (e) { imgCache.set(p.src, demoImage(i)); }
    }
    return imgCache.get(p.src);
  }

  function buildTargets(src, retry = false) {
    const cw = src.naturalWidth || src.width, ch = src.naturalHeight || src.height;
    const maxW = W * 0.84, maxH = Math.max(140, H - TOP - BOTTOM);
    const sc = Math.min(maxW / cw, maxH / ch);
    const dw = cw * sc, dh = ch * sc;

    const s = Math.max(2, Math.sqrt((dw * dh) / (N * 1.2)));
    const cols = Math.max(1, Math.floor(dw / s));
    const rows = Math.max(1, Math.floor(dh / s));
    off.width = cols; off.height = rows;
    octx.clearRect(0, 0, cols, rows);
    octx.drawImage(src, 0, 0, cols, rows);

    let data;
    try {
      data = octx.getImageData(0, 0, cols, rows).data;
    } catch (e) {
      // Canvas "contaminado" (abierto con file://): usamos imagen de ejemplo
      if (!retry) { currentSource = demoImage(photoIdx); return buildTargets(currentSource, true); }
      return;
    }

    const M = cols * rows;
    const order = new Uint32Array(M);
    for (let i = 0; i < M; i++) order[i] = i;
    for (let i = M - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }

    const sx = dw / cols, sy = dh / rows;
    const x0 = cx - dw / 2, y0 = cy - dh / 2;
    rect = { x: x0, y: y0, w: dw, h: dh };
    const maxD = Math.hypot(dw / 2, dh / 2) || 1;
    let ar = 0, ag = 0, ab = 0, an = 0;

    for (let i = 0; i < N; i++) {
      const k = order[i % M];
      const c = k % cols, r = (k / cols) | 0;
      const o = k * 4;
      const a = data[o + 3];

      if (a < 40) {
        // píxel transparente: partícula ambiente tenue
        itx[i] = rand() * W; ity[i] = rand() * H;
        ipcol[i] = 'rgba(255,255,255,0.14)';
        ipsz[i] = 1.2;
      } else {
        itx[i] = x0 + (c + 0.5) * sx + (rand() - 0.5) * sx * 0.7;
        ity[i] = y0 + (r + 0.5) * sy + (rand() - 0.5) * sy * 0.7;
        const R = Math.min(255, data[o] * 1.08 + 10);
        const G = Math.min(255, data[o + 1] * 1.08 + 10);
        const B = Math.min(255, data[o + 2] * 1.08 + 10);
        ipcol[i] = `rgb(${R | 0},${G | 0},${B | 0})`;
        ipsz[i] = Math.max(1.3, Math.max(sx, sy) * 0.92);
        ar += R; ag += G; ab += B; an++;
      }
      const d = Math.hypot(itx[i] - cx, ity[i] - cy) / maxD;
      idelay[i] = d * 550 + rand() * 350;
      pph[i] = rand() * Math.PI * 2;
    }

    if (an) {
      let r = ar / an, g = ag / an, b = ab / an;
      const m = Math.max(r, g, b, 1), f = 210 / m;
      r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);
      accentCss = `rgb(${r | 0},${g | 0},${b | 0})`;
      document.documentElement.style.setProperty('--accent', accentCss);
    }
  }

  /* ---------- Nombre de la foto → partículas ---------- */
  const fontReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('600 100px Outfit').catch(() => {})
    : Promise.resolve();

  function buildTextTargets(label) {
    label = (label || 'Aurora').trim() || 'Aurora';
    const availW = W * 0.84;
    const availH = Math.max(120, H - TOP - BOTTOM) * 0.7;
    const words = label.split(/\s+/).filter(Boolean);
    let fs = Math.min(W * 0.13, 150), lines = [label];

    for (; fs > 20; fs -= 4) {
      octx.font = `600 ${fs}px Outfit, system-ui, sans-serif`;
      lines = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (!cur || octx.measureText(t).width <= availW) cur = t;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      const widest = Math.max(...lines.map((l) => octx.measureText(l).width));
      if (widest <= availW && lines.length * fs * 1.2 <= availH) break;
    }

    const lh = fs * 1.2;
    const cw = Math.ceil(availW + 20), ch = Math.ceil(lines.length * lh + 20);
    off.width = cw; off.height = ch;
    octx.clearRect(0, 0, cw, ch);
    octx.font = `600 ${fs}px Outfit, system-ui, sans-serif`;
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    lines.forEach((l, k) => octx.fillText(l, cw / 2, 10 + lh * (k + 0.5)));

    let data;
    try { data = octx.getImageData(0, 0, cw, ch).data; } catch (e) { return; }
    const pts = [];
    for (let p = 0; p < cw * ch; p++) if (data[p * 4 + 3] > 140) pts.push(p);
    if (!pts.length) pts.push(((ch / 2) | 0) * cw + ((cw / 2) | 0));
    const P = pts.length;

    const dot = clamp(Math.sqrt(P / N) * 0.95, 1.5, 3.6);
    const ox = cx - cw / 2, oy = cy - ch / 2;
    const maxD = Math.hypot(cw / 2, ch / 2) || 1;

    for (let i = 0; i < N; i++) {
      const p = pts[(rand() * P) | 0];
      const x = p % cw, y = (p / cw) | 0;
      ttx[i] = ox + x + (rand() - 0.5) * 1.2;
      tty[i] = oy + y + (rand() - 0.5) * 1.2;
      tpsz[i] = dot;
      tpcol[i] = i % 7 === 0 ? accentCss : '#f3f4fb';
      tdelay[i] = (Math.hypot(ttx[i] - cx, tty[i] - cy) / maxD) * 450 + rand() * 300;
    }
  }

  function applyTargets(kind) {
    const text = kind === 'text';
    tx.set(text ? ttx : itx);
    ty.set(text ? tty : ity);
    psz.set(text ? tpsz : ipsz);
    pdelay.set(text ? tdelay : idelay);
    const col = text ? tpcol : ipcol;
    for (let i = 0; i < N; i++) pcol[i] = col[i];
  }

  async function showPhoto(i) {
    const total = photos.length || 3;
    photoIdx = ((i % total) + total) % total;
    const tok = ++photoToken;
    const [src] = await Promise.all([getSource(photoIdx), fontReady]);
    if (tok !== photoToken) return;
    currentSource = src;
    currentLabel = photos.length ? cleanName(photos[photoIdx].name) : 'Imagen de ejemplo';
    buildTargets(src);
    buildTextTargets(currentLabel);
    phase = 'text';
    applyTargets('text');
    transStart = performance.now();
  }

  /* ==========================================================
     Audio
     ========================================================== */
  function ensureAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    freq = new Uint8Array(analyser.frequencyBinCount);
    const node = actx.createMediaElementSource(audio);
    node.connect(analyser);
    analyser.connect(actx.destination);
  }

  let bass = 0, mid = 0, treble = 0, pulse = 0, bassAvg = 0.35, lastBeat = 0;

  const avg = (arr, a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += arr[i];
    return s / ((b - a) * 255);
  };

  function analyse(now, f) {
    let b = 0, m = 0, t = 0;
    if (analyser && !audio.paused) {
      analyser.getByteFrequencyData(freq);
      b = avg(freq, 1, 5); m = avg(freq, 5, 32); t = avg(freq, 32, 120);
      if (b > 0.5 && b > bassAvg * 1.15 && now - lastBeat > 170) { pulse = 1; lastBeat = now; }
      bassAvg += (b - bassAvg) * 0.05;
    }
    const sm = 1 - Math.pow(0.7, f);
    bass += (b - bass) * sm; mid += (m - mid) * sm; treble += (t - treble) * sm;
    pulse *= Math.pow(0.9, f);
  }

  function drawSpectrum() {
    const w = spec.width, h = spec.height;
    sctx.clearRect(0, 0, w, h);
    if (!freq) return;
    const bars = 64, gap = 3 * DPR, bw = (w - gap * (bars - 1)) / bars;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c5cff';
    sctx.fillStyle = accent;
    for (let i = 0; i < bars; i++) {
      const idx = 1 + Math.floor(Math.pow(i / bars, 1.55) * 130);
      const v = audio.paused ? 0 : freq[idx] / 255;
      const bh = Math.max(1.5 * DPR, v * h);
      sctx.globalAlpha = 0.35 + v * 0.65;
      sctx.fillRect(i * (bw + gap), h - bh, bw, bh);
    }
    sctx.globalAlpha = 1;
  }

  /* ==========================================================
     Reproductor (lógica)
     ========================================================== */
  function updateTrackUI() {
    const t = tracks[trackIdx];
    if (!t) return;
    const name = cleanName(t.name);
    const parts = name.split(' - ');
    if (parts.length > 1) {
      $('trackTitle').textContent = parts.slice(1).join(' - ');
      $('trackSub').textContent = parts[0];
    } else {
      $('trackTitle').textContent = name;
      $('trackSub').textContent = `Pista ${trackIdx + 1} de ${tracks.length}`;
    }
  }

  function loadTrack(i, autoplay) {
    if (!tracks.length) return;
    trackIdx = ((i % tracks.length) + tracks.length) % tracks.length;
    audio.src = tracks[trackIdx].src;
    updateTrackUI();
    if (autoplay) play();
  }

  async function play() {
    ensureAudio();
    try { await audio.play(); } catch (e) { console.warn('No se pudo reproducir:', e); }
  }

  function toggle() {
    if (!tracks.length) return;
    if (!audio.getAttribute('src')) loadTrack(trackIdx, true);
    else if (audio.paused) play();
    else audio.pause();
  }

  function step(dir) {
    if (!tracks.length) return;
    let n;
    if (shuffle && tracks.length > 1) {
      do { n = (rand() * tracks.length) | 0; } while (n === trackIdx);
    } else n = trackIdx + dir;
    loadTrack(n, true);
    showPhoto(photoIdx + 1);
  }

  /* ---------- Eventos del audio ---------- */
  audio.addEventListener('play', () => document.body.classList.add('playing'));
  audio.addEventListener('pause', () => document.body.classList.remove('playing'));
  audio.addEventListener('loadedmetadata', () => { $('dur').textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const r = audio.duration ? audio.currentTime / audio.duration : 0;
    $('seek').value = r * 1000;
    setRangeFill($('seek'), r);
    $('cur').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    if (repeat === 2) { audio.currentTime = 0; play(); }
    else if (repeat === 1 || shuffle || trackIdx < tracks.length - 1) step(1);
    else audio.currentTime = 0;
  });
  audio.addEventListener('error', () => {
    $('trackSub').textContent = 'No se pudo cargar este archivo';
  });

  /* ---------- Controles ---------- */
  let seeking = false;
  const seekEl = $('seek');
  seekEl.addEventListener('input', () => {
    seeking = true;
    const r = seekEl.value / 1000;
    setRangeFill(seekEl, r);
    $('cur').textContent = fmt(r * (audio.duration || 0));
  });
  seekEl.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
    seeking = false;
  });

  const volEl = $('volume');
  setRangeFill(volEl, 0.8);
  volEl.addEventListener('input', () => {
    audio.volume = +volEl.value;
    setRangeFill(volEl, +volEl.value);
  });

  $('playBtn').addEventListener('click', toggle);
  $('nextBtn').addEventListener('click', () => step(1));
  $('prevBtn').addEventListener('click', () => {
    if (audio.currentTime > 3) audio.currentTime = 0; else step(-1);
  });
  $('shuffleBtn').addEventListener('click', (e) => {
    shuffle = !shuffle;
    e.currentTarget.classList.toggle('active', shuffle);
  });
  $('repeatBtn').addEventListener('click', (e) => {
    repeat = (repeat + 1) % 3;
    e.currentTarget.dataset.mode = repeat;
    e.currentTarget.classList.toggle('active', repeat > 0);
  });

  /* ---------- Teclado ---------- */
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'file') return;
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowRight') {
      if (e.shiftKey) showPhoto(photoIdx + 1); else audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    } else if (e.code === 'ArrowLeft') {
      if (e.shiftKey) showPhoto(photoIdx - 1); else audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (e.key === 'n' || e.key === 'N') step(1);
    else if (e.key === 'p' || e.key === 'P') step(-1);
  });

  /* ---------- Ratón / táctil ---------- */
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
  addEventListener('pointerleave', () => { mouse.active = false; });
  addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') mouse.active = false; });

  let rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      resize();
      if (currentSource && phase !== 'idle') {
        buildTargets(currentSource);
        buildTextTargets(currentLabel);
        applyTargets(phase);
      }
    }, 150);
  });

  /* ==========================================================
     Bucle de animación
     ========================================================== */
  let last = performance.now(), time = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = dt * 60;
    time += dt;

    analyse(now, f);

    // La foto real aparece cuando las partículas ya la formaron
    if (phase === 'text' && now - transStart > TEXT_HOLD) {
      applyTargets('image');
      phase = 'image';
      transStart = now;
    }
    const revealTo = phase === 'image' && now - transStart > REVEAL_MS ? 1 : 0;
    photoA += (revealTo - photoA) * (1 - Math.pow(revealTo ? 0.94 : 0.7, f));
    if (photoA < 0.003) photoA = 0;
    ctx.globalAlpha = 1;

    // Estela suave
    ctx.fillStyle = `rgba(5,6,12,${0.34 - Math.min(0.14, bass * 0.14)})`;
    ctx.fillRect(0, 0, W, H);

    const damp = Math.pow(0.88, f);
    const wob = 1.1 + treble * 8 + mid * 2;
    const push = pulse * 0.075 + bass * 0.035;
    const sizeMul = 1 + pulse * 0.3 + mid * 0.25;
    const t1 = time * 0.8, t2 = time * 0.9;
    const MR = 110, MR2 = MR * MR;
    ctx.globalAlpha = 1 - photoA * 0.92; // las partículas se desvanecen al aparecer la foto

    for (let i = 0; i < N; i++) {
      let x = px[i], y = py[i], vX = vx[i], vY = vy[i];
      const age = now - transStart - pdelay[i];

      if (age < 0) {
        // Fase de remolino antes de formar la nueva imagen
        const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) + 1;
        vX += (-dy / d * 0.55 + dx / d * 0.09) * f;
        vY += (dx / d * 0.55 + dy / d * 0.09) * f;
      } else {
        const k = 0.010 + 0.030 * Math.min(1, age / 800);
        const ph = pph[i];
        const ex = tx[i] + (tx[i] - cx) * push + Math.sin(t1 + ph) * wob;
        const ey = ty[i] + (ty[i] - cy) * push + Math.cos(t2 + ph * 1.3) * wob;
        vX += (ex - x) * k * f;
        vY += (ey - y) * k * f;
      }

      if (mouse.active) {
        const mx = x - mouse.x, my = y - mouse.y, d2 = mx * mx + my * my;
        if (d2 < MR2) {
          const d = Math.sqrt(d2) + 0.01;
          const force = (1 - d / MR) * 2.4 * f;
          vX += (mx / d) * force;
          vY += (my / d) * force;
        }
      }

      vX *= damp; vY *= damp;
      x += vX * f; y += vY * f;
      px[i] = x; py[i] = y; vx[i] = vX; vy[i] = vY;

      const s = psz[i] * sizeMul;
      ctx.fillStyle = pcol[i];
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    // Foto real, nítida, con un leve latido con la música
    ctx.globalAlpha = 1;
    if (photoA > 0.003 && currentSource && rect.w) {
      const sc = 1 + pulse * 0.012 + bass * 0.01;
      const w = rect.w * sc, h = rect.h * sc;
      const x = rect.x + rect.w / 2 - w / 2, y = rect.y + rect.h / 2 - h / 2;
      ctx.save();
      ctx.globalAlpha = photoA;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16); else ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(currentSource, x, y, w, h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    drawSpectrum();
    requestAnimationFrame(frame);
  }

  /* ==========================================================
     Inicio
     ========================================================== */
  function updateStatus() {
    const a = tracks.length, p = photos.length;
    $('status').textContent =
      `${a} ${a === 1 ? 'canción' : 'canciones'} · ${p} ${p === 1 ? 'foto' : 'fotos'}` +
      (p ? '' : ' (se usarán imágenes de ejemplo)');
  }

  async function init() {
    resize();
    // Partículas iniciales dispersas
    for (let i = 0; i < N; i++) {
      px[i] = rand() * W; py[i] = rand() * H;
      vx[i] = vy[i] = 0;
      tx[i] = px[i]; ty[i] = py[i];
    }
    requestAnimationFrame(frame);

    // lista.json (lo crea generar-lista.js) sirve para hosting sin listado de carpetas
    let manifest = {};
    try {
      const r = await fetch('lista.json', { cache: 'no-store' });
      if (r.ok) manifest = await r.json();
    } catch (e) { /* sin lista.json */ }
    const pick = (manual, fromJson, folder, re) =>
      manual.length ? manual : (fromJson && fromJson.length ? fromJson : listFolder(folder, re));
    const [tNames, pNames] = await Promise.all([
      pick(CONFIG.tracks, manifest.tracks, CONFIG.musicFolder, AUDIO_RE),
      pick(CONFIG.photos, manifest.photos, CONFIG.photosFolder, IMAGE_RE),
    ]);
    tracks = toItems(tNames, CONFIG.musicFolder);
    photos = toItems(pNames, CONFIG.photosFolder);

    updateStatus();
    if (tracks.length) loadTrack(0, false);
    await showPhoto(0);

    setInterval(() => {
      if (!audio.paused) showPhoto(photoIdx + 1);
    }, CONFIG.photoInterval);
  }

  $('startBtn').addEventListener('click', () => {
    $('intro').classList.add('hide');
    ensureAudio();
    if (tracks.length) play();
  });

  init();
})();
