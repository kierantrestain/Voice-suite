import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const projects = vi.hoisted(() => ({ saved: [] as unknown[], navigate: vi.fn() }));
const browser = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));
const files = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('@/components/bridge', () => ({
  getBridge: () => ({ browser, files, app: { version: '0.0.0-test', isDev: false } }),
  appVersion: () => '0.0.0-test',
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => projects.navigate,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey?: readonly unknown[] }) => ({
    data: options.queryKey?.[0] === 'longform-projects' ? projects.saved : [],
  }),
}));
vi.mock('@/hooks/use-profiles', () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { HomePage } from './home-page';
import en from '@/i18n/locales/en.json';
import { blankLongformDraft, longformSession } from '@/features/longform/longform-session';

afterEach(() => {
  cleanup();
  localStorage.clear();
  projects.saved = [];
  projects.navigate.mockClear();
  longformSession.setState((state) => ({ ...state, active: null }));
  vi.useRealTimers();
});

it('links the running version to its release notes', () => {
  render(<HomePage />);
  const link = screen.getByRole('link', { name: /update\.whats_new/ });
  expect(link).toHaveAttribute('href', 'https://github.com/debpalash/VoiceStudio/releases');
  expect(link).toHaveTextContent('app.version');
});

it('renders a clean hero heading and description without upstream contributor promotional widgets', () => {
  render(<HomePage />);
  const heading = screen.getByRole('heading', { name: 'homeUi.title' });
  const description = screen.getByText('homeUi.subtitle');
  expect(heading).toBeVisible();
  expect(description).toBeVisible();
  expect(document.querySelector('.home-contributors')).toBeNull();
  expect(document.querySelector('a[href="https://voicestudio.sh"]')).toBeNull();
});

it('adds snow in winter and Santa only in Christmas week', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2027, 0, 10));
  const { unmount } = render(<HomePage />);
  expect(screen.getByTestId('home-snow')).toBeInTheDocument();
  expect(screen.queryByTestId('home-christmas')).toBeNull();
  unmount();
  vi.setSystemTime(new Date(2026, 11, 24));
  render(<HomePage />);
  expect(screen.getByTestId('home-christmas')).toHaveTextContent('homeUi.hoHoHo');
  cleanup();
  vi.setSystemTime(new Date(2026, 6, 1));
  render(<HomePage />);
  expect(screen.queryByTestId('home-snow')).toBeNull();
});

it('names the feature Dubbing consistently while preserving the existing route', () => {
  expect(en.dubWorkspace.title).toBe('Dubbing');
  expect(en.nav.dub).toBe('Dubbing');
  render(<HomePage />);
  expect(screen.getByRole('link', { name: /dubWorkspace.title/ })).toHaveAttribute('href', '/dub');
});

it('separates three primary creation actions and covers all ten studio dashboard workflows', () => {
  render(<HomePage />);
  const clone = screen.getByRole('link', { name: /nav.clone/ });
  const primary = clone.parentElement!;
  expect(Array.from(primary.querySelectorAll('a'), (a) => a.getAttribute('href'))).toEqual([
    '/clone',
    '/design',
    '/dub',
  ]);
  const secondaryLinks = Array.from(
    primary.nextElementSibling?.querySelectorAll('a') ?? [],
    (a) => a.getAttribute('href'),
  );
  expect(secondaryLinks).toEqual([
    '/personas',
    '/stories',
    '/audiobook',
    '/transcriptions',
    '/transcriptions',
    '/batch',
    '/settings',
  ]);
  const icons = document.querySelectorAll('svg.home-feature-svg');
  expect(icons).toHaveLength(10);
  icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  for (const key of ['design', 'dub', 'stories', 'audiobook', 'transcribe']) {
    expect(screen.getByText('homeUi.' + key)).toBeVisible();
  }
  expect(screen.queryByText('demo.dictation_lede')).not.toBeInTheDocument();
  expect(screen.queryByText('dub.supported_formats')).not.toBeInTheDocument();
  expect(screen.queryByText('clone.history_title')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it.each([true, false])(
  'opens a saved Home project only when longform is idle: active=%s',
  async (active) => {
    const draft = {
      ...blankLongformDraft(),
      title: 'Saved synthetic book',
      script: 'Preserved saved manuscript',
    };
    projects.saved = [
      { id: 'saved', name: 'Saved synthetic book', mode: 'audiobook', updatedAt: 1, draft },
    ];
    longformSession.setState((state) => ({ ...state, active: active ? 'stories' : null }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: /Saved synthetic book/ }));
    if (active) {
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('audiobook.blocked.busy'),
      );
      expect(projects.navigate).not.toHaveBeenCalled();
      expect(longformSession.state.drafts.audiobook.script).not.toBe('Preserved saved manuscript');
    } else {
      // Opening replaces the working draft, so nothing changes until confirmed.
      expect(await screen.findByText('projectActions.open')).toBeInTheDocument();
      expect(longformSession.state.drafts.audiobook.script).not.toBe('Preserved saved manuscript');
      fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));
      await waitFor(() => expect(projects.navigate).toHaveBeenCalledWith({ to: '/audiobook' }));
      expect(longformSession.state.drafts.audiobook.script).toBe('Preserved saved manuscript');
    }
  },
);

it('keeps the working draft and stays on Home when the project open is cancelled', async () => {
  const draft = { ...blankLongformDraft(), script: 'Saved manuscript' };
  projects.saved = [{ id: 'saved', name: 'Saved book', mode: 'audiobook', updatedAt: 1, draft }];
  const before = longformSession.state.drafts.audiobook.script;
  render(<HomePage />);
  fireEvent.click(screen.getByRole('button', { name: /Saved book/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }));
  await waitFor(() => expect(screen.queryByText('projectActions.open')).toBeNull());
  expect(projects.navigate).not.toHaveBeenCalled();
  expect(longformSession.state.drafts.audiobook.script).toBe(before);
});
