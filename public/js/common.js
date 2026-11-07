// Utilidades compartidas (web pública y panel admin)
(function () {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (d) => d.toISOString().slice(0, 10);

  const SB = {
    MESES, DIAS,
    parse, iso,
    addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); },
    dow: (s) => parse(s).getUTCDay(),
    dayNum: (s) => parse(s).getUTCDate(),
    longDate(s) { const d = parse(s); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; },
    shortDate(s) { const d = parse(s); return `${DIAS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`; },
    time12(t) {
      let [h, m] = t.split(':').map(Number);
      const ap = h >= 12 ? 'p. m.' : 'a. m.';
      h = h % 12 || 12;
      return `${h}:${String(m).padStart(2, '0')} ${ap}`;
    },
    phonePretty(p) {
      const d = String(p).replace(/\D/g, '');
      if (/^57\d{10}$/.test(d)) return `${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
      return d;
    },
    async api(path, { method = 'GET', body } = {}) {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
      let data = {};
      try { data = await res.json(); } catch (_) { /* sin cuerpo */ }
      if (!res.ok) {
        const err = new Error(data.error || 'Ocurrió un error');
        err.status = res.status;
        throw err;
      }
      return data;
    },
    // Crea elementos sin innerHTML (evita XSS con nombres de clientes)
    h(tag, attrs, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
      for (const kid of kids.flat()) {
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
      return el;
    },
  };
  window.SB = SB;
})();
