import './support-shortcut.css';
import { GithubStar } from './github-star';

export const _RETAINED_I18N_KEYS = [
  'supportPlans.get_pro_app',
  'supportPlans.upgrade_pro',
  'supportPlans.get_pro',
] as const;

export function SupportShortcut() {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <GithubStar />
    </div>
  );
}
