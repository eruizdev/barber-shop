# Sebas Barber — web de reservas + panel admin

Sitio de la barbería con botón **RESERVAR CITA**, calendario que se habilita cada 2 semanas (hora de Colombia) y panel oculto en `/admin`.

## Arrancar

**En un servidor (producción):** mira **[DEPLOY.md](DEPLOY.md)**. Todo (app, Postgres, WAHA y HTTPS) se levanta con `bash deploy/install.sh`.

**Para programar en tu computador:** necesitas Node 20+ y un Postgres (por ejemplo en Docker: `docker run -d --name sb-pg -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sebasbarber postgres:17-alpine`).

```bash
npm install
# en el .env:  DATABASE_URL=postgres://postgres:dev@localhost:5432/sebasbarber   (+ ADMIN1_USER / ADMIN1_PASS)
npm start          # http://localhost:3000   (panel: http://localhost:3000/admin)
npm test           # pruebas de horario, API, recordatorios y WhatsApp (levantan su propio Postgres temporal)
```

Las tablas se crean solas al arrancar. `npm test` no necesita Docker: usa un Postgres temporal (o el de `TEST_DATABASE_URL` si lo defines).

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
| Lunes a miércoles y festivos | 8:00–11:00 y 14:00–21:00 (última cita 8:00 p. m.) |
| Jueves a sábado | 8:00–21:00 continuo (última cita 8:00 p. m.) |
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

## WhatsApp con WAHA (confirmación y recordatorio)

Los mensajes salen de **tu WhatsApp Business** a través de [WAHA](https://waha.devlike.pro), que corre en su propio contenedor:

- **Al reservar** o cambiar la cita: confirmación con el link de la cita.
- **1 hora antes** (`REMINDER_MINUTES_BEFORE`): recordatorio a cada cita del calendario y a los turnos fijos que tengan celular. Una sola vez por cita.

Todos los números son de Colombia: se guardan como `57XXXXXXXXXX` y el sistema agrega el +57 solo. La configuración está en `.env` (`WHATSAPP_ENABLED`, `WAHA_URL`, `WAHA_API_KEY`, `PUBLIC_URL`); el paso a paso para vincular el WhatsApp (escanear un QR) está en **[DEPLOY.md](DEPLOY.md)**, sección 4.

## Publicar

Todo el procedimiento (servidor Linux, dominio, HTTPS, base de datos, WhatsApp, copias de seguridad y actualizaciones) está en **[DEPLOY.md](DEPLOY.md)**.

## Estructura

```
server.js            rutas y API
src/schedule.js      horarios, ventana de 2 semanas, disponibilidad
src/holidays.js      festivos de Colombia
src/db.js            PostgreSQL (citas, turnos fijos, bloqueos)
src/auth.js          login admin desde .env
src/whatsapp.js      cliente de WAHA (WhatsApp)
src/notify.js        textos y envío de la confirmación (con el link de la cita)
src/reminders.js     recordatorio 1 hora antes (citas y turnos fijos)
src/cleanup.js       borra citas viejas (HISTORY_DAYS)
src/cita-routes.js   API del cliente: ver, reprogramar, cancelar (/api/cita/:token)
public/              web pública (inicio, reservar, mi cita)
admin-ui/            panel /admin
test/                pruebas (Postgres temporal + WAHA falso)
Dockerfile, docker-compose.yml, deploy/   despliegue en el VPS (ver DEPLOY.md)
scripts/test-whatsapp.js   prueba de envío por WAHA
```
