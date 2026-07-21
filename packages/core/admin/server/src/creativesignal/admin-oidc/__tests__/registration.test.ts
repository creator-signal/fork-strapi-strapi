import type { Core } from '@strapi/types';

import {
  assertCreatorSignalAdminRegistrationAllowed,
  creatorSignalAdminExistsForRouting,
  disableCreatorSignalPublicRegistration,
} from '../registration';

const enabledConfig = {
  adminOidc: {
    enabled: true,
    issuer: 'https://auth.creatorsignal.me',
    clientId: 'client',
    clientSecret: 'secret',
    callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
    projectId: 'project-1',
  },
};

const createStrapi = ({ enabled = true, withPlugin = true } = {}) => {
  const set = jest.fn();
  const register = jest.fn();
  const updateAdvancedSettings = jest.fn();
  const authController = { register };
  const settingsController = { updateAdvancedSettings };
  const store = { get: jest.fn().mockResolvedValue({ allow_register: true }), set };
  const strapi = {
    config: {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'admin.creativesignal' && enabled ? enabledConfig : fallback
      ),
    },
    plugin: jest.fn(() =>
      withPlugin
        ? {
            controller: jest.fn((name: string) =>
              name === 'auth' ? authController : settingsController
            ),
          }
        : undefined
    ),
    store: jest.fn(() => store),
  } as unknown as Core.Strapi;
  return {
    authController,
    register,
    set,
    settingsController,
    strapi,
    updateAdvancedSettings,
  };
};

describe('Creator Signal registration controls', () => {
  test('hides Admin registration and first-user routing when enabled', () => {
    const { strapi } = createStrapi();
    expect(() => assertCreatorSignalAdminRegistrationAllowed(strapi)).toThrow();
    expect(creatorSignalAdminExistsForRouting(strapi, false)).toBe(true);
  });

  test('does not change ordinary Community registration when disabled', () => {
    const { strapi } = createStrapi({ enabled: false });
    expect(() => assertCreatorSignalAdminRegistrationAllowed(strapi)).not.toThrow();
    expect(creatorSignalAdminExistsForRouting(strapi, false)).toBe(false);
  });

  test('forces users-permissions public registration off', async () => {
    const { authController, register, strapi, set, settingsController, updateAdvancedSettings } =
      createStrapi();
    await disableCreatorSignalPublicRegistration(strapi);
    expect(set).toHaveBeenCalledWith({
      key: 'advanced',
      value: { allow_register: false },
    });

    const ctx = { notFound: jest.fn() };
    authController.register(ctx as never, jest.fn() as never);
    expect(ctx.notFound).toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    const settingsContext = {
      request: { body: { allow_register: true, unique_email: true } },
    };
    settingsController.updateAdvancedSettings(settingsContext as never, jest.fn() as never);
    expect(settingsContext.request.body).toEqual({
      allow_register: false,
      unique_email: true,
    });
    expect(updateAdvancedSettings).toHaveBeenCalled();
  });
});
