import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/components/external-link', () => ({
  ExternalLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/report-bug', () => ({
  ReportBug: () => <button type="button">reportBug.label</button>,
}));

import { ProPage } from './pro-page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('displays Voice Suite local-first open-source licensing and upstream attribution without paid plans', () => {
  render(<ProPage />);
  expect(
    screen.getByRole('heading', {
      level: 2,
      name: /Voice Suite — Local-First Open Source & Licensing/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole('heading', {
      level: 3,
      name: /GNU Affero General Public License v3\.0 \(AGPL-3\.0\)/,
    }),
  ).toBeVisible();
  expect(screen.getByText(/Palash Debnath and VoiceStudio contributors/)).toBeVisible();
  expect(screen.getByRole('link', { name: /k2-fsa\/OmniVoice/ })).toHaveAttribute(
    'href',
    'https://github.com/k2-fsa/OmniVoice',
  );
  expect(screen.getByRole('link', { name: /Upstream VoiceStudio Repository/ })).toHaveAttribute(
    'href',
    'https://github.com/debpalash/VoiceStudio',
  );
  expect(screen.getByRole('button', { name: 'reportBug.label' })).toBeVisible();
  expect(screen.queryByText('$99')).not.toBeInTheDocument();
  expect(screen.queryByText('$199')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /proPage\.choose_yearly/ })).not.toBeInTheDocument();
});
