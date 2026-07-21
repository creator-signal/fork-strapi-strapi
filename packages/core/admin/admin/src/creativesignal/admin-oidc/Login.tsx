import * as React from 'react';

import { Box, Flex, LinkButton, Typography } from '@strapi/design-system';
import { useLocation } from 'react-router-dom';

interface StatusResponse {
  data?: {
    enabled?: boolean;
    startPath?: string | null;
  };
}

const CreatorSignalAdminOidcLogin = () => {
  const [startPath, setStartPath] = React.useState<string | null>(null);
  const { search } = useLocation();

  React.useEffect(() => {
    const controller = new AbortController();
    const loadStatus = async () => {
      try {
        const response = await fetch(
          `${window.strapi.backendURL}/admin/creativesignal/oidc/status`,
          {
            credentials: 'include',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          return;
        }
        const status = (await response.json()) as StatusResponse;
        if (status.data?.enabled && status.data.startPath) {
          setStartPath(status.data.startPath);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Creator Signal ZITADEL login status is unavailable');
        }
      }
    };

    void loadStatus();
    return () => controller.abort();
  }, []);

  if (!startPath) {
    return null;
  }

  const query = new URLSearchParams(search);
  const returnTo = query.get('redirectTo') ?? '/admin/content-manager';
  const loginUrl = new URL(`${window.strapi.backendURL}${startPath}`);
  loginUrl.searchParams.set('returnTo', returnTo);

  return (
    <Box paddingBottom={6}>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <LinkButton href={loginUrl.href} fullWidth>
          Continue with ZITADEL
        </LinkButton>
        <Typography variant="pi" textColor="neutral600" textAlign="center">
          Local sign-in is reserved for the break-glass administrator.
        </Typography>
      </Flex>
    </Box>
  );
};

export { CreatorSignalAdminOidcLogin };
