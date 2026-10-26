#!/usr/bin/env bash
# Разворачивает статику в Yandex Object Storage с включённым хостингом сайта.
#
#   ./scripts/deploy-yc.sh [имя-бакета]
#
# Требует авторизованный yc (`yc init`). CDN и HTTPS настраиваются отдельно и
# только для собственного домена — см. README раздела про деплой.

set -euo pipefail

BUCKET="${1:-safe-route-$(yc config get folder-id | cut -c1-8)}"
FOLDER_ID="$(yc config get folder-id)"

# Только то, что нужно браузеру: тесты, доки и скрипты на сайте не нужны.
ASSETS=(
  index.html
  src/config.js src/geo.js src/osm-fetch.js src/geocode.js
  src/graph.js src/enrich.js src/risk.js src/router.js src/explain.js
  src/route-provider/local.js
  src/ui/map.js src/ui/panel.js src/ui/danger-zones.js
  src/main.js src/styles.css src/soft-brutalist.css
)

echo "==> Каталог: $FOLDER_ID"
echo "==> Бакет:   $BUCKET"

if ! yc storage bucket get "$BUCKET" >/dev/null 2>&1; then
  echo "==> Создаю бакет"
  yc storage bucket create \
    --name "$BUCKET" \
    --default-storage-class standard \
    --public-read \
    --max-size 1073741824
else
  echo "==> Бакет уже есть"
  yc storage bucket update --name "$BUCKET" --public-read
fi

echo "==> Включаю хостинг сайта"
yc storage bucket update --name "$BUCKET" \
  --website-settings index=index.html,error=index.html

echo "==> Загружаю файлы"
for f in "${ASSETS[@]}"; do
  [ -f "$f" ] || { echo "ОШИБКА: нет файла $f" >&2; exit 1; }
  case "$f" in
    *.html) CT="text/html; charset=utf-8" ;;
    *.css)  CT="text/css; charset=utf-8" ;;
    *.js)   CT="text/javascript; charset=utf-8" ;;
    *)      CT="application/octet-stream" ;;
  esac
  # index.html не кэшируем, остальное — на час: иначе правки не доедут.
  if [ "$f" = "index.html" ]; then CACHE="no-cache"; else CACHE="public, max-age=3600"; fi
  yc storage s3api put-object \
    --bucket "$BUCKET" --key "$f" --body "$f" \
    --content-type "$CT" --cache-control "$CACHE" >/dev/null
  echo "    $f"
done

echo
echo "Готово: http://$BUCKET.website.yandexcloud.net"
