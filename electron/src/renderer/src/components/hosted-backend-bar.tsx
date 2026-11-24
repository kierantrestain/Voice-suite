import { Link } from '@tanstack/react-router';
import { RotateCcwIcon, ServerCogIcon, ServerOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  getHostedBackendDetail,
  recheckHostedBackend,
  type BackendStatus,
} from '@/hooks/use-backend-status';

/**
 * The hosted frontend's connection indicator. It never claims a backend is
 * working unless `/health` said so: not configured, checking, starting and
 * unreachable each get their own wording and one action.
 */
export function HostedBackendBar({ status }: { status: BackendStatus }) {
  const { t } = useTranslation();
  if (status.stage === 'ready' || status.stage === 'unresponsive') return null;
  const configured = Boolean(status.baseUrl);
  const checking = status.stage === 'attaching' || status.stage === 'starting';
  const title = !configured
    ? t('hosted.bar_not_connected')
    : status.stage === 'starting'
      ? t('hosted.bar_starting')
      : checking
        ? t('hosted.bar_checking')
        : t('hosted.bar_unreachable');
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-12 z-40 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        data-testid="hosted-backend-bar"
        data-stage={configured ? status.stage : 'not_configured'}
        className="pointer-events-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warning/40 bg-card/95 px-3.5 py-2 text-xs text-foreground shadow-lg backdrop-blur"
      >
        {checking ? (
          <Spinner className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <ServerOffIcon className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{title}</span>
          <span className="truncate text-muted-foreground">
            {configured ? (
              <span className="font-mono">{status.baseUrl}</span>
            ) : (
              t('hosted.bar_not_connected_hint')
            )}
          </span>
        </div>
        {configured && !checking ? (
          <Button size="xs" variant="ghost" onClick={recheckHostedBackend}>
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            {t('backend.retry')}
          </Button>
        ) : null}
        <Link
          to="/settings/sharing"
          hash="remote-backend-url"
          className={buttonVariants({ size: 'xs', variant: 'outline' })}
        >
          <ServerCogIcon data-icon="inline-start" aria-hidden="true" />
          {t(configured ? 'hosted.change_backend' : 'hosted.connect_backend')}
        </Link>
      </div>
    </div>
  );
}

/** One line for Settings: what the hosted backend reported on its last probe. */
export function hostedBackendSummary(): string {
  return getHostedBackendDetail();
}
