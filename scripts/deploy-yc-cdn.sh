#!/usr/bin/env bash
# Подключает CDN с HTTPS поверх бакета, созданного deploy-yc.sh.
#
#   ./scripts/deploy-yc-cdn.sh <домен> [имя-бакета]
#   ./scripts/deploy-yc-cdn.sh safe-route.mlkv.fyi
#
# Сертификат выпускает сам CDN (Let's Encrypt), Certificate Manager не нужен.
# После создания ресурса скрипт печатает CNAME-запись, которую надо добавить
# у регистратора домена. HTTPS включится через несколько минут после того,
# как запись разойдётся по DNS.

set -euo pipefail

DOMAIN="${1:?укажи домен, например safe-route.mlkv.fyi}"
BUCKET="${2:-safe-route-$(yc config get folder-id | cut -c1-8)}"

echo "==> Домен: $DOMAIN"
echo "==> Бакет: $BUCKET"

if ! yc storage bucket get "$BUCKET" >/dev/null 2>&1; then
  echo "ОШИБКА: бакета $BUCKET нет. Сначала запусти ./scripts/deploy-yc.sh" >&2
  exit 1
fi

# Провайдер активируется один раз на облако; повторный вызов безвреден.
echo "==> Активирую CDN-провайдера (если ещё не активен)"
yc cdn provider activate --type gcore 2>/dev/null || echo "    уже активен"

if yc cdn resource get --cname "$DOMAIN" >/dev/null 2>&1; then
  echo "==> Ресурс CDN для $DOMAIN уже есть"
else
  echo "==> Создаю ресурс CDN"
  yc cdn resource create \
    --cname "$DOMAIN" \
    --origin-bucket-source "$BUCKET.website.yandexcloud.net" \
    --origin-bucket-name "$BUCKET" \
    --origin-protocol HTTP \
    --lets-encrypt-gcore-ssl-cert \
    --active
fi

echo
echo "==> Данные ресурса:"
yc cdn resource get --cname "$DOMAIN" --format json

PROVIDER_CNAME=$(yc cdn resource get --cname "$DOMAIN" --format json \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("provider_cname",""))')

cat <<EOF

────────────────────────────────────────────────────────
Добавь у регистратора домена DNS-запись:

    тип:     CNAME
    имя:     ${DOMAIN%%.*}
    значение: ${PROVIDER_CNAME:-<см. provider_cname выше>}

Если на домене стоит wildcard (*), эта запись его перекроет для
данного поддомена. HTTPS включится через несколько минут после
того, как запись разойдётся по DNS.

Проверка:  dig +short $DOMAIN
           curl -sI https://$DOMAIN | head -3
────────────────────────────────────────────────────────
EOF
