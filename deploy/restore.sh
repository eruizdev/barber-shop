#!/usr/bin/env bash
# Restaura una copia de seguridad.   Uso:   bash deploy/restore.sh backups/sebasbarber-20261116-030000.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "${1:-}" ] || { echo "Uso: bash deploy/restore.sh backups/<archivo>.sql.gz" >&2; exit 1; }
read -r -p "Esto REEMPLAZA los datos actuales por los de $1. ¿Seguro? (escribe si): " R
[ "$R" = "si" ] || { echo "Cancelado."; exit 1; }
gunzip -c "$1" | docker compose exec -T db psql -U sebasbarber -d sebasbarber -v ON_ERROR_STOP=1 >/dev/null
echo "Restaurado. Reinicia la app:  docker compose restart app"
