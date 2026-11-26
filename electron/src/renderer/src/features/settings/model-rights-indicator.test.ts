import { describe, expect, it } from 'vitest';
import type { ModelLicenseInfo } from './model-license-contract';
import { classifyModelRights } from './model-rights-indicator';

const licenseInfo = (
  license: string,
  license_category: ModelLicenseInfo['license_category'],
): ModelLicenseInfo => ({ license, license_category }) as ModelLicenseInfo;

describe('classifyModelRights', () => {
  it('trusts authoritative backend license_category over fallback tokens', () => {
    expect(classifyModelRights('cosyvoice', licenseInfo('apache-2.0', 'commercial'))).toMatchObject(
      {
        category: 'commercial',
        isCommercialPermitted: true,
        isNonCommercial: false,
      },
    );

    expect(
      classifyModelRights('k2-fsa/OmniVoice', licenseInfo('CC-BY-NC', 'noncommercial')),
    ).toMatchObject({
      category: 'noncommercial',
      isCommercialPermitted: false,
      isNonCommercial: true,
    });

    expect(
      classifyModelRights('supertonic3', licenseInfo('openrail', 'conditions')),
    ).toMatchObject({
      category: 'conditions',
      isCommercialPermitted: false,
      isNonCommercial: false,
    });
  });

  it('classifies Apache-2.0 / MIT / CC-BY-4.0 commercial engines accurately without info', () => {
    for (const id of [
      'kittentts',
      'moss-tts-nano',
      'cosyvoice',
      'voxcpm2',
      'pockettts',
      'faster-whisper',
      'kokoro',
    ]) {
      const result = classifyModelRights(id);
      expect(result.category, id).toBe('commercial');
      expect(result.isCommercialPermitted, id).toBe(true);
      expect(result.isNonCommercial, id).toBe(false);
    }
  });

  it('flags non-commercial models and fails closed on unknown models', () => {
    expect(classifyModelRights('omnivoice').isNonCommercial).toBe(true);
    expect(classifyModelRights('facebook/nllb-200-distilled-600M').isNonCommercial).toBe(true);
    expect(classifyModelRights('IndexTeam/IndexTTS-2.5')).toMatchObject({
      category: 'unknown',
      isCommercialPermitted: false,
      isNonCommercial: false,
    });
  });
});
