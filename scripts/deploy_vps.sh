#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)

VPS_HOST=${VPS_HOST:-VPS_HOST}
VPS_USER=${VPS_USER:-ubuntu}
VPS_SSH_KEY=${VPS_SSH_KEY:-/path/to/vps-key.pem}
VPS_APP_DIR=${VPS_APP_DIR:-/opt/karatahta-backend/app}
VPS_ENV_FILE=${VPS_ENV_FILE:-/etc/karatahta-backend.env}
VPS_DOMAIN=${VPS_DOMAIN:-api.karatahta.ethosoft.org}
CONTAINER_NAME=${CONTAINER_NAME:-karatahta-backend}
IMAGE_NAME=${IMAGE_NAME:-karatahta-backend}

SSH=(ssh -i "$VPS_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)
RSYNC_SSH="ssh -i $VPS_SSH_KEY -o BatchMode=yes -o ConnectTimeout=10"
REMOTE="$VPS_USER@$VPS_HOST"

if [[ ! -r "$VPS_SSH_KEY" ]]; then
  echo "SSH anahtari okunamiyor: $VPS_SSH_KEY" >&2
  exit 1
fi

echo "[1/6] Yerel testler"
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
done < <(find "$SOURCE_DIR" -path "$SOURCE_DIR/node_modules" -prune -o -path "$SOURCE_DIR/.git" -prune -o -name '*.js' -type f -print0)
npm test --prefix "$SOURCE_DIR"

echo "[2/6] VPS ortam on-kontrolu"
"${SSH[@]}" "$REMOTE" "VPS_ENV_FILE='$VPS_ENV_FILE' bash -s" <<'REMOTE_PREFLIGHT'
set -euo pipefail
if ! sudo test -r "$VPS_ENV_FILE"; then
  echo "VPS ortam dosyasi okunamiyor: $VPS_ENV_FILE" >&2
  exit 1
fi
has_value() {
  local key=$1
  sudo awk -F= -v key="$key" '$1 == key && length(substr($0, index($0, "=") + 1)) > 0 { found=1 } END { exit !found }' "$VPS_ENV_FILE"
}
if ! has_value DEEPSEEK_API_KEY && ! has_value DEEPSEEK_API; then
  echo "Eksik zorunlu ortam degiskeni: DEEPSEEK_API_KEY" >&2
  exit 1
fi
for key in GEMINI_API_KEY SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY MEDIA_STORAGE_PROVIDER MEDIA_SIGNING_SECRET; do
  if ! has_value "$key"; then
    echo "Eksik zorunlu ortam degiskeni: $key" >&2
    exit 1
  fi
done
REMOTE_PREFLIGHT

echo "[3/6] Kaynak senkronizasyonu"
rsync -azci --delete-delay --itemize-changes \
  -e "$RSYNC_SSH" \
  --include='.env.example' \
  --exclude='.env*' \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='renders/' \
  --exclude='downloads/' \
  --exclude='media/' \
  --exclude='coverage/' \
  "$SOURCE_DIR/" "$REMOTE:$VPS_APP_DIR/"

echo "[4/6] Docker build ve container testleri"
"${SSH[@]}" "$REMOTE" \
  "VPS_APP_DIR='$VPS_APP_DIR' VPS_ENV_FILE='$VPS_ENV_FILE' CONTAINER_NAME='$CONTAINER_NAME' IMAGE_NAME='$IMAGE_NAME' bash -s" <<'REMOTE_DEPLOY'
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
candidate="$IMAGE_NAME:candidate-$stamp"
rollback="$IMAGE_NAME:rollback-$stamp"
smoke="$CONTAINER_NAME-smoke"

current_image=$(sudo docker inspect -f '{{.Image}}' "$CONTAINER_NAME")
sudo docker tag "$current_image" "$rollback"
sudo docker build -t "$candidate" "$VPS_APP_DIR"
sudo docker run --rm --entrypoint node "$candidate" --check server.js
sudo docker run --rm --entrypoint npm "$candidate" test

echo "[5/6] Aday imaj smoke testi"
sudo docker rm -f "$smoke" >/dev/null 2>&1 || true
sudo docker run -d \
  --name "$smoke" \
  --env-file "$VPS_ENV_FILE" \
  -e PORT=18080 \
  -p 127.0.0.1:18080:18080 \
  -v /var/lib/karatahta/media:/data/media \
  -v /var/lib/karatahta/renders:/app/renders \
  -v /var/lib/karatahta/downloads:/app/downloads \
  "$candidate" >/dev/null

smoke_ok=0
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:18080/api/config >/dev/null; then
    smoke_ok=1
    break
  fi
  sleep 1
done
if [[ "$smoke_ok" -ne 1 ]]; then
  sudo docker logs --tail 100 "$smoke" >&2 || true
  sudo docker rm -f "$smoke" >/dev/null 2>&1 || true
  exit 1
fi
sudo docker rm -f "$smoke" >/dev/null

echo "[6/6] Uretime gecis"
sudo docker rm -f "$CONTAINER_NAME" >/dev/null
if ! sudo docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$VPS_ENV_FILE" \
  -p 127.0.0.1:8080:8080 \
  -v /var/lib/karatahta/media:/data/media \
  -v /var/lib/karatahta/renders:/app/renders \
  -v /var/lib/karatahta/downloads:/app/downloads \
  "$candidate" >/dev/null; then
  sudo docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --env-file "$VPS_ENV_FILE" \
    -p 127.0.0.1:8080:8080 \
    -v /var/lib/karatahta/media:/data/media \
    -v /var/lib/karatahta/renders:/app/renders \
    -v /var/lib/karatahta/downloads:/app/downloads \
    "$rollback" >/dev/null
  exit 1
fi

production_ok=0
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/api/config >/dev/null; then
    production_ok=1
    break
  fi
  sleep 1
done
if [[ "$production_ok" -ne 1 ]]; then
  sudo docker logs --tail 100 "$CONTAINER_NAME" >&2 || true
  sudo docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  sudo docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --env-file "$VPS_ENV_FILE" \
    -p 127.0.0.1:8080:8080 \
    -v /var/lib/karatahta/media:/data/media \
    -v /var/lib/karatahta/renders:/app/renders \
    -v /var/lib/karatahta/downloads:/app/downloads \
    "$rollback" >/dev/null
  exit 1
fi

sudo docker tag "$candidate" "$IMAGE_NAME:local"
printf '%s\n' "$rollback" | sudo tee /opt/karatahta-backend/last-rollback-image >/dev/null
printf '%s\n' "$candidate" | sudo tee /opt/karatahta-backend/last-candidate-image >/dev/null
echo "Yeni imaj: $candidate"
echo "Geri donus imaji: $rollback"
REMOTE_DEPLOY

echo "Dis HTTPS kontrolu"
curl -fsS "https://$VPS_DOMAIN/api/config" >/dev/null
echo "Deploy tamamlandi: https://$VPS_DOMAIN"
