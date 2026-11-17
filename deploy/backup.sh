#!/usr/bin/env bash
# Copia de seguridad de la base de datos (Postgres) en ./backups, y borra las de hace más de 14 días.
# Uso:   bash deploy/backup.sh
# Programarla cada noche a las 3 a. m.:   crontab -e   y agregar
#   0 3 * * * cd /ruta/al/proyecto && bash deploy/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
FILE="backups/sebasbarber-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U sebasbarber --clean --if-exists sebasbarber | gzip > "$FILE"
find backups -name 'sebasbarber-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') copia guardada: $FILE ($(du -h "$FILE" | cut -f1))"
