export default [
  {
    method: 'GET',
    path: '/creativesignal/oidc/status',
    handler: 'creativesignalAdminOidc.status',
    config: { auth: false },
  },
  {
    method: 'GET',
    path: '/creativesignal/oidc/start',
    handler: 'creativesignalAdminOidc.start',
    config: {
      auth: false,
      middlewares: ['admin::rateLimit'],
    },
  },
  {
    method: 'GET',
    path: '/creativesignal/oidc/callback',
    handler: 'creativesignalAdminOidc.callback',
    config: {
      auth: false,
      middlewares: ['admin::rateLimit'],
    },
  },
];
