(function () {
  const { api, h, longDate, time12, addDays, phonePretty } = SB;
  const $ = (id) => document.getElementById(id);

  const STATUS = { confirmed: 'Confirmada', completed: 'Completada', no_show: 'No asistió', cancelled: 'Cancelada' };
  let today = '';
  let editing = null; // cita en edición (null = nueva)
  let toastTimer = null;

  // ---------- util ----------
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('is-error', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2600);
  }

  // Cualquier 401 devuelve al login
  async function call(path, opts) {
    try { return await api(path, opts); }
    catch (e) {
      if (e.status === 401 && path !== '/api/admin/login') { showLogin(); }
      throw e;
    }
  }

  function showLogin() { $('app').hidden = true; $('login').hidden = false; $('user').focus(); }
  function showApp(me) {
    today = me.today;
    $('login').hidden = true;
    $('app').hidden = false;
    $('whoami').textContent = `Sesión: ${me.user}`;
    resetFixedForm();
    setPreset('14');
  }

  // ---------- vistas: lista / calendario / turnos fijos ----------
  let view = 'lista';
  function setView(v) {
    view = v;
    document.querySelectorAll('#views .view-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === v));
    for (const name of ['lista', 'calendario', 'fijos']) $('view-' + name).hidden = name !== v;
    refresh();
  }
  document.querySelectorAll('#views .view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  function refresh() {
    if (view === 'calendario') loadWeek();
    else if (view === 'fijos') loadFixed();
    else loadAppointments();
  }

  async function init() {
    try { showApp(await api('/api/admin/me')); } catch (_) { showLogin(); }
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('loginError').textContent = '';
    try {
      const me = await call('/api/admin/login', { method: 'POST', body: { user: $('user').value, pass: $('pass').value } });
      $('pass').value = '';
      showApp({ user: me.user, today: me.today });
    } catch (e) { $('loginError').textContent = e.message; }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch (_) { /* nada */ }
    showLogin();
  });

  // ---------- filtros ----------
  function setPreset(p) {
    const f = { from: '', to: '' };
    if (p === 'hoy') { f.from = today; f.to = today; }
    else if (p === 'manana') { f.from = f.to = addDays(today, 1); }
    else if (p === '7') { f.from = today; f.to = addDays(today, 6); }
    else if (p === '14') { f.from = today; f.to = addDays(today, 13); }
    else if (p === 'futuro') { f.from = today; }
    else if (p === 'historial') { f.to = addDays(today, -1); }
    $('fFrom').value = f.from; $('fTo').value = f.to;
    $('fStatus').value = p === 'historial' ? 'all' : 'active';
    document.querySelectorAll('#presets .chip-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.preset === p));
    loadAppointments();
  }
  document.querySelectorAll('#presets .chip-btn').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.preset)));
  const manualFilter = () => {
    document.querySelectorAll('#presets .chip-btn').forEach((b) => b.classList.remove('is-active'));
    loadAppointments();
  };
  ['fFrom', 'fTo', 'fStatus'].forEach((id) => $(id).addEventListener('change', manualFilter));
  let qTimer;
  $('fQ').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadAppointments, 300); });

  // ---------- lista de citas ----------
  async function loadAppointments() {
    const qs = new URLSearchParams();
    if ($('fFrom').value) qs.set('from', $('fFrom').value);
    if ($('fTo').value) qs.set('to', $('fTo').value);
    qs.set('status', $('fStatus').value);
    if ($('fQ').value.trim()) qs.set('q', $('fQ').value.trim());
    let data;
    try { data = await call('/api/admin/appointments?' + qs); } catch (e) { toast(e.message, true); return; }
    renderList(data.appointments);
  }

  function dayLabel(d) {
    if (d === today) return 'Hoy';
    if (d === addDays(today, 1)) return 'Mañana';
    return '';
  }

  function waLink(a) {
    const first = a.name.split(' ')[0];
    const msg = `Hola ${first}, te escribimos de Sebas Barber sobre tu cita del ${longDate(a.date)} a las ${time12(a.time)}.`;
    return `https://wa.me/${a.phone}?text=${encodeURIComponent(msg)}`;
  }

  function btn(text, onclick, kind) {
    return h('button', { type: 'button', class: 'btn btn-sm ' + (kind === 'danger' ? 'btn-danger' : 'btn-outline'), onclick }, text);
  }

  function renderList(items) {
    const active = items.filter((a) => a.status === 'confirmed').length;
    $('count').textContent = `${items.length} ${items.length === 1 ? 'cita' : 'citas'} · ${active} confirmada${active === 1 ? '' : 's'}`;
    const list = $('list');
    if (!items.length) { list.replaceChildren(h('div', { class: 'empty' }, 'No hay citas con estos filtros.')); return; }

    const groups = new Map();
    for (const a of items) { if (!groups.has(a.date)) groups.set(a.date, []); groups.get(a.date).push(a); }

    list.replaceChildren(...[...groups].map(([date, arr]) => h('div', { class: 'day-group' },
      h('div', { class: 'day-head' }, longDate(date), h('small', {}, dayLabel(date))),
      arr.map(apptRow)
    )));
  }

  function apptRow(a) {
    const actions = [btn('Editar / reprogramar', () => openForm(a))];
    if (a.status === 'confirmed') {
      actions.push(btn('Cancelar', () => cancel(a), 'danger'));
    } else if (a.status === 'cancelled') {
      actions.push(btn('Reactivar', () => setStatus(a, 'confirmed')));
    } else {
      actions.push(btn('Reabrir', () => setStatus(a, 'confirmed')));
    }
    actions.push(h('a', { class: 'btn btn-sm btn-outline', href: waLink(a), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
    actions.push(btn('Eliminar', () => remove(a), 'danger'));

    return h('div', { class: `appt st-${a.status}` },
      h('div', { class: 'time' }, time12(a.time), a.slots === 2 ? h('small', {}, '2 horas') : null),
      h('div', {},
        h('div', { class: 'name' }, a.name, h('span', { class: `badge ${a.status}` }, STATUS[a.status])),
        h('div', { class: 'meta' },
          h('span', {}, phonePretty(a.phone)),
          h('span', {}, `Código ${a.code}`),
          a.source === 'admin' ? h('span', {}, 'Creada en el panel') : null
        ),
        a.service ? h('div', { class: 'service' }, a.service) : null,
        a.note ? h('div', { class: 'note' }, a.note) : null
      ),
      h('div', { class: 'actions' }, actions)
    );
  }

  async function patch(a, body, okMsg) {
    try {
      await call(`/api/admin/appointments/${a.id}`, { method: 'PATCH', body });
      toast(okMsg);
      refresh();
    } catch (e) { toast(e.message, true); }
  }
  const setStatus = (a, status) => patch(a, { status }, `Cita de ${a.name}: ${STATUS[status].toLowerCase()}`);
  function cancel(a) {
    if (confirm(`¿Cancelar la cita de ${a.name} del ${longDate(a.date)} a las ${time12(a.time)}?`)) {
      patch(a, { status: 'cancelled' }, 'Cita cancelada. La hora quedó libre.');
    }
  }
  async function remove(a) {
    if (!confirm(`¿Eliminar definitivamente la cita de ${a.name}? Esta acción no se puede deshacer.\n\nSi solo quieres liberar la hora, usa "Cancelar".`)) return;
    try {
      await call(`/api/admin/appointments/${a.id}`, { method: 'DELETE' });
      toast('Cita eliminada');
      refresh();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- modal crear / editar ----------
  const modal = $('modal');
  let slotsCache = [];

  function openForm(a, preset) {
    editing = a || null;
    $('modalTitle').textContent = a ? 'Editar / reprogramar cita' : 'Nueva cita';
    $('mName').value = a ? a.name : '';
    $('mPhone').value = a ? phonePretty(a.phone) : '';
    $('mDate').value = a ? a.date : (($('fFrom').value && $('fFrom').value >= today) ? $('fFrom').value : today);
    $('mTime').value = a ? a.time : '';
    if (!a && preset) { $('mDate').value = preset.date; $('mTime').value = preset.time; }
    $('mNote').value = a ? a.note : '';
    $('mError').textContent = '';
    loadChips();
    modal.showModal();
    (a ? $('mDate') : $('mName')).focus();
  }

  async function loadChips() {
    const date = $('mDate').value;
    const box = $('mChips');
    const hint = $('mHint');
    box.replaceChildren(); hint.textContent = '';
    slotsCache = [];
    if (!date) return;
    try {
      const q = new URLSearchParams({ date });
      if (editing) q.set('exclude', editing.id);
      const d = await call('/api/admin/slots?' + q);
      slotsCache = d.slots;
      if (!d.open) hint.textContent = 'Ese día está cerrado en el horario normal. Puedes agendar igual con la hora que elijas.';
      else if (d.holiday) hint.textContent = `Festivo: ${d.holiday}. Aplica el horario de lunes a miércoles.`;
      box.replaceChildren(...d.slots.map((s) => h('button', {
        type: 'button', class: 'chip-btn' + ($('mTime').value === s.time ? ' is-active' : ''),
        disabled: !s.available && s.reason !== 'blocked',
        title: s.reason === 'blocked' ? 'Hora bloqueada (puedes agendar igual como admin)'
          : s.reason === 'fixed' ? 'Turno fijo: libéralo primero desde el calendario' : '',
        onclick: () => { $('mTime').value = s.time; markChip(); },
      }, time12(s.time) + (s.reason === 'blocked' ? ' (bloq.)' : s.reason === 'fixed' ? ' (fijo)' : ''))));
    } catch (e) { hint.textContent = e.message; }
  }
  function markChip() {
    const t = $('mTime').value;
    [...$('mChips').children].forEach((c, i) => c.classList.toggle('is-active', slotsCache[i] && slotsCache[i].time === t));
    const std = slotsCache.some((s) => s.time === t);
    if (t && slotsCache.length && !std) $('mHint').textContent = 'Fuera de las horas normales: se guardará igual si no choca con otra cita.';
    else if (slotsCache.length) $('mHint').textContent = '';
  }
  $('mDate').addEventListener('change', loadChips);
  $('mTime').addEventListener('input', markChip);
  $('mCancel').addEventListener('click', () => modal.close());
  $('newAppt').addEventListener('click', () => openForm(null));

  $('apptForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('mError').textContent = '';
    const body = {
      name: $('mName').value, phone: $('mPhone').value, date: $('mDate').value,
      time: $('mTime').value, note: $('mNote').value,
    };
    if (!body.time) { $('mError').textContent = 'Elige la hora.'; return; }
    const btnSave = $('mSave'); btnSave.disabled = true;
    try {
      if (editing) await call(`/api/admin/appointments/${editing.id}`, { method: 'PATCH', body });
      else await call('/api/admin/appointments', { method: 'POST', body });
      modal.close();
      toast(editing ? 'Cita actualizada' : 'Cita creada');
      refresh();
    } catch (e) { $('mError').textContent = e.message; }
    finally { btnSave.disabled = false; }
  });

  // ---------- calendario semanal ----------
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const FIRST = 8 * 60;                 // 8:00
  const ROWS = 12;                      // 8:00 ... 19:00
  const toMin = (t) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const mondayOf = (d) => addDays(d, -((SB.dow(d) + 6) % 7));
  // Semana que se abre primero: la actual; el domingo (cerrado) ya muestra la siguiente
  const startWeek = () => (SB.dow(today) === 0 ? addDays(today, 1) : mondayOf(today));
  const weeksBetween = (a, b) => Math.round((SB.parse(b) - SB.parse(a)) / 86400000) / 7;
  const freqText = (f) => (f.every === 2 ? 'Cada 2 semanas' : 'Cada semana');
  let weekStart = '';

  async function loadWeek() {
    if (!weekStart) weekStart = startWeek();
    const to = addDays(weekStart, 6);
    $('calLabel').textContent = `${SB.shortDate(weekStart)} – ${SB.shortDate(to)}`;
    let data;
    try { data = await call(`/api/admin/agenda?from=${weekStart}&to=${to}`); } catch (e) { toast(e.message, true); return; }
    renderWeek(data.days);
  }
  $('calPrev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); loadWeek(); });
  $('calNext').addEventListener('click', () => { weekStart = addDays(weekStart, 7); loadWeek(); });
  $('calToday').addEventListener('click', () => { weekStart = startWeek(); loadWeek(); });

  function renderWeek(days) {
    const wk = $('wk');
    const cells = [h('div', { class: 'wk-corner' })];
    for (let r = 0; r < ROWS; r++) {
      cells.push(h('div', { class: 'wk-hour', style: `grid-row:${r + 2}` }, time12(hhmm(FIRST + r * 60))));
    }
    days.forEach((d, i) => {
      const col = i + 2;
      const at = (r, span = 1) => `grid-column:${col};grid-row:${r + 2} / span ${span}`;
      cells.push(h('div', { class: 'wk-day' + (d.date === today ? ' is-today' : ''), style: `grid-column:${col};grid-row:1` },
        h('b', {}, `${DIAS[d.dow].slice(0, 3)} ${SB.dayNum(d.date)}`),
        d.date === today ? h('small', {}, 'Hoy') : (d.holiday ? h('small', {}, 'Festivo') : null)));

      const taken = new Array(ROWS).fill(false);
      const rowOf = (t) => Math.floor((toMin(t) - FIRST) / 60);
      // citas reservadas (web o panel); las de 2 horas ocupan 2 filas
      for (const a of d.appointments) {
        const r = rowOf(a.time);
        if (r < 0 || r >= ROWS) continue;
        const span = Math.min(a.slots || 1, ROWS - r);
        for (let k = 0; k < span; k++) taken[r + k] = true;
        cells.push(h('button', { type: 'button', class: 'wk-item is-appt', style: at(r, span), onclick: () => openForm(a) },
          h('b', {}, a.name),
          h('span', {}, phonePretty(a.phone)),
          a.service ? h('small', {}, a.service.split(' · ')[0] + (span === 2 ? ' · 2 h' : '')) : (span === 2 ? h('small', {}, '2 horas') : null)));
      }
      // turnos fijos (y los liberados ese día)
      for (const f of d.fixed) {
        const r = rowOf(f.time);
        if (r < 0 || r >= ROWS || taken[r]) continue;
        taken[r] = true;
        if (f.skipped) {
          cells.push(h('button', { type: 'button', class: 'wk-cell is-freed', style: at(r), onclick: () => openFixedMenu(f, d.date) },
            h('small', {}, `Libre · ${f.name} no viene`)));
        } else {
          cells.push(h('button', { type: 'button', class: 'wk-item is-fixed', style: at(r), onclick: () => openFixedMenu(f, d.date) },
            h('b', {}, f.name),
            f.phone ? h('span', {}, phonePretty(f.phone)) : null,
            h('small', {}, f.every === 2 ? 'Fijo · c/2 sem' : 'Fijo')));
        }
      }
      // horas libres y cerradas
      for (let r = 0; r < ROWS; r++) {
        if (taken[r]) continue;
        const s = FIRST + r * 60;
        const open = d.ranges.some(([a, b]) => s >= a && s + 60 <= b);
        const past = d.date < today;
        cells.push(open && !past
          ? h('button', { type: 'button', class: 'wk-cell is-free', style: at(r), title: 'Agendar aquí',
            onclick: () => openForm(null, { date: d.date, time: hhmm(s) }) }, '+')
          : h('div', { class: 'wk-cell ' + (open ? 'is-past' : 'is-closed'), style: at(r) }));
      }
    });
    wk.replaceChildren(...cells);
  }

  // ---------- turno fijo tocado en el calendario ----------
  const fmodal = $('fixedModal');
  function openFixedMenu(f, date) {
    $('fmTitle').textContent = f.name;
    $('fmInfo').textContent = `${longDate(date)} · ${time12(f.time)} · ${freqText(f)}${f.phone ? ' · ' + phonePretty(f.phone) : ''}`
      + (f.skipped ? ' · Liberado este día' : '');
    const acts = [];
    if (f.skipped) acts.push(btn('Volver a bloquear este día', () => skipFixed(f, date, false)));
    else acts.push(btn('Liberar solo este día', () => skipFixed(f, date, true)));
    acts.push(btn('Editar turno fijo', () => { fmodal.close(); setView('fijos'); editFixed(f); }));
    if (f.phone) acts.push(h('a', { class: 'btn btn-sm btn-outline', href: `https://wa.me/${f.phone}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'));
    acts.push(btn('Cerrar', () => fmodal.close()));
    $('fmActions').replaceChildren(...acts);
    fmodal.showModal();
  }
  async function skipFixed(f, date, free) {
    try {
      await call(`/api/admin/fixed/${f.id}/skips/${date}`, { method: free ? 'PUT' : 'DELETE' });
      fmodal.close();
      toast(free ? `Hora de ${f.name} libre solo el ${longDate(date)}` : `Turno de ${f.name} bloqueado de nuevo`);
      loadWeek();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- turnos fijos: lista y formulario ----------
  let fixedEditing = null;
  const nextDow = (dow, from = today) => addDays(from, (dow - SB.dow(from) + 7) % 7);
  function nextOccurrence(f) {
    if (f.start_date >= today) return f.start_date;
    const first = nextDow(f.dow);
    for (let i = 0; i < 2; i++) {
      const c = addDays(first, i * 7);
      if (weeksBetween(f.start_date, c) % f.every === 0) return c;
    }
    return first;
  }

  async function loadFixed() {
    let d;
    try { d = await call('/api/admin/fixed'); } catch (e) { toast(e.message, true); return; }
    const order = [1, 2, 3, 4, 5, 6, 0];
    const box = $('fixedList');
    if (!d.fixed.length) { box.replaceChildren(h('div', { class: 'empty' }, 'No hay turnos fijos.')); return; }
    box.replaceChildren(...order.filter((dow) => d.fixed.some((f) => f.dow === dow)).map((dow) => h('div', { class: 'day-group' },
      h('div', { class: 'day-head' }, DIAS[dow]),
      d.fixed.filter((f) => f.dow === dow).map((f) => h('div', { class: 'fx-row' },
        h('div', { class: 'time' }, time12(f.time)),
        h('div', {},
          h('div', { class: 'name' }, f.name),
          h('div', { class: 'meta' },
            f.phone ? h('span', {}, phonePretty(f.phone)) : h('span', {}, 'Sin celular'),
            h('span', {}, freqText(f) + (f.every === 2 ? ` · próxima: ${SB.shortDate(nextOccurrence(f))}` : '')))),
        h('div', { class: 'actions' },
          btn('Editar', () => editFixed(f)),
          btn('Eliminar', () => removeFixed(f), 'danger')))))));
  }

  function fixedHint() {
    $('fxHint').textContent = $('fxEvery').value === '2'
      ? 'Cada 2 semanas: la primera fecha es un día en que sí viene; desde ahí se cuenta cada 2 semanas.'
      : '';
  }
  function resetFixedForm() {
    fixedEditing = null;
    $('fxTitle').textContent = 'Nuevo turno fijo';
    $('fxSave').textContent = 'Agregar turno fijo';
    $('fxCancel').hidden = true;
    $('fxName').value = ''; $('fxPhone').value = ''; $('fxEvery').value = '1';
    $('fxStart').value = nextDow(Number($('fxDow').value));
    $('fxError').textContent = '';
    fixedHint();
  }
  function editFixed(f) {
    fixedEditing = f;
    $('fxTitle').textContent = `Editar turno de ${f.name}`;
    $('fxSave').textContent = 'Guardar cambios';
    $('fxCancel').hidden = false;
    $('fxDow').value = String(f.dow); $('fxTime').value = f.time;
    $('fxName').value = f.name; $('fxPhone').value = f.phone ? phonePretty(f.phone) : '';
    $('fxEvery').value = String(f.every); $('fxStart').value = f.start_date;
    $('fxError').textContent = '';
    fixedHint();
    $('fixedForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('fxName').focus({ preventScroll: true });
  }
  $('fxDow').addEventListener('change', () => { $('fxStart').value = nextDow(Number($('fxDow').value)); });
  $('fxEvery').addEventListener('change', fixedHint);
  $('fxCancel').addEventListener('click', resetFixedForm);
  $('fixedForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('fxError').textContent = '';
    const body = {
      dow: Number($('fxDow').value), time: $('fxTime').value, name: $('fxName').value,
      phone: $('fxPhone').value, every: Number($('fxEvery').value), start_date: $('fxStart').value,
    };
    try {
      if (fixedEditing) await call(`/api/admin/fixed/${fixedEditing.id}`, { method: 'PATCH', body });
      else await call('/api/admin/fixed', { method: 'POST', body });
      toast(fixedEditing ? 'Turno fijo actualizado' : 'Turno fijo agregado');
      resetFixedForm();
      loadFixed();
    } catch (e) { $('fxError').textContent = e.message; }
  });
  async function removeFixed(f) {
    if (!confirm(`¿Eliminar el turno fijo de ${f.name} (${DIAS[f.dow]} ${time12(f.time)})? Esa hora quedará libre en la web.`)) return;
    try {
      await call(`/api/admin/fixed/${f.id}`, { method: 'DELETE' });
      toast('Turno fijo eliminado');
      if (fixedEditing && fixedEditing.id === f.id) resetFixedForm();
      loadFixed();
    } catch (e) { toast(e.message, true); }
  }

  init();
})();
