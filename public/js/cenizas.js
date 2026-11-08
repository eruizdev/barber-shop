// Logo que aparece entre cenizas (unos 2 segundos):
// primero se ve carbonizado, un borde de brasas lo va "dibujando" desde el centro hacia afuera
// y suben chispas y cenizas. Arranca cuando el logo cargó y está a la vista; tocarlo lo repite.
(function () {
  const box = document.querySelector('.hero-logo');
  const img = box && box.querySelector('img');
  if (!box || !img) return;
  const test = document.createElement('canvas');
  if (!test.getContext || !test.getContext('2d')) { box.classList.add('is-open'); return; }

  const DUR = 2000;   // ms en que se dibuja el logo
  const TAIL = 900;   // ms para que se apaguen las últimas brasas
  const N = 96;       // resolución del "mapa de fuego"
  const AHEAD = 0.3;  // cuánto se adelanta lo carbonizado al color
  let running = null;

  // ---------- mapa de fuego: en qué orden aparece cada zona (ruido + distancia al centro) ----------
  function makeField() {
    const seed = Math.random() * 1000;
    const rnd = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
    const sm = (t) => t * t * (3 - 2 * t);
    const vnoise = (x, y, s) => {
      const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
      const a = rnd(xi, yi, s), b = rnd(xi + 1, yi, s), c = rnd(xi, yi + 1, s), d = rnd(xi + 1, yi + 1, s);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const f = new Float32Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const nx = x / N, ny = y / N;
        const n = 0.55 * vnoise(nx * 5, ny * 5, seed) + 0.3 * vnoise(nx * 11, ny * 11, seed + 1) + 0.15 * vnoise(nx * 23, ny * 23, seed + 2);
        const r = Math.min(1, Math.hypot(nx - 0.5, ny - 0.55) / 0.72);
        const v = 0.55 * n + 0.45 * r;
        f[y * N + x] = v; if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo);
    return f;
  }

  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // Versión carbonizada del logo: sin color, oscura y con tono de brasa apagada
  function makeCharred(w, h) {
    const c = newCanvas(w, h), g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    g.globalCompositeOperation = 'saturation'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#8a7f74'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(24, 16, 10, 0.3)'; g.fillRect(0, 0, w, h);
    return c;
  }

  const ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2; // suave al empezar y al terminar
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function start() {
    if (running) running.stop();
    const rect = img.getBoundingClientRect();
    const brect = box.getBoundingClientRect();
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (!W || !H) { box.classList.add('is-open'); return; }
    const PAD = Math.round(Math.min(56, W * 0.18));         // aire para que las cenizas suban
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round((W + PAD * 2) * dpr), ch = Math.round((H + PAD * 2) * dpr);
    const iw = Math.round(W * dpr), ih = Math.round(H * dpr), off = Math.round(PAD * dpr);

    const cv = newCanvas(cw, ch);
    cv.className = 'cenizas';
    cv.setAttribute('aria-hidden', 'true');
    Object.assign(cv.style, {
      left: `${rect.left - brect.left - PAD}px`, top: `${rect.top - brect.top - PAD}px`,
      width: `${W + PAD * 2}px`, height: `${H + PAD * 2}px`,
    });
    box.appendChild(cv);
    box.classList.remove('is-open');
    box.classList.add('is-burning');

    const ctx = cv.getContext('2d');
    const field = makeField();
    const charred = makeCharred(iw, ih);
    const tmp = newCanvas(iw, ih), tg = tmp.getContext('2d');
    const mColor = newCanvas(N, N), mChar = newCanvas(N, N), mEmber = newCanvas(N, N);
    const dColor = mColor.getContext('2d').createImageData(N, N);
    const dChar = mChar.getContext('2d').createImageData(N, N);
    const dEmber = mEmber.getContext('2d').createImageData(N, N);
    const parts = [];
    const t0 = performance.now();
    let raf = 0;

    function masked(source, mask) {
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, iw, ih);
      tg.drawImage(source, 0, 0, iw, ih);
      tg.globalCompositeOperation = 'destination-in';
      tg.imageSmoothingEnabled = true;
      tg.drawImage(mask, 0, 0, iw, ih);
      ctx.drawImage(tmp, off, off);
    }

    function frame(now) {
      const t = now - t0;
      const p = -0.12 + 1.17 * ease(clamp01(t / DUR));  // frente de fuego: termina justo a los 2 s
      const fade = t < DUR ? 1 : clamp01(1 - (t - DUR) / (TAIL * 0.6)); // las brasas se apagan al final
      // máscaras
      for (let i = 0; i < N * N; i++) {
        const f = field[i], k = i * 4;
        dColor.data[k + 3] = 255 * clamp01((p - f) / 0.05);
        dChar.data[k + 3] = 255 * clamp01((p + AHEAD - f) / 0.1);
        const e = Math.max(0, 1 - Math.abs(f - p) / 0.035) * fade;
        dEmber.data[k] = 255;                 // brasa: rojo anaranjado, más clara en el centro
        dEmber.data[k + 1] = 55 + 120 * e;
        dEmber.data[k + 2] = 10 + 40 * e * e;
        dEmber.data[k + 3] = 215 * e;
      }
      mColor.getContext('2d').putImageData(dColor, 0, 0);
      mChar.getContext('2d').putImageData(dChar, 0, 0);
      mEmber.getContext('2d').putImageData(dEmber, 0, 0);

      ctx.clearRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      masked(charred, mChar);  // lo carbonizado llega primero
      masked(img, mColor);     // y el color aparece detrás de las brasas
      // brillo de las brasas
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mEmber, off, off, iw, ih);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(mEmber, off - 4 * dpr, off - 4 * dpr, iw + 8 * dpr, ih + 8 * dpr);
      ctx.globalAlpha = 1;

      // chispas y cenizas que salen del borde de fuego
      if (t < DUR) {
        for (let s = 0; s < 40; s++) {
          const i = (Math.random() * N * N) | 0;
          if (Math.abs(field[i] - p) > 0.03) continue;
          const x = off + ((i % N) + Math.random()) / N * iw;
          const y = off + (Math.floor(i / N) + Math.random()) / N * ih;
          const ember = Math.random() < 0.55;
          parts.push({
            x, y, ember,
            vx: (Math.random() - 0.5) * 0.6 * dpr,
            vy: -(0.4 + Math.random() * (ember ? 1.6 : 0.8)) * dpr,
            r: (ember ? 0.8 + Math.random() * 1.4 : 1 + Math.random() * 2.2) * dpr,
            life: 0, max: ember ? 500 + Math.random() * 600 : 800 + Math.random() * 700,
          });
        }
      }
      for (let k = parts.length - 1; k >= 0; k--) {
        const q = parts[k];
        q.life += 16; q.x += q.vx + Math.sin((q.life + q.y) / 140) * 0.25 * dpr; q.y += q.vy; q.vy *= 0.995;
        const a = 1 - q.life / q.max;
        if (a <= 0) { parts.splice(k, 1); continue; }
        if (q.ember) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255, ${90 + 90 * a | 0}, 30, ${a})`;
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = `rgba(170, 164, 156, ${a * 0.75})`;
        }
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      if (t < DUR + TAIL || parts.length) raf = requestAnimationFrame(frame);
      else stop();
    }

    function stop() {
      cancelAnimationFrame(raf);
      cv.remove();
      box.classList.remove('is-burning');
      box.classList.add('is-open');
      running = null;
    }
    running = { stop };
    raf = requestAnimationFrame(frame);
  }

  // ---------- cuándo arranca ----------
  const loaded = img.complete && img.naturalWidth ? Promise.resolve() : new Promise((r) => {
    img.addEventListener('load', r, { once: true });
    img.addEventListener('error', r, { once: true });
  });
  const visible = new Promise((r) => {
    if (!('IntersectionObserver' in window)) { r(); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); r(); }
    }, { threshold: 0.35 });
    io.observe(box);
  });
  Promise.all([loaded, visible]).then(() => { try { start(); } catch (e) { box.classList.add('is-open'); } });
  box.addEventListener('click', () => { try { start(); } catch (e) { box.classList.add('is-open'); } });
  // por si algo falla: mostrar el logo igual
  setTimeout(() => { if (!running && !box.classList.contains('is-open')) box.classList.add('is-open'); }, 8000);
})();
