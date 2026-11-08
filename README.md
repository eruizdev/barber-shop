# Sebas Barber — web de reservas + panel admin

Sitio de la barbería con botón **RESERVAR CITA**, calendario que se habilita cada 2 semanas (hora de Colombia) y panel oculto en `/admin`.

## Arrancar

```bash
npm install
npm start          # http://localhost:3000   (panel: http://localhost:3000/admin)
npm test           # pruebas de horario, festivos y API
```

Requiere Node 22.13 o superior (usa el SQLite incluido en Node, no hay que compilar nada). La base de datos (SQLite) se crea sola en `data/sebasbarber.db`.

## Accesos del panel (`.env`)

```
ADMIN1_USER=sebasraigoza   ADMIN1_PASS=tu_clave_segura
ADMIN2_USER=ruiz           ADMIN2_PASS=otra_clave_segura
```

Puedes agregar hasta 5 (`ADMIN3_USER`, `ADMIN3_PASS`, ...). Reinicia el servidor después de cambiarlos.
**Antes de publicar, cambia la clave de `ruiz`**: `ruiz` es demasiado fácil de adivinar. El `.env` no debe subirse a GitHub (ya está en `.gitignore`).

El panel no tiene enlace en la web: se entra escribiendo `/admin`. Eso lo oculta, pero lo que lo protege es el login (con límite de intentos y cookie de sesión de 12 h).

## Reglas de agenda

| Día | Horario |
|---|---|
| Lunes a miércoles y festivos | 8:00–11:00 y 14:00–20:00 |
| Jueves a sábado | 8:00–20:00 continuo |
| Domingo | cerrado (si es festivo, usa el horario de festivos) |

- 1 reserva = 1 hora. Si el servicio dura más de 1 h 10 min (hoy el VIP 1, 1 h 30), ocupa 2 horas seguidas y solo se ofrecen horas donde alcanzan las 2 antes del cierre. Una persona a la vez (una sola silla). Las duraciones están en `src/services.js`.
- Los **festivos de Colombia** se calculan solos para cualquier año (Ley Emiliani, Semana Santa, etc.).
- **Calendario cada 2 semanas:** la agenda se abre domingo por medio a las 8:00 a. m. (hora Colombia, `BOOKING_OPEN_TIME`), con las 2 semanas siguientes (lunes a domingo). Los bloques se cuentan desde `BOOKING_ANCHOR` (un lunes, por defecto `2026-11-02`). Con el ancla por defecto: bloque actual 2–15 nov; el domingo 15 nov a las 8:00 a. m. se abre 16–29 nov; el domingo 29 nov, 30 nov–13 dic...
- `MIN_LEAD_MINUTES` (60): no se puede reservar una hora que empieza en menos de ese tiempo.
- `MAX_ACTIVE_PER_PHONE` (2): citas activas por celular, para evitar abusos.
- `HISTORY_DAYS` (3): días que se guarda una cita después de su fecha. Pasado ese tiempo se borra sola (se revisa al arrancar y cada 6 horas), para que la base de datos no crezca.

## Qué puede hacer el admin

- **Calendario** semanal: cada hora con el nombre y el celular de quien reservó; las citas de 2 horas ocupan 2 filas. Toca una hora libre para agendar ahí.
- **Turnos fijos**: clientes con la misma hora cada semana o cada 2 semanas (día, hora, nombre, celular opcional, primera fecha). Esas horas quedan ocupadas solas y en la web salen como **BLOQUEADA**. Si un cliente fijo no viene un día, en el calendario se toca su turno → *Liberar solo este día*. Los turnos iniciales de viernes y sábado se cargan solos la primera vez que arranca el servidor.

- Ver citas por hoy, mañana, 7/14 días, todo lo próximo o historial; filtrar por estado; buscar por nombre, celular o código.
- **Crear** cita manual, **editar / reprogramar** (fecha, hora, nombre, celular, nota), marcar **completada** o **no asistió**, **cancelar** (libera la hora), **reactivar**, **eliminar**.
- Botón **WhatsApp** por cita, con mensaje listo para avisar al cliente.
- **Bloqueos** de un día completo o de una hora.
- Como admin puedes agendar fuera del calendario de 2 semanas y fuera del horario normal; el sistema solo impide que dos citas se pisen.

