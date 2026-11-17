# Publicar Sebas Barber en tu VPS (paso a paso)

Todo corre en tu servidor con **un solo comando**: la app, la base de datos Postgres, WAHA (WhatsApp) y HTTPS.

```
   internet ──▶ Caddy (HTTPS) ──▶ app (Node) ──▶ Postgres
                                      └────────▶ WAHA ──▶ tu WhatsApp Business ──▶ el cliente
```

> Un `.exe` único no es posible porque Postgres es un programa aparte. Lo equivalente es esto: **Docker Compose**
> levanta todo junto con `docker compose up -d` (o con `bash deploy/install.sh` la primera vez).
> Esta guía es para un servidor **Linux (Ubuntu o Debian)**, que es lo normal en un VPS.

## 1. Qué necesitas

| | |
|---|---|
| **VPS** | Ubuntu 22.04 o 24.04, **2 GB de RAM** recomendado (1 GB alcanza justo), 1 CPU, 10 GB de disco. |
| **Dominio** | Uno que ya apunte a la IP del VPS (registros **A** de `@` y `www`; paso a paso abajo). Sin dominio no hay HTTPS. |
| **Puertos** | 80 y 443 abiertos al público (el 22 es el de SSH). |
| **Celular** | Con tu **WhatsApp Business** (el que enviará los mensajes) para escanear un QR una sola vez. |

### Apuntar el dominio al VPS (Namecheap)

1. Averigua la **IP pública del VPS**: está en el panel de tu proveedor, o desde el servidor con `curl ifconfig.me`.
2. En Namecheap: **Domain List → Manage** (tu dominio) **→ Advanced DNS**.
3. En *Host Records* **borra** los dos registros que trae de fábrica (ícono de papelera): `CNAME www → parkingpage.namecheap.com` y `URL Redirect @`. Si quedan, el dominio sigue mostrando la página de Namecheap.
4. **ADD NEW RECORD** y crea estos dos, con *TTL* en *Automatic*:

   | Type | Host | Value |
   |---|---|---|
   | **A Record** | `@` | la IP del VPS |
   | **A Record** | `www` | la IP del VPS |

5. Guarda con el ✔ verde de cada fila. **No toques** el registro TXT de *Mail Settings* (`v=spf1 ...`): es del correo.
6. Espera de 5 a 30 minutos y comprueba que ya apunta al servidor: `nslookup sebas-barber.com` debe mostrar la IP del VPS (o mira en dnschecker.org).

Cuando el instalador te pida el dominio, escribe `sebas-barber.com` **sin www**: `www.sebas-barber.com` redirige solo.

Si algún día pasas el dominio por Cloudflare, deja el registro en **"Solo DNS" (nube gris)** al principio; con la nube naranja usa el modo SSL **Full (strict)**.

## 2. Subir el proyecto al servidor

Entra por SSH (`ssh usuario@IP-del-VPS`) y trae el código:

```bash
git clone https://github.com/eruizdev/barber-shop sebas-barber
cd sebas-barber
git checkout process        # la rama con todo lo nuevo (o la que uses)
```

## 3. Instalar y arrancar (un comando)

```bash
bash deploy/install.sh
```

Te pregunta **dos cosas**: tu dominio y el WhatsApp del negocio (con 57). Después hace solo todo esto:

