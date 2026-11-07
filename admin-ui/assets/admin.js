(function () {
  const { api, h, longDate, shortDate, time12, addDays, phonePretty } = SB;
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
    $('bDate').value = today;
    setPreset('14');
    loadBlocks();
  }

  async function init() {
    buildBlockTimes();
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

  // ---------- pestañas ----------
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-active', x === b));
    for (const name of ['citas', 'bloqueos', 'actividad']) $('tab-' + name).hidden = name !== b.dataset.tab;
    if (b.dataset.tab === 'bloqueos') loadBlocks();
    if (b.dataset.tab === 'actividad') loadAudit();
    if (b.dataset.tab === 'citas') loadAppointments();
  }));

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
      actions.push(btn('Completada', () => setStatus(a, 'completed')));
      actions.push(btn('No asistió', () => setStatus(a, 'no_show')));
      actions.push(btn('Cancelar', () => cancel(a), 'danger'));
    } else if (a.status === 'cancelled') {
      actions.push(btn('Reactivar', () => setStatus(a, 'confirmed')));
    } else {
      actions.push(btn('Reabrir', () => setStatus(a, 'confirmed')));
    }
    actions.push(h('a', { class: 'btn btn-sm btn-outline', href: waLink(a), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
    actions.push(btn('Eliminar', () => remove(a), 'danger'));

    return h('div', { class: `appt st-${a.status}` },
      h('div', { class: 'time' }, time12(a.time)),
      h('div', {},
        h('div', { class: 'name' }, a.name, h('span', { class: `badge ${a.status}` }, STATUS[a.status])),
        h('div', { class: 'meta' },
          h('span', {}, phonePretty(a.phone)),
          h('span', {}, `Código ${a.code}`),
          a.source === 'admin' ? h('span', {}, 'Creada en el panel') : null
        ),
        a.note ? h('div', { class: 'note' }, a.note) : null
      ),
      h('div', { class: 'actions' }, actions)
    );
  }

  async function patch(a, body, okMsg) {
    try {
      await call(`/api/admin/appointments/${a.id}`, { method: 'PATCH', body });
      toast(okMsg);
      loadAppointments();
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
      loadAppointments();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- modal crear / editar ----------
  const modal = $('modal');
  let slotsCache = [];

  function openForm(a) {
    editing = a || null;
    $('modalTitle').textContent = a ? 'Editar / reprogramar cita' : 'Nueva cita';
    $('mName').value = a ? a.name : '';
    $('mPhone').value = a ? phonePretty(a.phone) : '';
    $('mDate').value = a ? a.date : (($('fFrom').value && $('fFrom').value >= today) ? $('fFrom').value : today);
    $('mTime').value = a ? a.time : '';
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
        title: s.reason === 'blocked' ? 'Hora bloqueada (puedes agendar igual como admin)' : '',
        onclick: () => { $('mTime').value = s.time; markChip(); },
      }, time12(s.time) + (s.reason === 'blocked' ? ' (bloq.)' : ''))));
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
      loadAppointments();
    } catch (e) { $('mError').textContent = e.message; }
    finally { btnSave.disabled = false; }
  });

  // ---------- bloqueos ----------
  function buildBlockTimes() {
    const sel = $('bTime');
    sel.append(h('option', { value: '' }, 'Todo el día'));
    for (let hr = 6; hr <= 21; hr++) {
      const t = String(hr).padStart(2, '0') + ':00';
      sel.append(h('option', { value: t }, time12(t)));
    }
  }
  async function loadBlocks() {
    let d;
    try { d = await call('/api/admin/blocks'); } catch (e) { toast(e.message, true); return; }
    const box = $('blocks');
    if (!d.blocks.length) { box.replaceChildren(h('div', { class: 'empty' }, 'No hay bloqueos próximos.')); return; }
    box.replaceChildren(...d.blocks.map((b) => h('div', { class: 'row' },
      h('div', {}, h('b', {}, longDate(b.date)), ' · ', b.time ? time12(b.time) : 'Todo el día',
        b.reason ? h('small', {}, b.reason) : null),
      btn('Quitar bloqueo', async () => {
        try { await call(`/api/admin/blocks/${b.id}`, { method: 'DELETE' }); toast('Bloqueo eliminado'); loadBlocks(); }
        catch (e) { toast(e.message, true); }
      })
    )));
  }
  $('blockForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await call('/api/admin/blocks', { method: 'POST', body: { date: $('bDate').value, time: $('bTime').value || null, reason: $('bReason').value } });
      $('bReason').value = '';
      toast('Bloqueado');
      loadBlocks();
    } catch (e) { toast(e.message, true); }
  });

  // ---------- actividad ----------
  function stamp(sqlUtc) { // 'YYYY-MM-DD HH:MM:SS' en UTC -> hora Colombia
    const d = new Date(sqlUtc.replace(' ', 'T') + 'Z');
    const col = new Date(d.getTime() - 5 * 3600 * 1000);
    const date = col.toISOString().slice(0, 10);
    return `${shortDate(date)} ${time12(col.toISOString().slice(11, 16))}`;
  }
  async function loadAudit() {
    let d;
    try { d = await call('/api/admin/audit'); } catch (e) { toast(e.message, true); return; }
    $('audit').replaceChildren(...(d.audit.length ? d.audit.map((r) => h('div', { class: 'audit-row' },
      h('span', { class: 'when' }, stamp(r.created_at)),
      h('span', { class: 'who' }, r.admin),
      h('span', {}, `${r.action}${r.detail ? ' — ' + r.detail : ''}`)
    )) : [h('div', { class: 'empty' }, 'Sin movimientos todavía.')]));
  }

  init();
})();
