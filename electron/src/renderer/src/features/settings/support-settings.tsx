import {
  BookOpenCheckIcon,
  Code2Icon,
  LightbulbIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { brandIcon } from '@/lib/brand';
import { ReportBug } from '@/components/report-bug';
import { ExternalLink } from '@/components/external-link';
import { ISSUES_URL, SECURITY_URL } from '@shared/utils/contactLinks';
import './support-settings.css';

export const _RETAINED_I18N_KEYS = [
  'donate.hero_title',
  'donate.footer',
  'donate.goal.title',
  'donate.suggested_title',
  'donate.custom',
  'donate.choose_method',
  'donate.choose_method_amount',
  'support.other_ways',
  'support.star_github',
  'support.join_discord',
  'support.sponsors_title',
  'support.sponsors_lead',
  'support.sponsors_empty_title',
  'support.sponsors_empty_desc',
  'support.sponsors_tier_strategic',
  'support.sponsors_tier_company',
  'support.sponsors_tier_development',
  'support.sponsors_tier_community',
  'support.sponsors_tier_supporter',
  'support.sponsors_become',
  'support.sponsors_learn_more',
  'supportPlans.pro',
  'proPage.title',
  'proPage.hero_body',
  'proPage.billing_note',
  'supportPlans.get_pro',
  'contact.channels_label',
  'contact.feature_cta',
  'contact.community_cta',
  'contact.follow_cta',
  'contact.security_cta',
  'contact.email',
  'contact.website',
] as const;

export function SupportSettings() {
  const { t } = useTranslation();

  return (
    <div className="support-studio">
      <header className="support-intro">
        <div className="support-emblem" aria-hidden="true">
          <img src={brandIcon} alt="" width={100} height={100} />
        </div>
        <h1>Voice Suite — Local-First Open Source &amp; Licensing</h1>
        <p>{t('proPage.free_body')}</p>
      </header>

      <div className="support-opportunities">
        <section
          className="support-tile support-license"
          aria-labelledby="support-agpl-heading"
        >
          <ScaleIcon className="support-tile-icon" aria-hidden="true" />
          <h2 id="support-agpl-heading">GNU Affero General Public License v3.0 (AGPL-3.0)</h2>
          <p>
            Voice Suite is free and open-source software distributed under the terms of the
            AGPL-3.0. All synthesis, voice cloning, voice design, dubbing, transcription, dictation,
            and audiobook workflows run locally on your hardware with no cloud subscription or paid
            tier required.
          </p>
          <p>{t('proPage.commercial_body')}</p>
        </section>

        <section
          className="support-tile support-sponsors"
          aria-labelledby="support-attribution-heading"
        >
          <Code2Icon className="support-tile-icon" aria-hidden="true" />
          <h2 id="support-attribution-heading">Upstream Attribution &amp; Credits</h2>
          <p>
            Built upon the open-source foundation created by{' '}
            <strong>Palash Debnath and VoiceStudio contributors</strong>, with core speech synthesis
            powered by <strong>k2-fsa/OmniVoice</strong> and the open-source speech research
            community.
          </p>
          <div className="support-tile-actions">
            <ExternalLink href="https://github.com/debpalash/VoiceStudio">
              Upstream VoiceStudio Repository
            </ExternalLink>
            <ExternalLink href="https://github.com/k2-fsa/OmniVoice">
              k2-fsa/OmniVoice
            </ExternalLink>
          </div>
        </section>
      </div>

      <section className="support-contact" aria-labelledby="support-contact-heading">
        <div className="support-contact-heading">
          <h2 id="support-contact-heading">{t('contact.channels_label')}</h2>
          <ReportBug />
        </div>
        <div className="support-channel-grid">
          <ExternalLink href={ISSUES_URL}>
            <LightbulbIcon aria-hidden="true" />
            <span>{t('contact.feature_cta')}</span>
          </ExternalLink>
          <ExternalLink href={SECURITY_URL}>
            <ShieldCheckIcon aria-hidden="true" />
            <span>{t('contact.security_cta')}</span>
          </ExternalLink>
          <ExternalLink href="https://www.gnu.org/licenses/agpl-3.0.html">
            <BookOpenCheckIcon aria-hidden="true" />
            <span>AGPL-3.0 License Terms</span>
          </ExternalLink>
        </div>
      </section>
    </div>
  );
}
