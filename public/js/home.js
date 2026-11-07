(function () {
  const { api, longDate, h } = SB;
  document.getElementById('year').textContent = new Date().getFullYear();

  api('/api/config').then((cfg) => {
    if (cfg.whatsapp) {
      document.getElementById('contact').append(
        'WhatsApp: ',
        h('a', { href: `https://wa.me/${cfg.whatsapp}`, rel: 'noopener' }, SB.phonePretty(cfg.whatsapp))
      );
    }
  }).catch(() => {});

  api('/api/calendar').then((cal) => {
    const note = document.getElementById('agendaNote');
    note.append(
      'Agenda abierta hasta el ', h('strong', {}, longDate(cal.window.end)),
      '. Las siguientes fechas se habilitan el ', h('strong', {}, `${longDate(cal.window.nextUnlock)} a las ${cal.window.nextUnlockTime}`), '.'
    );
  }).catch(() => {});
})();
