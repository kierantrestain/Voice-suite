import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ open: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ files: { openExternal: mock.open } }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useSearch: () => ({}),
}));

import { SupportSettings } from './support-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('displays AGPL-3.0 compliance and upstream attributions without donation or Pro upsells', () => {
  render(<SupportSettings />);
  expect(
    screen.getByRole('heading', { name: /Voice Suite — Local-First Open Source & Licensing/ }),
  ).toBeVisible();
  expect(
    screen.getByRole('heading', { name: /GNU Affero General Public License v3\.0 \(AGPL-3\.0\)/ }),
  ).toBeVisible();
  expect(screen.getByText(/Palash Debnath and VoiceStudio contributors/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'k2-fsa/OmniVoice' })).toHaveAttribute(
    'href',
    'https://github.com/k2-fsa/OmniVoice',
  );
  expect(screen.queryByRole('link', { name: 'PayPal' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Ko-fi' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'supportPlans.get_pro' })).toBeNull();
});

it('keeps bug reporting and security advisory links accessible', () => {
  render(<SupportSettings />);
  const securityLink = screen.getByRole('link', { name: 'contact.security_cta' });
  expect(securityLink).toHaveAttribute(
    'href',
    'https://github.com/debpalash/VoiceStudio/security/advisories/new',
  );
  fireEvent.click(securityLink);
  expect(mock.open).toHaveBeenCalledWith(
    'https://github.com/debpalash/VoiceStudio/security/advisories/new',
  );
});
