export interface AdminOidc {
  enabled?: boolean;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  projectId?: string;
  requiredProjectRole?: string;
  strapiRoleCode?: string;
  allowInsecureDevelopmentHttp?: boolean;
}

export interface CreatorSignal {
  adminOidc?: AdminOidc;
}
