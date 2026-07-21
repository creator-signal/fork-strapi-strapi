# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.14.0-bookworm-slim
FROM ${NODE_IMAGE} AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    STRAPI_DISABLE_EE=true
WORKDIR /workspace
COPY . .
RUN corepack enable \
    && yarn install --immutable
RUN yarn nx run @creator-signal/strapi-container:build --skip-nx-cache
RUN yarn workspaces focus @creator-signal/strapi-container --production
RUN node creativesignal/container/scripts/verify-distribution.mjs /workspace

FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.source="https://github.com/creator-signal/fork-strapi-strapi" \
      org.opencontainers.image.title="Creator Signal Strapi" \
      org.opencontainers.image.description="Creator Signal Community-compatible Strapi distribution with standalone ZITADEL OIDC"
ENV NODE_ENV=production \
    STRAPI_DISABLE_EE=true \
    HOST=0.0.0.0 \
    PORT=1337 \
    PATH=/opt/strapi/node_modules/.bin:$PATH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/strapi
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/creativesignal ./creativesignal

WORKDIR /opt/strapi/creativesignal/container
RUN mkdir -p .tmp public/uploads \
    && chown -R node:node .tmp public
USER node
EXPOSE 1337
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 \
  CMD curl --fail --silent http://127.0.0.1:1337/_health >/dev/null || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "/opt/strapi/packages/core/strapi/bin/strapi.js", "start"]