## El cliente gestiona su cita (link por WhatsApp)

Al reservar, el cliente recibe por WhatsApp un link privado `https://tu-dominio/cita/<token>`. Desde ahí puede:

- ver su cita (día, hora, estado);
- **cambiar** el día o la hora, dentro de la agenda abierta (le llega de nuevo la confirmación por WhatsApp);
- **cancelar** (la hora queda libre).

Solo se puede cambiar o cancelar si la cita sigue confirmada y falta al menos `MIN_LEAD_MINUTES`. Si WhatsApp no está configurado o el envío falla, la pantalla de confirmación muestra el botón **Ver mi cita** con el mismo link.

## WhatsApp con Meta Cloud API

Los mensajes que envía el negocio tienen que ser **plantillas aprobadas** por Meta.

1. En [developers.facebook.com](https://developers.facebook.com/apps) crea una app tipo **Business** y agrega el producto **WhatsApp**. Queda conectada a la cuenta de WhatsApp Business (WABA) del negocio.
2. En **WhatsApp → Configuración de la API**: agrega y verifica el número del negocio y copia su **Phone number ID**.
   Con el número de prueba de Meta solo se puede enviar a números que agregues como destinatarios de prueba (hasta 5).
3. Token permanente: en **Configuración del negocio → Usuarios del sistema**, crea un usuario admin, asígnale la app y la cuenta de WhatsApp y genera un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. (El token temporal del panel dura 24 h.)
4. En **WhatsApp Manager → Plantillas**, crea estas dos (categoría **Utilidad**, idioma **Español (es)**):

   **`confirmacion_cita`**, se envía al reservar y al reprogramar:
   ```
   Hola {{1}}, tu cita en Sebas Barber quedó confirmada para el {{2}} a las {{3}}.

   Desde este link puedes ver, cambiar o cancelar tu cita: {{4}}

   ¡Te esperamos!
   ```
   Ejemplos para la revisión: `Carlos`, `sábado 7 de noviembre`, `8:00 a. m.`, `https://sebasbarber.com/cita/abc123`.

   **`recordatorio_cita`**, se envía `REMINDER_HOURS_BEFORE` horas antes:
   ```
   Hola {{1}}, te recordamos tu cita en Sebas Barber el {{2}} a las {{3}}. Si no puedes asistir, avísanos por este medio.
   ```
5. En `.env`:
   ```
   PUBLIC_URL=https://tu-dominio.com
   WHATSAPP_ENABLED=true
   WHATSAPP_TOKEN=<token permanente>
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_CONFIRM_TEMPLATE=confirmacion_cita
   WHATSAPP_TEMPLATE=recordatorio_cita
   WHATSAPP_LANG=es
   ```
   `PUBLIC_URL` es la dirección del sitio que va en el link. Si no está, se usa la del navegador (en local sería `localhost`, que no sirve en el celular del cliente).
6. Reinicia. Los errores de envío aparecen en la consola del servidor.

Coste aproximado en Colombia: los mensajes de utilidad cuestan centavos de dólar cada uno (confirma la tarifa vigente en Meta).

## Publicar

- Servidor con Node (Railway, Render, Fly.io o un VPS con `pm2`). Si usas un disco o volumen, apunta `DB_PATH` allí para no perder las citas.
- Con HTTPS pon `COOKIE_SECURE=true` y, si hay proxy, `TRUST_PROXY=true`.
- Haz copia de seguridad de `data/sebasbarber.db`.
- Cambia `BUSINESS_WHATSAPP` (con 57) para mostrar el botón de contacto en la web.

## Estructura

```
server.js            rutas y API
src/schedule.js      horarios, ventana de 2 semanas, disponibilidad
src/holidays.js      festivos de Colombia
src/db.js            SQLite
src/auth.js          login admin desde .env
src/whatsapp.js      cliente de WhatsApp Cloud API (Meta)
src/notify.js        confirmación por WhatsApp con el link de la cita
src/reminders.js     recordatorios WhatsApp
src/cita-routes.js   API del cliente: ver, reprogramar, cancelar (/api/cita/:token)
public/              web pública (inicio, reservar, mi cita)
admin-ui/            panel /admin
test/                pruebas
```
