'use strict';

module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'http://localhost:1337'),
  proxy: env.bool('TRUST_PROXY', true),
  app: {
    keys: env.array('APP_KEYS'),
  },
  mcp: {
    enabled: env.bool('STRAPI_MCP_ENABLED', true),
    connectTimeoutMs: env.int('STRAPI_MCP_CONNECT_TIMEOUT_MS', 10_000),
    requestTimeoutMs: env.int('STRAPI_MCP_REQUEST_TIMEOUT_MS', 60_000),
  },
});
