import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
try {
  await page.goto((process.env.VOICESTUDIO_UI_URL || 'http://localhost:3912') + '/#/settings/appearance');
  await page.getByRole('link', { name: 'Support', exact: true }).click();
  await page.getByRole('heading', { name: 'Voice Suite — Local-First Open Source & Licensing', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'GNU Affero General Public License v3.0 (AGPL-3.0)', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('link', { name: 'Upstream VoiceStudio Repository', exact: true }).getAttribute('href'),
    'https://github.com/debpalash/VoiceStudio',
  );
  assert.equal(
    await page.getByRole('link', { name: 'k2-fsa/OmniVoice', exact: true }).getAttribute('href'),
    'https://github.com/k2-fsa/OmniVoice',
  );
  assert.equal(
    await page.getByRole('link', { name: 'AGPL-3.0 License Terms', exact: true }).getAttribute('href'),
    'https://www.gnu.org/licenses/agpl-3.0.html',
  );
  assert.equal(
    await page.getByRole('link', { name: 'Report privately', exact: true }).getAttribute('href'),
    'https://github.com/kierantrestain/Voice-suite/security/advisories/new',
  );
  console.log(
    'Support navigation, AGPL-3.0 licensing, upstream attribution and private security destination passed; no external page opened.',
  );
} finally {
  await browser.close();
}
