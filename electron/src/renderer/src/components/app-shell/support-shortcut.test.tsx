import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./github-star', () => ({
  GithubStar: () => <div data-testid="github-star">GitHub</div>,
}));

import { SupportShortcut } from './support-shortcut';

afterEach(() => {
  cleanup();
});

it('renders the GitHub star shortcut without Pro upsell buttons', () => {
  render(<SupportShortcut />);
  expect(screen.getByTestId('github-star')).toBeInTheDocument();
  expect(screen.queryByText('supportPlans.get_pro')).toBeNull();
  expect(screen.queryByText('supportPlans.upgrade_pro')).toBeNull();
  expect(screen.queryByText('supportPlans.get_pro_app')).toBeNull();
});
