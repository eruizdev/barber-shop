(function () {
  const { api, h, longDate, shortDate, time12, addDays, dow, dayNum } = SB;
  const $ = (id) => document.getElementById(id);

  let cal = null;
  let cfg = { whatsapp: '', services: [], addon: null };
  const money = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // 7000 -> $7.000
  let selDate = null;
  let selTime = null;

  const DOW_HEAD = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  function showError(msg) { const e = $('loadError'); e.textContent = msg; e.hidden = !msg; }

  async function load() {
    try {
      [cfg, cal] = await Promise.all([api('/api/config'), api('/api/calendar')]);
    } catch (e) {
      showError('No pudimos cargar el calendario. Intenta de nuevo en un momento.');
      return;
    }
    const n = $('notice');
    n.replaceChildren(
      'Agenda abierta del ', h('strong', {}, longDate(cal.window.start)),
      ' al ', h('strong', {}, longDate(cal.window.end)),
      '. Las siguientes fechas se habilitan el ', h('strong', {}, `${longDate(cal.window.nextUnlock)} a las ${cal.window.nextUnlockTime}`), '.'
    );
    n.hidden = false;
    renderServices();
    renderCalendar();
  }

  // ---------- Tipo de servicio ----------
  function renderServices() {
    const sel = $('service');
    const groups = new Map();
    for (const s of cfg.services || []) {
      if (!groups.has(s.group)) groups.set(s.group, h('optgroup', { label: s.group }));
      groups.get(s.group).append(h('option', { value: s.id }, `${s.name} — ${money(s.price)}`));
    }
    sel.append(...groups.values());
    if (cfg.addon) $('addonLabel').textContent = `Agregar ${cfg.addon.name.toLowerCase()} (+${money(cfg.addon.price)})`;
  }

  function currentService() { return (cfg.services || []).find((s) => s.id === $('service').value) || null; }

  function updateSummary() {
    if (!selDate || !selTime) return;
    const s = currentService();
    const canAddon = Boolean(s && cfg.addon && !s.noAddon);
    $('addonRow').hidden = !canAddon;
    if (!canAddon) $('addon').checked = false;
    const parts = ['Tu cita: ', h('b', {}, longDate(selDate)), ' a las ', h('b', {}, time12(selTime)), ' (1 hora)'];
    if (s) {
      const addon = $('addon').checked;
      const total = s.price + (addon ? cfg.addon.price : 0);
      parts.push(h('br'), 'Servicio: ', h('b', {}, s.name + (addon ? ` + ${cfg.addon.name.toLowerCase()}` : '')),
        ' · Total: ', h('b', {}, money(total)));
    }
    $('summary').replaceChildren(...parts);
  }
  $('service').addEventListener('change', updateSummary);
  $('addon').addEventListener('change', updateSummary);

  function renderCalendar() {
    const grid = $('cal');
    grid.replaceChildren(...DOW_HEAD.map((d) => h('div', { class: 'dow', role: 'columnheader' }, d)));

    const byDate = new Map(cal.days.map((d) => [d.date, d]));
    // La grilla arranca en el lunes de la semana donde empieza la ventana
    const startDow = (dow(cal.window.start) + 6) % 7;
    let cur = addDays(cal.window.start, -startDow);
    const endDow = (dow(cal.window.end) + 6) % 7;
    const last = addDays(cal.window.end, 6 - endDow);

    for (; cur <= last; cur = addDays(cur, 1)) {
      const date = cur; // copia por iteración (el onclick no debe ver el valor final del bucle)
      const inWindow = date >= cal.window.start && date <= cal.window.end;
      if (!inWindow) { grid.append(h('div', { class: 'day blank', 'aria-hidden': 'true' })); continue; }

      const info = byDate.get(date); // solo existe de hoy en adelante
      const classes = ['day'];
      let sub = '';
      let disabled = false;

      if (!info) { disabled = true; sub = 'Pasó'; }
      else if (!info.open) { disabled = true; sub = 'Cerrado'; }
      else if (info.free === 0) { disabled = true; sub = 'Lleno'; }
      else sub = info.free === 1 ? '1 libre' : `${info.free} libres`;

      if (info && info.holiday) classes.push('is-holiday');
      if (date === selDate) classes.push('is-selected');

      const kids = [h('b', {}, dayNum(date)), h('small', {}, sub)];
      if (info && info.holiday && info.open) kids.push(h('small', { class: 'tag' }, 'Festivo'));

      grid.append(h('button', {
        type: 'button', class: classes.join(' '), disabled,
        'aria-label': `${longDate(date)}. ${sub}`,
        onclick: () => pickDay(date),
      }, kids));
    }
  }

  async function pickDay(date) {
    selDate = date; selTime = null;
    $('stepForm').hidden = true;
    renderCalendar();
    $('dayLabel').textContent = `· ${longDate(date)}`;
    $('stepTime').hidden = false;
    const box = $('slots');
    box.replaceChildren();
    $('slotsEmpty').hidden = true;
    try {
      const data = await api(`/api/slots?date=${date}`);
      renderSlots(data.slots);
    } catch (e) {
      showError(e.message);
    }
    $('stepTime').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSlots(slots) {
    const box = $('slots');
    box.replaceChildren(...slots.map((s) => h('button', {
      type: 'button',
      class: 'chip' + (s.time === selTime ? ' is-selected' : ''),
      disabled: !s.available,
      onclick: () => pickTime(s.time, slots),
    }, time12(s.time))));
    $('slotsEmpty').hidden = slots.some((s) => s.available);
  }

  function pickTime(time, slots) {
    selTime = time;
    renderSlots(slots);
    updateSummary();
    $('formError').textContent = '';
    $('stepForm').hidden = false;
    $('stepForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('name').focus({ preventScroll: true }), 350);
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('submit');
    const err = $('formError');
    err.textContent = '';
    const name = $('name').value.trim();
    const phone = $('phone').value.trim();
    if (name.length < 2) { err.textContent = 'Escribe tu nombre.'; $('name').focus(); return; }
    if (phone.replace(/\D/g, '').length < 10) { err.textContent = 'Escribe tu celular de 10 dígitos.'; $('phone').focus(); return; }
    if (!$('service').value) { err.textContent = 'Elige el tipo de servicio.'; $('service').focus(); return; }

    btn.disabled = true; btn.textContent = 'ENVIANDO…';
    try {
      const r = await api('/api/appointments', {
        method: 'POST',
        body: { name, phone, service: $('service').value, addon: $('addon').checked, date: selDate, time: selTime },
      });
      showDone(r);
    } catch (e) {
      err.textContent = e.message;
      if (e.status === 409) { // la hora se ocupó: refrescar
        selTime = null;
        $('stepForm').hidden = true;
        try { cal = await api('/api/calendar'); renderCalendar(); await pickDay(selDate); } catch (_) { /* nada */ }
        showError(e.message);
      }
    } finally {
      btn.disabled = false; btn.textContent = 'CONFIRMAR CITA';
    }
  });

  function showDone(r) {
    $('flow').hidden = true;
    $('notice').hidden = true;
    $('doneWhen').textContent = `${longDate(r.date)} a las ${time12(r.time)}`;
    if (r.whatsappSent) {
      $('doneMsg').replaceChildren(
        'Te enviamos la confirmación a tu WhatsApp ', h('b', {}, SB.phonePretty(r.phone)),
        ' con el link para ver, cambiar o cancelar tu cita.'
      );
    } else {
      // Sin WhatsApp (no configurado o falló): el link se muestra aquí
      $('doneMsg').textContent = 'Guarda este link: desde ahí puedes ver, cambiar o cancelar tu cita.';
      $('doneActions').prepend(h('a', { class: 'btn', href: r.manageUrl }, 'Ver mi cita'));
    }
    $('done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  load();
})();
