import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { scrubText } from '../src/shared/utils/scrub.js';
import { ROUTES } from './fixtures/routes.mjs';
let lastBackendObservation = { stage: 'unknown', at: null };
function observeBackendStatus(status) {
  lastBackendObservation = { stage: status.stage, at: new Date().toISOString() };
  return status;
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const targetArch = process.env.VOICESTUDIO_RUST_TARGET?.startsWith('aarch64')
  ? 'arm64'
  : process.env.VOICESTUDIO_RUST_TARGET?.startsWith('x86_64')
    ? 'x64'
    : process.arch;
const defaultExecutableCandidates =
  process.platform === 'win32'
    ? targetArch === 'arm64'
      ? [
          'electron/release/win-arm64-unpacked/Voice Suite.exe',
          'electron/release/win-unpacked/Voice Suite.exe',
          'electron/release/win-arm64-unpacked/VoiceStudio.exe',
          'electron/release/win-unpacked/VoiceStudio.exe',
        ]
      : [
          'electron/release/win-unpacked/Voice Suite.exe',
          'electron/release/win-unpacked/VoiceStudio.exe',
        ]
    : process.platform === 'darwin'
      ? targetArch === 'arm64'
        ? [
            'electron/release/mac-arm64/Voice Suite.app/Contents/MacOS/Voice Suite',
            'electron/release/mac/Voice Suite.app/Contents/MacOS/Voice Suite',
            'electron/release/mac-arm64/VoiceStudio.app/Contents/MacOS/VoiceStudio',
            'electron/release/mac/VoiceStudio.app/Contents/MacOS/VoiceStudio',
          ]
        : [
            'electron/release/mac/Voice Suite.app/Contents/MacOS/Voice Suite',
            'electron/release/mac-x64/Voice Suite.app/Contents/MacOS/Voice Suite',
            'electron/release/mac/VoiceStudio.app/Contents/MacOS/VoiceStudio',
            'electron/release/mac-x64/VoiceStudio.app/Contents/MacOS/VoiceStudio',
          ]
      : targetArch === 'arm64'
        ? [
            'electron/release/linux-arm64-unpacked/voicestudio-desktop',
            'electron/release/linux-unpacked/voicestudio-desktop',
          ]
        : ['electron/release/linux-unpacked/voicestudio-desktop'];
const defaultExecutable =
  defaultExecutableCandidates.find((candidate) => existsSync(resolve(repoRoot, candidate))) ??
  defaultExecutableCandidates[0];
const executablePath = resolve(repoRoot, process.env.VOICESTUDIO_PACKAGED_EXE || defaultExecutable);
const existing = process.env.VOICESTUDIO_TEST_PROFILE;
const profile = existing || mkdtempSync(join(tmpdir(), 'voicestudio-packaged-check-'));
const keepProfile = process.env.VOICESTUDIO_KEEP_TEST_PROFILE === '1';
const setup = process.argv.includes('--setup');
const firstSound = process.argv.includes('--first-sound');
const quitDuringStartup = process.argv.includes('--quit-during-startup');
const install = process.argv.includes('--install') || firstSound;
const wayland = process.platform === 'linux' && process.env.VOICESTUDIO_TEST_WAYLAND === '1';
const scaleFactor = Number(process.env.VOICESTUDIO_TEST_SCALE_FACTOR);
const extractAndRun = process.env.APPIMAGE_EXTRACT_AND_RUN === '1';
if (quitDuringStartup && !existing)
  throw new Error('--quit-during-startup requires VOICESTUDIO_TEST_PROFILE with a managed runtime');
const activate = (locator) =>
  extractAndRun || wayland ? locator.dispatchEvent('click') : locator.click();
let env = { ...process.env, OMNIVOICE_ENV_FILE: resolve(profile, 'user-env') };
let verifyManagedShutdown = false;
if (setup || install || existing) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  env = {
    ...env,
    OMNIVOICE_PORT: String(port),
    OMNIVOICE_BACKEND_CMD: '',
    VOICESTUDIO_SKIP_BACKEND: '',
    HF_HOME: join(profile, 'hf-home'),
    HF_HUB_CACHE: join(profile, 'hf-home', 'hub'),
    HF_HUB_OFFLINE: firstSound ? '0' : '1',
    TRANSFORMERS_OFFLINE: firstSound ? '0' : '1',
    UV_CACHE_DIR: join(profile, 'uv-cache'),
    OMNIVOICE_DATA_DIR: join(profile, 'data'),
    OMNIVOICE_PRELOAD_TTS_ASR: '0',
    OMNIVOICE_PRELOAD_CAPTURE_ASR: '0',
    OMNIVOICE_PRELOAD_WATERMARK: '0',
  };
}
// If the process exits early, Playwright rejects its other launch waits too. Unhandled,
// they end this script before electron.launch's own error, whose call log carries the
// process's stderr and exit code (v0.5.8-beta.4 printed only 'Process failed to launch!').
const strayLaunchWait = (reason) => {
  if (reason?.message !== 'Process failed to launch!') throw reason;
};
process.on('unhandledRejection', strayLaunchWait);
const app = await electron.launch({
  executablePath,
  args: [
    '--user-data-dir=' + profile,
    ...(wayland ? ['--ozone-platform=wayland'] : []),
    ...(Number.isFinite(scaleFactor) && scaleFactor > 0
      ? [`--force-device-scale-factor=${scaleFactor}`]
      : []),
  ],
  env,
  timeout: 30000,
});
process.off('unhandledRejection', strayLaunchWait);
try {
  const native = await app.evaluate(async () => {
    const { spawn } = process.getBuiltinModule('child_process');
    const { join } = process.getBuiltinModule('path');
    return new Promise((resolve, reject) => {
      const executable = join(
        process.resourcesPath,
        'native',
        'voicestudio-desktop-bridge' + (process.platform === 'win32' ? '.exe' : ''),
      );
      const child = spawn(executable, [String(process.pid)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Packaged helper timeout: ' + errors));
      }, 5000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        errors = (errors + chunk.toString()).slice(-8192);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        try {
          if (code !== 0) throw new Error('Packaged helper failed: ' + code + ': ' + errors);
          resolve(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify({ id: 1, method: 'ping' }) + '\n');
    });
  });
  assert.deepEqual(native, { id: 1, result: { protocol: 1 } });
  const window = await app.firstWindow();
  const errors = [];
  let loggedErrors = 0;
  window.on('pageerror', (error) => {
    errors.push(error.message);
    if (loggedErrors++ >= 10) return;
    const path = new URL(window.url()).hash.replace(/^#/, '').split(/[?#]/, 1)[0] || '/';
    // Project synchronously: no retained Error or delayed route/permission read.
    // The sample time distinguishes the last observed backend state from the
    // error occurrence, without adding IPC/network work to a failing renderer.
    console.error('[packaged renderer pageerror]', JSON.stringify({
      at: new Date().toISOString(),
      hash: ROUTES.includes(path) ? '#' + path : '#/<other>',
      backendStage: lastBackendObservation.stage,
      backendObservedAt: lastBackendObservation.at,
      stack: scrubText(String(error.stack ?? '').slice(0, 16384))
        .replace(/smk_[a-z2-7]{39}/g, '<REDACTED>')
        .replace(/((?:https?|app|file):\/\/[^\s?#)]*)[?#][^\s)]*/g, '$1')
        .slice(0, 8192),
    }));
  });
  await window.waitForURL('app://voicestudio/**');
  if (firstSound) {
    const resumed = await window.evaluate(() => {
      const complete = localStorage.getItem('voicestudio.setup.complete.v1') === '1';
      localStorage.removeItem('voicestudio.setup.complete.v1');
      localStorage.removeItem('voicestudio.setup.in-progress.v1');
      return complete;
    });
    if (resumed) await window.reload();
  }

  if (quitDuringStartup) {
    const sentinel = join(profile, 'data', 'run_sentinel.json');
    await assertEventually(
      () => existsSync(sentinel),
      10_000,
      'Backend did not create its run sentinel during startup',
    );
    const progress = await fetch(
      `http://127.0.0.1:${env.OMNIVOICE_PORT}/startup/progress?ts=${Date.now()}`,
      { cache: 'no-store' },
    ).then((response) => response.json());
    assert.equal(
      progress.status,
      'starting',
      'Acceptance must quit before deferred startup is ready',
    );
    verifyManagedShutdown = true;
    console.log('PASS: packaged backend reached deferred startup before deliberate quit');
  } else if (setup) {
    await window.getByText('Voice Suite', { exact: true }).first().waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(960, 640);
    });
    const setupLayout = await window.evaluate(() => {
      const header = document.querySelector('header.workspace-titlebar');
      const scroller = document.querySelector('[data-testid="backend-gate-scroll"]');
      const brand = header?.textContent?.includes('Voice Suite') ? header : null;
      const headerRect = header?.getBoundingClientRect();
      const scrollRect = scroller?.getBoundingClientRect();
      return {
        brandVisible: Boolean(brand && headerRect && headerRect.height > 0),
        headerTop: headerRect?.top,
        headerBottom: headerRect?.bottom,
        scrollTop: scrollRect?.top,
        viewportHeight: document.documentElement.clientHeight,
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.equal(setupLayout.brandVisible, true, 'Setup branding must remain visible');
    assert.equal(setupLayout.headerTop, 0, 'Setup header must stay pinned to the window top');
    assert.equal(
      setupLayout.scrollTop,
      setupLayout.headerBottom,
      'Setup content must scroll below the fixed branding',
    );
    assert(
      setupLayout.headerBottom <= setupLayout.viewportHeight,
      'Setup branding must remain inside the short-window viewport',
    );
    assert(
      setupLayout.scrollWidth <= setupLayout.width + 1,
      'Setup gate must not overflow horizontally',
    );
    const setupStatus = await waitForRuntimeGate(window, 30_000);
    const installButton = window.getByRole('button', { name: 'Install local runtime', exact: true });
    if (process.platform === 'darwin' && targetArch === 'x64') {
      assert.equal(setupStatus.setupIssue, 'unsupported_platform');
      await window.getByRole('textbox', { name: 'Backend URL', exact: true }).waitFor();
      await window.getByRole('button', { name: 'Test connection', exact: true }).waitFor();
      assert.equal(await installButton.count(), 0, 'Intel Macs must offer remote setup');
    } else {
      await installButton.waitFor();
    }
    assert.equal(
      await window.evaluate(() => typeof window.voicestudio.backend.cleanSetupRuntime),
      'function',
    );
    const stage = await window.evaluate(
      async () => (await window.voicestudio.backend.getStatus()).stage,
    );
    assert.equal(stage, 'setup_required');
    assert.equal(
      existsSync(join(profile, 'runtime')),
      false,
      'Startup must not install before the explicit action',
    );
    const customParent = join(profile, 'custom-runtime-parent');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, customParent);
    const selected = await window.evaluate(() =>
      window.voicestudio.backend.chooseRuntimeLocation('Choose runtime location'),
    );
    assert.deepEqual(selected, {
      path: join(customParent, 'VoiceStudio'),
      custom: true,
    });
    assert.equal(
      (await window.evaluate(() => window.voicestudio.backend.getStatus())).runtimeCustom,
      true,
    );
    const restored = await window.evaluate(() =>
      window.voicestudio.backend.useDefaultRuntimeLocation(),
    );
    assert.equal(restored.custom, false);
    assert.equal(
      (await window.evaluate(() => window.voicestudio.backend.getStatus())).runtimeCustom,
      false,
    );
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    assert.equal(
      await window.evaluate(() =>
        window.voicestudio.backend.chooseRuntimeLocation('Choose runtime location'),
      ),
      null,
    );
    assert.equal(
      existsSync(join(customParent, 'VoiceStudio')),
      false,
      'Choosing a runtime location must not install before consent',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: packaged first-run setup awaits explicit action and its native location picker changes/restores the destination without installing',
    );
  } else {
    if (install) {
      console.log('Testing explicit installation in', profile);
      let state = await waitForRuntimeGate(window, firstSound ? 120_000 : 30_000);
      if (state.stage !== 'ready') {
        const installButton = window.getByRole('button', {
          name: 'Install local runtime',
          exact: true,
        });
        // WSLg/Wayland can report a stable DOM box while Playwright's native
        // compositor actionability check never settles. Pointer behavior is
        // covered separately; this flow verifies setup and first sound.
        await activate(installButton);
      }
      const deadline =
        Date.now() +
        (Number(process.env.VOICESTUDIO_RUNTIME_TIMEOUT_MS) || (firstSound ? 1_800_000 : 600_000));
      let lastStage = '';
      for (;;) {
        state = observeBackendStatus(await window.evaluate(async () => window.voicestudio.backend.getStatus()));
        if (state.stage !== lastStage) {
          console.log('Runtime:', state.stage);
          lastStage = state.stage;
        }
        if (state.stage === 'ready') break;
        if (['setup_required', 'failed', 'crashed', 'port_in_use'].includes(state.stage))
          throw new Error(JSON.stringify(state));
        assert(Date.now() < deadline, 'Runtime startup timed out');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(
        await window.evaluate(async () => (await window.voicestudio.backend.getStatus()).managed),
        true,
      );
    }
    if (firstSound) {
      const installModel = window.getByRole('button', {
        name: 'Install Text to speech',
        exact: true,
      });
      const useModel = window.getByRole('button', { name: 'Use this model', exact: true }).first();
      const chooseModel = installModel.or(useModel).first();
      await chooseModel.waitFor({ timeout: 120_000 });
      await activate(chooseModel);
      const generate = window.getByRole('button', { name: 'Generate a test clip', exact: true });
      await generate.waitFor({
        timeout: Number(process.env.VOICESTUDIO_MODEL_TIMEOUT_MS) || 900_000,
      });
      const startedAt = Date.now();
      await activate(generate);
      const audio = window.getByLabel('Generate a test clip', { exact: true });
      await audio.waitFor({
        timeout: Number(process.env.VOICESTUDIO_FIRST_SOUND_TIMEOUT_MS) || 300_000,
      });
      const elapsedMs = Date.now() - startedAt;
      const proof = await audio.evaluate(async (element) => {
        const response = await fetch(element.src);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const decoder = new TextDecoder('ascii');
        return {
          size: bytes.byteLength,
          riff: decoder.decode(bytes.subarray(0, 4)),
          wave: decoder.decode(bytes.subarray(8, 12)),
          bits: new DataView(bytes.buffer).getUint16(34, true),
          paused: element.paused,
        };
      });
      assert(proof.size > 44, 'First sound WAV is empty');
      assert.equal(proof.riff, 'RIFF');
      assert.equal(proof.wave, 'WAVE');
      assert.equal(proof.bits, 24);
      assert.equal(proof.paused, true, 'First sound must wait for playback');
      await audio.evaluate((element) => element.play());
      await window.waitForFunction(() => document.querySelector('audio')?.currentTime > 0.25);
      await audio.evaluate((element) => element.pause());
      const reportDir = process.env.VOICESTUDIO_FIRST_SOUND_REPORT_DIR;
      if (reportDir) {
        const wave = await audio.evaluate(async (element) =>
          Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer())),
        );
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(join(reportDir, 'first-sound.wav'), Buffer.from(wave));
      }
      console.log('PASS: first-run KittenTTS produced and played a 24-bit WAV', {
        size: proof.size,
        elapsedMs,
      });
      const storage = await window.evaluate(async () => {
        const response = await fetch('/api/api/settings/storage?refresh=1');
        if (!response.ok) throw new Error('Storage report returned ' + response.status);
        const { categories } = await response.json();
        return categories.map(({ id, bytes }) => ({ id, bytes }));
      });
      assert(storage.some(({ id, bytes }) => id === 'runtime' && bytes > 0));
      if (reportDir) writeFileSync(join(reportDir, 'storage.json'), JSON.stringify(storage, null, 2));
      await activate(window.getByRole('button', { name: 'Enter studio', exact: true }));
      await window.getByRole('heading', { name: 'Home', exact: true }).waitFor();
      console.log('PASS: entered the studio with measured storage', storage);
    }
    if (!firstSound) {
      await window.getByText('VoiceStudio', { exact: true }).first().waitFor({ timeout: 120_000 });
    }
    if (existing) {
      const deadline = Date.now() + 120_000;
      for (;;) {
        const current = observeBackendStatus(await window.evaluate(async () => window.voicestudio.backend.getStatus()));
        if (current.stage === 'ready') break;
        if (['setup_required', 'failed', 'crashed', 'port_in_use'].includes(current.stage))
          throw new Error(JSON.stringify(current));
        assert(Date.now() < deadline, 'Existing packaged runtime startup timed out');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal(
        await window.evaluate(async () => (await window.voicestudio.backend.getStatus()).managed),
        true,
      );
    }
    const state = await window.evaluate(async () => {
      const response = await fetch('/api/system/info');
      return {
        status: response.status,
        version: (await response.json()).app_version,
        bridge: typeof window.voicestudio,
      };
    });
    assert.equal(state.status, 200);
    assert.equal(state.bridge, 'object');
    assert(state.version);
    await window.goto('app://voicestudio/#/settings/models');
    await window.getByRole('textbox', { name: 'Custom mirror URL', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    const layout = await window.evaluate(() => ({
      devicePixelRatio,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      layout.scrollWidth <= layout.width + 1,
      'Packaged renderer must not overflow horizontally',
    );
    if (Number.isFinite(scaleFactor) && scaleFactor > 0)
      assert(
        Math.abs(layout.devicePixelRatio - scaleFactor) < 0.05,
        `Expected device scale ${scaleFactor}, received ${layout.devicePixelRatio}`,
      );
    if (process.env.VOICESTUDIO_SCREENSHOT && !extractAndRun) {
      await window.screenshot({ path: process.env.VOICESTUDIO_SCREENSHOT });
    }
    console.log(
      `PASS: packaged ${process.platform}${wayland ? ' Wayland' : ''} renderer, preload bridge and same-origin live backend connection`,
      state.version,
    );
    verifyManagedShutdown = install || Boolean(existing);
  }
} catch (error) {
  const windows = app.windows();
  if (windows[0])
    console.error(
      await windows[0]
        .evaluate(async () => window.voicestudio.backend.getStatus())
        .catch(() => 'No bridge'),
    );
  throw error;
} finally {
  try {
    await app.close();
    if (verifyManagedShutdown) {
      const sentinel = join(profile, 'data', 'run_sentinel.json');
      const deadline = Date.now() + 5_000;
      while (existsSync(sentinel) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        existsSync(sentinel),
        false,
        'A deliberate desktop shutdown must retire the backend run sentinel',
      );
      console.log('PASS: packaged managed backend shut down cleanly');
    }
  } finally {
    if (!existing && !keepProfile)
      rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  }
}

async function assertEventually(check, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function waitForRuntimeGate(window, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = observeBackendStatus(await window.evaluate(async () => window.voicestudio.backend.getStatus()));
    if (state.stage === 'ready' || state.stage === 'setup_required') return state;
    if (['failed', 'crashed', 'port_in_use'].includes(state.stage)) {
      throw new Error(JSON.stringify(state));
    }
    if (Date.now() >= deadline) throw new Error('Runtime setup gate timed out');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
