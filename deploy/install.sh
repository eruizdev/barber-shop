#!/usr/bin/env bash
# Instala y arranca TODO en un servidor Linux (Ubuntu / Debian): Docker, Postgres, WAHA, la app y HTTPS.
# Uso (desde la carpeta del proyecto):   bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
rand() { openssl rand -hex "${1:-16}"; }

if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; else SUDO=""; fi

# ---------- 1. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  say "Instalando Docker (puede tardar un par de minutos)..."
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Falta 'docker compose'. Instala el plugin: https://docs.docker.com/compose/install/linux/" >&2; exit 1
fi
DOCKER="docker"; if ! docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"; fi

# ---------- 2. Archivo .env ----------
if [ -f .env ]; then
  say "Ya existe .env: lo dejo como está."
else
  say "Configuración inicial"
  read -r -p "Tu dominio, ya apuntando a la IP de este servidor (ej. sebasbarber.com): " DOMAIN
  DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  [ -n "$DOMAIN" ] || { echo "El dominio es obligatorio (HTTPS lo necesita)." >&2; exit 1; }
  read -r -p "WhatsApp del negocio, con 57 (ej. 573001234567) [Enter para omitir]: " BIZ || BIZ=""
  A1="$(rand 9)"; A2="$(rand 9)"
  sed -e "s|__DOMAIN__|${DOMAIN}|" \
      -e "s|__DB_PASSWORD__|$(rand 16)|" \
      -e "s|__SESSION_SECRET__|$(rand 32)|" \
      -e "s|__ADMIN1_PASS__|${A1}|" \
      -e "s|__ADMIN2_PASS__|${A2}|" \
      -e "s|__BUSINESS_WHATSAPP__|${BIZ//[^0-9]/}|" \
      -e "s|__WAHA_API_KEY__|$(rand 24)|" \
      -e "s|__WAHA_DASHBOARD_PASSWORD__|$(rand 9)|" \
      deploy/env.template > .env
  chmod 600 .env
  say "CLAVES DEL PANEL /admin (anótalas ahora; también quedan en el archivo .env)"
  echo "   sebasraigoza  ->  ${A1}"
  echo "   ruiz          ->  ${A2}"
fi

# ---------- 3. Arrancar ----------
say "Construyendo y arrancando (la primera vez tarda unos minutos)..."
$DOCKER compose up -d --build

say "Esperando a que la app responda..."
for i in $(seq 1 40); do
  if $DOCKER compose exec -T app wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done
[ "${OK:-0}" = "1" ] || { echo "La app no respondió. Mira el motivo con:  docker compose logs app" >&2; exit 1; }

DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2-)"
say "Listo"
echo "   Página:  https://${DOMAIN}"
echo "   Panel:   https://${DOMAIN}/admin"
echo
echo "   Falta UN paso: vincular tu WhatsApp Business (escanear un QR). Mira DEPLOY.md, sección 4."
echo "   Si https no abre todavía, espera 1-2 minutos (Caddy está sacando el certificado) y revisa que el DNS de ${DOMAIN} apunte a este servidor."
