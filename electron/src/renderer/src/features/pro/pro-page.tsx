import { type PointerEvent as ReactPointerEvent } from 'react';
import {
  BriefcaseBusinessIcon,
  Code2Icon,
  GitCompareArrowsIcon,
  ListChecksIcon,
  PackageCheckIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { ExternalLink } from '@/components/external-link';
import { ReportBug } from '@/components/report-bug';
import './pro-page.css';

export const _RETAINED_I18N_KEYS = [
  'proPage.title',
  'proPage.hero_title',
  'proPage.hero_body',
  'proPage.workflow_title',
  'proPage.features_title',
  'proPage.automation_title',
  'proPage.automation_body',
  'proPage.history_title',
  'proPage.history_body',
  'proPage.delivery_title',
  'proPage.delivery_body',
  'proPage.preflight_title',
  'proPage.preflight_body',
  'proPage.comparison_title',
  'proPage.pricing_body',
  'proPage.free_forever',
  'proPage.free_body',
  'proPage.free_note',
  'proPage.included',
  'proPage.activate_title',
  'proPage.activate_body',
  'proPage.active_title',
  'proPage.active_body',
  'proPage.activate',
  'proPage.not_configured',
  'proPage.billing_note',
  'proPage.plan_yearly',
  'proPage.plan_lifetime',
  'proPage.yearly_detail',
  'proPage.lifetime_detail',
  'proPage.choose_yearly',
  'proPage.choose_lifetime',
  'proPage.best_value',
  'proPage.features_heading',
  'proPage.free_promise',
  'proPage.features_subtitle',
  'proPage.lifetime_includes_pro',
  'proPage.lifetime_pay_once',
  'proPage.lifetime_no_subscription',
  'proPage.per_user_year',
  'proPage.per_user_once',
  'proPage.users',
  'proPage.decrease_users',
  'proPage.increase_users',
  'proPage.total',
  'proPage.commercial_title',
  'proPage.commercial_body',
  'proPage.plan_enterprise',
  'proPage.enterprise_price',
  'proPage.usd_price',
  'proPage.for_teams',
  'proPage.enterprise_detail',
  'proPage.contact_enterprise',
  'proPage.enterprise_deployment',
  'proPage.enterprise_policy',
  'proPage.enterprise_sso',
  'proPage.enterprise_private',
  'proPage.enterprise_support',
] as const;

const benefits = [
  {
    icon: BriefcaseBusinessIcon,
    title: 'commercial_title',
    body: 'commercial_body',
    effect: 'seal',
  },
  { icon: ListChecksIcon, title: 'automation_title', body: 'automation_body', effect: 'lanes' },
  { icon: GitCompareArrowsIcon, title: 'history_title', body: 'history_body', effect: 'wave' },
  { icon: PackageCheckIcon, title: 'delivery_title', body: 'delivery_body', effect: 'pixels' },
  { icon: ShieldCheckIcon, title: 'preflight_title', body: 'preflight_body', effect: 'scan' },
] as const;

function trackFeaturePointer(event: ReactPointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  card.style.setProperty('--feature-x', `${x}px`);
  card.style.setProperty('--feature-y', `${y}px`);
  card.style.setProperty(
    '--feature-angle',
    `${(Math.atan2(y - bounds.height / 2, x - bounds.width / 2) * 180) / Math.PI + 90}deg`,
  );
}

export function ProPage() {
  const { t } = useTranslation();

  return (
    <div className="pro-page">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">Voice Suite — Open Source &amp; Licensing</h1>
      </WorkspaceHeader>
      <div className="pro-page-scroll">
        <main className="pro-page-content">
          <section className="pro-pricing" id="pro-compare" aria-labelledby="pro-pricing-title">
            <div className="pro-section-head">
              <h2 id="pro-pricing-title">Voice Suite — Local-First Open Source &amp; Licensing</h2>
              <p>{t('proPage.free_body')}</p>
            </div>
            <div className="pro-plans">
              <article className="pro-plan pro-plan--featured">
                <div className="pro-plan-top">
                  <h3>GNU Affero General Public License v3.0 (AGPL-3.0)</h3>
                  <span className="pro-plan-badge">{t('proPage.free_forever')}</span>
                </div>
                <p>
                  Voice Suite is free and open-source software licensed under the AGPL-3.0. All
                  voice synthesis, cloning, design, dubbing, transcription, dictation, audiobook
                  creation, and batch workflows execute locally on your device without paid
                  subscriptions or cloud upsells.
                </p>
                <p>{t('proPage.commercial_body')}</p>
                <div className="pro-plan-end pro-plan-buy">
                  <ExternalLink href="https://www.gnu.org/licenses/agpl-3.0.html" showIcon={false}>
                    AGPL-3.0 License Terms
                  </ExternalLink>
                </div>
              </article>

              <article className="pro-plan">
                <div className="pro-plan-top">
                  <h3>Upstream Attribution &amp; Open-Source Credits</h3>
                </div>
                <p>
                  Voice Suite preserves and honors the upstream open-source work by{' '}
                  <strong>Palash Debnath and VoiceStudio contributors</strong> and the underlying
                  speech synthesis research from <strong>k2-fsa/OmniVoice</strong>.
                </p>
                <div className="pro-plan-end pro-plan-buy">
                  <ExternalLink href="https://github.com/debpalash/VoiceStudio" showIcon={false}>
                    <Code2Icon aria-hidden="true" className="mr-1.5 inline size-4" />
                    Upstream VoiceStudio Repository
                  </ExternalLink>
                </div>
              </article>

              <article className="pro-plan pro-plan--enterprise">
                <div className="pro-plan-top">
                  <h3>Model Terms &amp; Support</h3>
                </div>
                <p>
                  Individual AI speech, transcription, and translation models are governed by their
                  respective upstream model licenses in the Model Catalogue.
                </p>
                <div className="pro-plan-end pro-plan-buy flex flex-wrap items-center gap-2">
                  <ExternalLink href="https://github.com/k2-fsa/OmniVoice" showIcon={false}>
                    <ScaleIcon aria-hidden="true" className="mr-1.5 inline size-4" />
                    k2-fsa/OmniVoice
                  </ExternalLink>
                  <ReportBug />
                </div>
              </article>
            </div>
          </section>

          <section className="pro-features" aria-labelledby="pro-features-title">
            <div className="pro-section-head">
              <h2 id="pro-features-title">{t('proPage.features_heading')}</h2>
              <p>{t('proPage.free_note')}</p>
            </div>
            <div className="pro-benefits">
              {benefits.map(({ icon: Icon, title, body, effect }) => (
                <article
                  key={title}
                  className={`pro-feature-card pro-feature-card--${effect}`}
                  onPointerMove={trackFeaturePointer}
                >
                  <span className="pro-feature-effect" aria-hidden="true" />
                  <div className="pro-feature-copy">
                    <Icon aria-hidden="true" />
                    <h3>{t(`proPage.${title}`)}</h3>
                    <p>{t(`proPage.${body}`)}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
