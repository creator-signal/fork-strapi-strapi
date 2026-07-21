import type { Core } from '@strapi/types';
import { errors } from '@strapi/utils';
import type { Context, Next } from 'koa';

import { getCreatorSignalAdminOidcConfig } from './config';

export const assertCreatorSignalAdminRegistrationAllowed = (strapi: Core.Strapi): void => {
  if (getCreatorSignalAdminOidcConfig(strapi)) {
    throw new errors.NotFoundError();
  }
};

export const creatorSignalAdminExistsForRouting = (
  strapi: Core.Strapi,
  hasAdmin: boolean
): boolean => hasAdmin || getCreatorSignalAdminOidcConfig(strapi) !== null;

export const disableCreatorSignalPublicRegistration = async (
  strapi: Core.Strapi
): Promise<void> => {
  if (!getCreatorSignalAdminOidcConfig(strapi)) {
    return;
  }

  const usersPermissions = strapi.plugin('users-permissions');
  if (!usersPermissions) {
    return;
  }

  // Both the REST and GraphQL registration paths resolve this controller.
  // Keep the route unavailable even if the persisted setting is later changed.
  usersPermissions.controller('auth').register = (ctx: Context) => ctx.notFound();

  const settingsController = usersPermissions.controller('settings');
  const updateAdvancedSettings = settingsController.updateAdvancedSettings;
  settingsController.updateAdvancedSettings = (ctx: Context, next: Next) => {
    const request = ctx.request as typeof ctx.request & { body?: unknown };
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    request.body = { ...body, allow_register: false };
    return updateAdvancedSettings(ctx, next);
  };

  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const advanced = ((await store.get({ key: 'advanced' })) ?? {}) as Record<string, unknown>;
  if (advanced.allow_register !== false) {
    await store.set({
      key: 'advanced',
      value: { ...advanced, allow_register: false },
    });
  }
};
