import type { Core } from '@strapi/types';

import type { AdminRole, AdminUser } from '../../../../shared/contracts/shared';
import type { CreatorSignalAdminOidcConfig } from './config';
import type { ZitadelIdTokenClaims } from './oidc-client';

const SUPER_ADMIN_ROLE_CODE = 'strapi-super-admin';

const displayName = (value: unknown, fallback: string): string => {
  const result = typeof value === 'string' ? value.trim() : '';
  return (result || fallback).slice(0, 255);
};

export const zitadelProjectRoles = (
  claims: Record<string, unknown>,
  projectId: string
): Set<string> => {
  const roles = new Set<string>();
  const value = claims[`urn:zitadel:iam:org:project:${projectId}:roles`];

  if (Array.isArray(value)) {
    value.forEach((role) => typeof role === 'string' && roles.add(role));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((role) => roles.add(role));
  }

  return roles;
};

export const ensureCreatorSignalAdmin = async (
  strapi: Core.Strapi,
  config: CreatorSignalAdminOidcConfig,
  claims: ZitadelIdTokenClaims
): Promise<AdminUser> => {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || claims.email_verified !== true) {
    throw new Error('zitadel_email_is_not_verified');
  }
  if (!zitadelProjectRoles(claims, config.projectId).has(config.requiredProjectRole)) {
    throw new Error('zitadel_project_role_is_missing');
  }

  const userService = strapi.service('admin::user');
  const roleService = strapi.service('admin::role');
  const targetRole = (await roleService.findOne({
    code: config.strapiRoleCode,
  })) as AdminRole | null;
  if (!targetRole || targetRole.code === SUPER_ADMIN_ROLE_CODE) {
    throw new Error('configured_strapi_role_is_unavailable');
  }

  let user = (await userService.findOneByEmail(email, ['roles'])) as AdminUser | null;
  if (user?.roles?.some((role) => role.code === SUPER_ADMIN_ROLE_CODE)) {
    throw new Error('super_admin_requires_break_glass_login');
  }
  if (user && user.isActive !== true) {
    throw new Error('strapi_admin_is_suspended');
  }

  if (!user) {
    const localPart = email.split('@')[0] || 'editor';
    const attributes = {
      email,
      firstname: displayName(claims.given_name, localPart),
      lastname: displayName(claims.family_name, 'Creator Signal'),
      roles: [targetRole.id],
      isActive: true,
      registrationToken: null,
    };

    try {
      user = (await userService.create(attributes)) as AdminUser;
    } catch (error) {
      // A concurrent first login can win the unique-email insert. Resolve the
      // resulting account and continue only if it is a normal active Admin.
      user = (await userService.findOneByEmail(email, ['roles'])) as AdminUser | null;
      if (!user) {
        throw error;
      }
    }
  }

  if (user.roles?.some((role) => role.code === SUPER_ADMIN_ROLE_CODE)) {
    throw new Error('super_admin_requires_break_glass_login');
  }
  if (user.isActive !== true) {
    throw new Error('strapi_admin_is_suspended');
  }

  if (!user.roles?.some((role) => role.code === targetRole.code)) {
    user = (await userService.updateById(user.id, {
      roles: [targetRole.id],
      isActive: true,
      registrationToken: null,
    })) as AdminUser;
  }

  return user;
};
