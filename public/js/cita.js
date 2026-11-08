// Página /cita/<token>: el cliente ve, reprograma o cancela su cita.
(function () {
  const { api, h, longDate, shortDate, time12 } = SB;
  const $ = (id) => document.getElementById(id);

  const token = decodeURIComponent(location.pathname.split('/')[2] || '');
  const base = `/api/cita/${encodeURIComponent(token)}`;
  const STATUS = {
    confirmed: 'Confirmada', completed: 'Completada', no_show: 'No asistió', cancelled: 'Cancelada',
  };

  let appt = null;
  let cfg = { whatsapp: '' };
  let selDate = null;
  let selTime = null;

  const show = (id, on = true) => { $(id).hidden = !on; };
  function flash(msg) { $('flash').textContent = msg; show('flash', Boolean(msg)); }

  async function load() {
    if (!token) { fail('Este link no es válido. Revisa el mensaje de WhatsApp.'); return; }
    try {
      const [c, r] = await Promise.all([api('/api/config').catch(() => cfg), api(base)]);
      cfg = c; appt = r.appointment;
      renderCard();
    } catch (e) {
      fail(e.status === 404 ? e.message : 'No pudimos cargar tu cita. Intenta de nuevo en un momento.');
    }
  }

  function fail(msg) { const e = $('loadError'); e.textContent = msg; e.hidden = false; }

  function waLink(text) {
    return cfg.whatsapp ? `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(text)}` : null;
  }

  function renderCard() {
    const s = $('status');
    s.textContent = STATUS[appt.status] || appt.status;
    s.className = `status is-${appt.status}`;
    $('when').textContent = `${longDate(appt.date)} a las ${time12(appt.time)}`;
    $('meta').replaceChildren(
      'A nombre de ', h('b', {}, appt.name), ' · Código ', h('b', {}, appt.code),
      ...(appt.service ? [h('br'), 'Servicio: ', h('b', {}, appt.service)] : [])
    );

    const locked = appt.status === 'confirmed' && !appt.canModify;
    show('actions', appt.canModify);
    show('lockedNote', locked);
    if (locked) $('lockedNote').textContent = 'Tu cita es muy pronto para cambiarla desde aquí. Si necesitas algo, escríbenos por WhatsApp.';

    const contact = $('contact');
    contact.replaceChildren();
    if (appt.status === 'cancelled') contact.append(h('a', { class: 'btn', href: '/reservar' }, 'Reservar otra cita'));
    const wa = waLink(`Hola, soy ${appt.name}. Tengo cita el ${longDate(appt.date)} a las ${time12(appt.time)} (código ${appt.code}).`);
    if (wa) contact.append(h('a', { class: 'btn btn-outline', href: wa, rel: 'noopener' }, 'Escribir por WhatsApp'));

    show('card');
  }

  // ---------- Cancelar ----------
  $('btnCancel').addEventListener('click', () => {
    closeChange();
    $('cancelText').textContent = `Vas a cancelar tu cita del ${longDate(appt.date)} a las ${time12(appt.time)}. La hora quedará libre para otra persona.`;
    $('cancelError').textContent = '';
    show('confirmCancel');
    $('confirmCancel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btnCancelNo').addEventListener('click', () => show('confirmCancel', false));
  $('btnCancelYes').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      appt = (await api(`${base}/cancel`, { method: 'POST' })).appointment;
      show('confirmCancel', false);
      renderCard();
      flash('Tu cita fue cancelada.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      $('cancelError').textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Reprogramar ----------
  $('btnChange').addEventListener('click', openChange);
  $('btnChangeNo').addEventListener('click', () => { closeChange(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  async function openChange() {
    show('confirmCancel', false);
    flash('');
    selDate = null; selTime = null;
    show('stepTime', false); show('stepConfirm', false);
    show('change');
    const box = $('days');
    box.replaceChildren(h('p', { class: 'empty' }, 'Cargando…'));
    try {
      const cal = await api(`/api/calendar?slots=${appt.slots || 1}`);
      const days = cal.days.filter((d) => d.open && (d.free > 0 || d.date === appt.date));
      box.replaceChildren(...days.map((d) => h('button', {
        type: 'button', class: 'chip', 'data-date': d.date,
        onclick: () => pickDay(d.date),
      }, shortDate(d.date), d.date === appt.date ? h('small', {}, 'tu día') : null)));
      show('daysEmpty', days.length === 0);
    } catch (e) {
      box.replaceChildren(h('p', { class: 'error' }, 'No pudimos cargar la agenda. Intenta de nuevo.'));
    }
    $('change').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeChange() { show('change', false); }

  function markSelected(container, attr, value) {
    for (const el of $(container).querySelectorAll('.chip')) {
      el.classList.toggle('is-selected', el.getAttribute(attr) === value);
    }
  }

  async function pickDay(date, errorMsg = '') {
    selDate = date; selTime = null;
    $('slotsError').textContent = errorMsg;
    markSelected('days', 'data-date', date);
    show('stepConfirm', false);
    $('dayLabel').textContent = `· ${longDate(date)}`;
    $('slots').replaceChildren();
    show('slotsEmpty', false);
    show('stepTime');
    try {
      const r = await api(`${base}/slots?date=${date}`);
      $('slots').replaceChildren(...r.slots.map((s) => {
        const mine = s.time === r.current;
        return h('button', {
          type: 'button', class: 'chip' + (s.reason === 'fixed' ? ' is-locked' : ''), 'data-time': s.time,
          disabled: !s.available || mine,
          onclick: () => pickTime(s.time),
        }, time12(s.time), mine ? h('small', {}, 'tu hora') : (s.reason === 'fixed' ? h('small', {}, 'BLOQUEADA') : null));
      }));
      show('slotsEmpty', !r.slots.some((s) => s.available && s.time !== r.current));
    } catch (e) {
      $('slots').replaceChildren(h('p', { class: 'error' }, e.message));
    }
    $('stepTime').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pickTime(time) {
    selTime = time;
    markSelected('slots', 'data-time', time);
    $('summary').replaceChildren(
      'Cambiar tu cita al ', h('b', {}, longDate(selDate)), ' a las ', h('b', {}, time12(time))
    );
    $('changeError').textContent = '';
    show('stepConfirm');
    $('stepConfirm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('btnChangeYes').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'GUARDANDO…';
    try {
      const r = await api(`${base}/reschedule`, { method: 'POST', body: { date: selDate, time: selTime } });
      appt = r.appointment;
      closeChange();
      renderCard();
      flash(r.whatsappSent
        ? 'Listo, tu cita cambió. Te enviamos la nueva confirmación por WhatsApp.'
        : 'Listo, tu cita cambió.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      $('changeError').textContent = e.message;
      if (e.status === 409 && selDate) pickDay(selDate, e.message); // la hora se ocupó: refrescar
    } finally {
      btn.disabled = false; btn.textContent = 'CONFIRMAR CAMBIO';
    }
  });

  load();
})();
