import { render, screen, waitFor } from '@tests/utils';

import { CreatorSignalAdminOidcLogin } from '../Login';

describe('Creator Signal ZITADEL login', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.strapi.backendURL = 'https://content.creatorsignal.me';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('shows the namespaced ZITADEL entrypoint when enabled', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { enabled: true, startPath: '/admin/creativesignal/oidc/start' },
      }),
    });

    render(<CreatorSignalAdminOidcLogin />, {
      initialEntries: ['/auth/login?redirectTo=%2Fadmin%2Fcontent-manager%2Fcollection-types'],
    });

    const link = await screen.findByRole('link', { name: 'Continue with ZITADEL' });
    expect(link).toHaveAttribute(
      'href',
      'https://content.creatorsignal.me/admin/creativesignal/oidc/start?returnTo=%2Fadmin%2Fcontent-manager%2Fcollection-types'
    );
    expect(screen.getByText(/break-glass administrator/)).toBeInTheDocument();
  });

  test('renders no SSO control when the feature is disabled', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { enabled: false, startPath: null } }),
    });

    const { container } = render(<CreatorSignalAdminOidcLogin />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
