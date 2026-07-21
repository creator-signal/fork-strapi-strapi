#!/bin/sh
set -eu

image="${1:?image tag is required}"
name="creator-signal-strapi-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
port="${STRAPI_SMOKE_PORT:-49120}"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    docker logs "$name" || true
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

docker run --detach --name "$name" --publish "127.0.0.1:${port}:1337" \
  --env NODE_ENV=production \
  --env PUBLIC_URL=https://content.example.test \
  --env APP_KEYS=smoke-app-key-one,smoke-app-key-two,smoke-app-key-three,smoke-app-key-four \
  --env ADMIN_JWT_SECRET=smoke-admin-jwt-secret \
  --env API_TOKEN_SALT=smoke-api-token-salt \
  --env TRANSFER_TOKEN_SALT=smoke-transfer-token-salt \
  --env ENCRYPTION_KEY=smoke-encryption-key \
  --env JWT_SECRET=smoke-users-permissions-secret \
  --env CREATOR_SIGNAL_ADMIN_OIDC_ENABLED=true \
  --env ZITADEL_ISSUER=https://auth.example.test \
  --env STRAPI_ADMIN_SSO_CLIENT_ID=smoke-client \
  --env STRAPI_ADMIN_SSO_CLIENT_SECRET=smoke-client-secret \
  --env STRAPI_ADMIN_OIDC_CALLBACK_URL=https://content.example.test/admin/creativesignal/oidc/callback \
  --env STRAPI_ADMIN_OIDC_PROJECT_ID=smoke-project \
  "$image" >/dev/null

attempt=0
stable=0
while [ "$stable" -lt 3 ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    exit 1
  fi
  if curl --fail --silent --show-error "http://127.0.0.1:${port}/_health" >/dev/null; then
    stable=$((stable + 1))
  else
    stable=0
  fi
  sleep 2
done

status="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/admin/creativesignal/oidc/status")"
OIDC_STATUS="$status" node -e '
  const payload = JSON.parse(process.env.OIDC_STATUS);
  const status = payload?.data?.data ?? payload?.data ?? payload;
  if (status.enabled !== true || status.startPath !== "/admin/creativesignal/oidc/start") {
    throw new Error(`Unexpected Creator Signal OIDC status: ${JSON.stringify(payload)}`);
  }
'

registration_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' \
  --data '{"username":"smoke-signup","email":"signup@example.test","password":"Smoke-password-123!"}' \
  "http://127.0.0.1:${port}/api/auth/local/register")"
test "$registration_status" = "404"

docker exec "$name" node -e "
  const admin = require('/opt/strapi/packages/core/admin/package.json');
  const strapi = require('/opt/strapi/packages/core/strapi/package.json');
  if (admin.version !== '5.50.2' || strapi.version !== '5.50.2') process.exit(1);
"
