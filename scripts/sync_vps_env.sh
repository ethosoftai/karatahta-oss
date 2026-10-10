#!/usr/bin/env bash
set -euo pipefail

# Keeps the VPS backend's config aligned with Railway for the settings that
# should behave identically on both (feature flags, shared timeouts, Railway
# Bucket read credentials so VPS can serve lessons whose video was generated
# on Railway, Google OAuth/Drive/Live). VPS-specific settings are left
# untouched: MEDIA_STORAGE_PROVIDER=local and its local-media vars, PORT,
# CORS_ORIGIN, AUTH_REDIRECT_URL, the VPS's own DEEPSEEK_API_KEY/Supabase
# creds, and its own (intentionally higher) concurrency settings.
#
# Run this after adding a new env var to Railway that should also apply to
# VPS, or any time you suspect the two have drifted -- it's idempotent, safe
# to re-run.
#
# Requires: `railway` CLI logged in and linked to the karatahta-backend
# service (for reading current Railway values), SSH access to the VPS.

VPS_HOST=${VPS_HOST:?VPS_HOST must be set}
VPS_USER=${VPS_USER:-ubuntu}
VPS_SSH_KEY=${VPS_SSH_KEY:?VPS_SSH_KEY must be set}
VPS_ENV_FILE=${VPS_ENV_FILE:-/etc/karatahta-backend.env}
VPS_DOMAIN=${VPS_DOMAIN:-api.karatahta.ethosoft.org}
CONTAINER_NAME=${CONTAINER_NAME:-karatahta-backend}

SSH=(ssh -i "$VPS_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)
REMOTE="$VPS_USER@$VPS_HOST"

if [[ ! -r "$VPS_SSH_KEY" ]]; then
  echo "SSH anahtari okunamiyor: $VPS_SSH_KEY" >&2
  exit 1
fi

echo "[1/3] Railway'den guncel degerler okunuyor"
RAILWAY_JSON=$(railway variables --json)

get_var() {
  python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))" <<<"$RAILWAY_JSON"
}

# Keys that must mirror Railway's current value exactly. Empty values from
# Railway are skipped (never write an empty override over a working VPS value).
SYNCED_KEYS=(
  STREAMING_PLAN_FIRST_SEGMENT
  PROGRESSIVE_MANIM_PARTIALS
  PROGRESSIVE_BUFFER_SECONDS
  PROGRESSIVE_ARTIFACT_TTL_MS
  GEMINI_REQUEST_TIMEOUT_MS
  LOCAL_MEDIA_SIGNING_SECRET
  KARA_VISION_MODELS
  GOOGLE_OAUTH_ENABLED
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
  KARA_LIVE_ENABLED
  KARA_LIVE_MODEL
  MEDIA_S3_ENDPOINT
  MEDIA_S3_BUCKET
  MEDIA_S3_REGION
  MEDIA_S3_URL_STYLE
  MEDIA_S3_ACCESS_KEY_ID
  MEDIA_S3_SECRET_ACCESS_KEY
  DEEPSEEK_REASONING_EFFORT
  DEEPSEEK_BASE_URL
  DEEPSEEK_REQUEST_TIMEOUT_MS
)

# Leftovers that must never live on the VPS: dead/unused by the current code
# (confirmed via grep, not just "looked old"), or values that were silently
# overriding the intended shared default (TARGET_*, MANIM_FONT).
DEAD_KEYS=(
  GEMINI_CODE_MODEL
  GEMINI_PLAN_MODEL
  GOOGLE_TTS_API_KEY
  GOOGLE_TTS_SPEAKING_RATE
  GOOGLE_TTS_VOICE
  PYTHON_COMMAND
  SUPABASE_JWKS_URL
  TARGET_VIDEO_MINUTES
  TARGET_SEGMENT_COUNT
  MANIM_FONT
)

escape_single_quotes() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

echo "[2/3] VPS .env dosyasi yedekleniyor ve guncelleniyor"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
"${SSH[@]}" "$REMOTE" "sudo cp '$VPS_ENV_FILE' '$VPS_ENV_FILE.bak-$STAMP'"

REMOTE_SCRIPT="set -euo pipefail
ENV_FILE='$VPS_ENV_FILE'
upsert() {
  local key=\"\$1\" value=\"\$2\"
  [[ -z \"\$value\" ]] && return 0
  if sudo grep -q \"^\${key}=\" \"\$ENV_FILE\"; then
    sudo sed -i \"s|^\${key}=.*|\${key}=\${value}|\" \"\$ENV_FILE\"
  else
    printf '%s=%s\n' \"\$key\" \"\$value\" | sudo tee -a \"\$ENV_FILE\" >/dev/null
  fi
}
"

for key in "${SYNCED_KEYS[@]}"; do
  value=$(get_var "$key")
  [[ -z "$value" ]] && continue
  escaped=$(escape_single_quotes "$value")
  REMOTE_SCRIPT+=$'\n'"upsert '$key' '$escaped'"
done

# LLM_PROVIDER isn't read by the code (fixed to deepseek internally), but a
# stale 'gemini' value left over from early VPS setup is misleading to read.
REMOTE_SCRIPT+=$'\n'"upsert 'LLM_PROVIDER' 'deepseek'"

for key in "${DEAD_KEYS[@]}"; do
  REMOTE_SCRIPT+=$'\n'"sudo sed -i '/^${key}=/d' \"\$ENV_FILE\""
done

REMOTE_SCRIPT+="
echo 'env guncellendi, container yeniden olusturuluyor'
CURRENT_IMAGE=\$(sudo docker inspect -f '{{.Config.Image}}' '$CONTAINER_NAME')
sudo docker rm -f '$CONTAINER_NAME'
sudo docker run -d \\
  --name '$CONTAINER_NAME' \\
  --restart unless-stopped \\
  --env-file \"\$ENV_FILE\" \\
  -p 127.0.0.1:8080:8080 \\
  -v /var/lib/karatahta/media:/data/media \\
  -v /var/lib/karatahta/renders:/app/renders \\
  -v /var/lib/karatahta/downloads:/app/downloads \\
  \"\$CURRENT_IMAGE\"
"

"${SSH[@]}" "$REMOTE" bash -s <<<"$REMOTE_SCRIPT"

echo "[3/3] Dogrulama"
sleep 3
curl -fsS "https://$VPS_DOMAIN/api/config" | python3 -m json.tool
echo "VPS env senkronizasyonu tamamlandi."