1. Instala Docker si no lo tienes.
2. Crea el archivo `.env` con **claves al azar** (base de datos, sesión, WAHA, panel) y te muestra las **claves del panel `/admin`**. **Anótalas.**
3. Construye y arranca la app, Postgres, WAHA y Caddy.
4. Caddy saca solo el certificado HTTPS (Let's Encrypt) y lo renueva.

Cuando termine, abre `https://tudominio.com`. Si no abre, espera 1–2 minutos y revisa que el DNS ya apunte al servidor.

## 4. Vincular tu WhatsApp Business (una sola vez)

El panel de WAHA **no está abierto a internet** (por seguridad). Para entrar, haz un túnel SSH **desde tu computador**:

```bash
ssh -L 3001:localhost:3001 usuario@IP-del-VPS
```

Déjalo abierto y en tu navegador abre **http://localhost:3001/dashboard**.

1. Entra con el usuario y la clave de WAHA (`WAHA_DASHBOARD_USER` y `WAHA_DASHBOARD_PASSWORD` del archivo `.env`; en el servidor: `cat .env`).
   Si te pide una **API Key**, es `WAHA_API_KEY` del mismo archivo.
2. En la sesión **`default`** aparece el **código QR**. Si dice *STOPPED*, toca **Start**.
3. En tu celular: **WhatsApp Business → ⋮ (menú) → Dispositivos vinculados → Vincular un dispositivo** y escanea el QR.
4. Cuando el estado diga **WORKING**, ya quedó. Cierra el túnel (`Ctrl + C`).

El vínculo queda guardado: no hay que repetirlo al reiniciar el servidor.

**Probarlo** (en el servidor, con tu propio número):

```bash
docker compose exec app node scripts/test-whatsapp.js 3001234567
```

Debe decir `Estado de WhatsApp en WAHA: WORKING` y llegarte un mensaje.

## 5. Qué mensajes se envían

Todos salen desde **tu WhatsApp Business**, a números colombianos (el sistema agrega el +57 solo).

- **Al reservar** (o al cambiar la cita desde su link): confirmación con el día, la hora, el servicio y el **link** para ver, cambiar o cancelar.
- **1 hora antes de la cita: recordatorio.** Lee el celular de cada cita del calendario y de los **turnos fijos que tengan celular** (el de los fijos se agrega en el panel → *Turnos fijos → Editar*). Cada recordatorio sale **una sola vez**. Si la cita se reprograma, vuelve a avisar.
- Si la cita se agenda cuando ya falta menos de 1 hora (ej. el admin agenda a las 10:15 p. m. una cita de las 11:00 p. m.), el recordatorio **sale de una vez**. Si prefieres no mandarlo a las citas recién agendadas, pon en `.env` `REMINDER_SKIP_IF_BOOKED_WITHIN_MIN=90` (minutos).
- Las citas que agrega el admin desde el panel también reciben el recordatorio, **a cualquier hora** (aunque sea fuera del horario, ej. 10:00 p. m.).
- Los minutos de anticipación se cambian con `REMINDER_MINUTES_BEFORE` (por defecto `60`).
- Si el WhatsApp se desvincula, la app **no pierde los recordatorios**: espera y avisa en el log. Los manda cuando lo vuelvas a vincular, siempre que todavía falte tiempo para la cita.

**Probar el recordatorio de punta a punta:** en el panel crea una cita con **tu número** para dentro de ~2 horas; 1 hora antes te llega el mensaje.

## 5b. Avisos al celular del admin cuando entra una cita

El panel `/admin` puede mandar una **notificación al celular** cada vez que un cliente reserva, cambia o cancela su cita desde la web (aunque el panel esté cerrado). No hay que configurar nada en el servidor: las claves se crean solas.

- **Android (Chrome):** entra a `https://tudominio.com/admin`, toca **🔕 Activar notificaciones** y acepta el permiso. Llega un aviso de prueba.
- **iPhone (iOS 16.4 o más nuevo):** en Safari abre `https://tudominio.com/admin` → **Compartir (□↑) → Agregar a pantalla de inicio**. Abre el panel **desde ese ícono**, toca **Activar notificaciones** y acepta.
- **Computador (Chrome/Edge):** igual que Android; llegan mientras el navegador esté abierto.

**También por WhatsApp:** cada reserva, cambio o cancelación del cliente manda un WhatsApp al número de `BUSINESS_WHATSAPP`. Para mandarlo a otro(s) número(s), en `.env`: `ADMIN_NOTIFY_WHATSAPP=573001234567,573009876543`; para apagarlo: `ADMIN_NOTIFY_WHATSAPP=off`. Luego `docker compose up -d`.

Cada admin lo activa en cada dispositivo donde quiera recibir avisos. Para quitarlo, toca **🔔 Notificaciones activas**.
La sesión del panel **no se cierra sola** (dura 400 días y se renueva cada vez que entras); solo se cierra con **Salir**.

## 6. Día a día

```bash
docker compose ps                  # ¿está todo encendido?
docker compose logs -f app         # ver lo que hace la app (Ctrl + C para salir)
docker compose logs -f waha        # ver WAHA
docker compose restart app         # reiniciar la app
```

**Actualizar** cuando cambies el código:

```bash
git pull
docker compose up -d --build
```

Los datos (Postgres y el vínculo de WhatsApp) viven en volúmenes de Docker: **actualizar no los borra**.

**Copia de seguridad** de la base de datos (citas y turnos fijos):

```bash
bash deploy/backup.sh              # guarda un .sql.gz en ./backups y borra las de más de 14 días
```

Para que se haga sola cada noche a las 3 a. m.: `crontab -e` y agrega
`0 3 * * * cd /ruta/a/sebas-barber && bash deploy/backup.sh >> backups/backup.log 2>&1`

**Restaurar:** `bash deploy/restore.sh backups/sebasbarber-AAAAMMDD-HHMMSS.sql.gz` y luego `docker compose restart app`.

> Las citas se borran solas 3 días después de su fecha (`HISTORY_DAYS`) para que la base de datos no crezca.

## 7. Seguridad (lo que ya está hecho y lo que te toca)

- **El tráfico va cifrado (HTTPS):** nadie en el camino puede leer lo que viaja entre el cliente y el servidor. HTTP se redirige solo a HTTPS.
- Solo se abren al público los puertos **80 y 443**. Postgres y la app **no** están expuestos; el panel de WAHA solo se ve por túnel SSH.
- Las claves del `.env` se generan al azar. El archivo `.env` **no se sube a git**. Guarda una copia de las claves en un lugar seguro.
- Recomendado: activar el firewall del servidor.
  ```bash
  sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
  ```
- Docker puede saltarse `ufw` con los puertos que publica; por eso este proyecto solo publica 80, 443 y el 3001 **únicamente en 127.0.0.1**.

## 8. Si algo falla

| Síntoma | Qué mirar |
|---|---|
| `https://tudominio.com` no abre | ¿El registro A apunta a la IP del VPS? ¿Puertos 80/443 abiertos? Mira `docker compose logs caddy`. |
| La web abre pero dice "No pudimos cargar el calendario" | `docker compose logs app` (casi siempre es la base de datos o una variable del `.env`). |
| No llegan los mensajes de WhatsApp | `docker compose exec app node scripts/test-whatsapp.js`. Si dice `SCAN_QR_CODE` o `STOPPED`, hay que volver a vincular (sección 4). |
| WAHA pide el QR otra vez | El celular cerró la sesión de dispositivos vinculados. Repite la sección 4. |
| "No se pudo arrancar: Falta DATABASE_URL" | No uses `node server.js` suelto: se arranca con `docker compose up -d`. |
| Olvidé las claves del panel | `cat .env` en el servidor (líneas `ADMIN1_PASS` y `ADMIN2_PASS`). Si las cambias: `docker compose up -d`. |

## 9. Lo que conviene saber de WAHA

- WAHA usa el mismo protocolo que **WhatsApp Web** (no es la API oficial de Meta). Es gratis y deja mandar mensajes libres, **sin plantillas aprobadas**.
- Por eso WhatsApp puede limitar un número que mande mensajes masivos o no deseados. Este sistema solo escribe a quien acaba de reservar (confirmación y un recordatorio) y deja una pausa de unos segundos entre mensajes: es un uso de bajo riesgo, pero no cero. Evita usar ese número para publicidad.
- La versión gratuita de WAHA (Core) maneja **una sola sesión de WhatsApp**: justo lo que se necesita aquí.
