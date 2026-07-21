#!/bin/sh
set -eu

image="${1:?image tag is required}"
name="creator-signal-strapi-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
port="${STRAPI_SMOKE_PORT:-49120}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach --name "$name" --publish "127.0.0.1:${port}:1337" \
  --env NODE_ENV=development \
  --env PUBLIC_URL="http://localhost:${port}" \
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
  --env STRAPI_ADMIN_OIDC_CALLBACK_URL="http://localhost:${port}/admin/creativesignal/oidc/callback" \
  --env STRAPI_ADMIN_OIDC_PROJECT_ID=smoke-project \
  --env STRAPI_ADMIN_OIDC_ALLOW_INSECURE_HTTP=true \
  "$image" >/dev/null

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:${port}/_health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    docker logs "$name"
    exit 1
  fi
  sleep 2
done

status="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/admin/creativesignal/oidc/status")"
printf '%s' "$status" | grep '"enabled":true' >/dev/null
printf '%s' "$status" | grep '"/admin/creativesignal/oidc/start"' >/dev/null

registration_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' --data '{}' \
  "http://127.0.0.1:${port}/api/auth/local/register")"
test "$registration_status" = "404"

docker exec "$name" node -e "
  const admin = require('/opt/strapi/packages/core/admin/package.json');
  const strapi = require('/opt/strapi/packages/core/strapi/package.json');
  if (admin.version !== '5.50.2' || strapi.version !== '5.50.2') process.exit(1);
"

