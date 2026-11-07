# Sebas Barber — web de reservas + panel admin

Sitio de la barbería con botón **RESERVAR CITA**, calendario que se habilita cada 2 semanas (hora de Colombia) y panel oculto en `/admin`.

## Arrancar

```bash
npm install
npm start          # http://localhost:3000   (panel: http://localhost:3000/admin)
npm test           # pruebas de horario, festivos y API
```

Requiere Node 18 o superior. La base de datos (SQLite) se crea sola en `data/sebasbarber.db`.

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

- 1 reserva = 1 hora. Una persona por hora (una sola silla).
- Los **festivos de Colombia** se calculan solos para cualquier año (Ley Emiliani, Semana Santa, etc.).
- **Calendario cada 2 semanas:** los bloques de 14 días se cuentan desde `BOOKING_ANCHOR` (un lunes, por defecto `2026-11-02`). Solo se puede reservar dentro del bloque actual; el siguiente se abre solo a las 00:00 hora de Colombia. Con el ancla por defecto: bloque actual hasta el 15 nov, siguiente desde el 16 nov, luego 30 nov, 14 dic...
- `MIN_LEAD_MINUTES` (60): no se puede reservar una hora que empieza en menos de ese tiempo.
- `MAX_ACTIVE_PER_PHONE` (2): citas activas por celular, para evitar abusos.

## Qué puede hacer el admin

- Ver citas por hoy, mañana, 7/14 días, todo lo próximo o historial; filtrar por estado; buscar por nombre, celular o código.
- **Crear** cita manual, **editar / reprogramar** (fecha, hora, nombre, celular, nota), marcar **completada** o **no asistió**, **cancelar** (libera la hora), **reactivar**, **eliminar**.
- Botón **WhatsApp** por cita, con mensaje listo para avisar al cliente.
- **Bloqueos** de un día completo o de una hora.
- **Actividad**: quién hizo qué y cuándo.
- Como admin puedes agendar fuera del calendario de 2 semanas y fuera del horario normal; el sistema solo impide que dos citas se pisen.

## Recordatorios por WhatsApp (opcional, desactivado)

1. En Meta Business: WABA del dueño, número verificado, usuario del sistema con token permanente.
2. Crea y aprueba una plantilla **Utilidad**, idioma `es`, llamada `recordatorio_cita`:
   `Hola {{1}}, te recordamos tu cita en Sebas Barber el {{2}} a las {{3}}. Si no puedes asistir, avísanos por este medio.`
3. En `.env`: `WHATSAPP_ENABLED=true`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
4. Reinicia. Cada 5 minutos envía el recordatorio a las citas confirmadas que empiezan dentro de `REMINDER_HOURS_BEFORE` horas (24 por defecto), una sola vez por cita. Si se reprograma, se reenvía.

Coste aproximado en Colombia: menos de 1 USD al mes para 600 mensajes (confirma la tarifa vigente en Meta).

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
src/reminders.js     recordatorios WhatsApp (opcional)
public/              web pública (inicio y reservar)
admin-ui/            panel /admin
test/                pruebas
```
