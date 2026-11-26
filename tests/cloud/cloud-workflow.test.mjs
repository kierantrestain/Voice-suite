import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudStudio } from '../../server/cloud/studio.mjs';
import { createInvite } from '../../server/cloud/session.mjs';
import { newWorkspace } from '../../server/cloud/store.mjs';

const origin = 'https://studio.example';
const secret = 'test-secret-'.repeat(4);

function memoryStore() {
  let state = newWorkspace();
  let version = 0;
  const media = new Map();
  return {
    async workspace() {
      return { state: structuredClone(state), revision: version };
    },
    async replaceWorkspace(next, revision, audio) {
      if (revision !== version) return false;
      state = structuredClone(next);
      version++;
      if (audio?.bytes) media.set(audio.path, Buffer.from(audio.bytes));
      if (audio && !audio.bytes) media.delete(audio.path);
      return true;
    },
    async getAudio(path) {
      return media.get(path) ?? null;
    },
  };
}

function voice() {
  const bytes = Buffer.alloc(44 + 4 * 24_000 * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return new Blob([bytes], { type: 'audio/wav' });
}

test('Cloud keeps recordings private and atomically caps consented provider work', async () => {
  const calls = [];
  const env = {
    VOICE_SUITE_CLOUD_ENABLED: '1',
    VOICE_SUITE_CLOUD_SECRET: secret,
    DATABASE_URL: 'postgresql://fixture.invalid/voice-suite',
    ELEVENLABS_API_KEY: 'server-only-key',
    OPENAI_API_KEY: 'server-only-openai-key',
    GROQ_API_KEY: 'server-only-groq-key',
    VOICE_SUITE_CLOUD_BUDGET: JSON.stringify({
      monthly: 0.25,
      clone: 0.01,
      elevenlabsSpeechPer1000: 0.2,
      openaiSpeechPer1000: 0.2,
      openaiTranscribePerMinute: 0.01,
      groqTranscribePerMinute: 0.01,
    }),
  };
  const store = memoryStore();
  const studio = createCloudStudio({
    env,
    store,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/voices/add')) {
        assert.equal(init.headers['xi-api-key'], 'server-only-key');
        assert.ok(init.body.get('files') instanceof File);
        return Response.json({ voice_id: 'fixture-voice', requires_verification: false });
      }
      if (url.endsWith('/audio/transcriptions')) {
        assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
        return Response.json({ text: 'The fixture was transcribed.' });
      }
      if (url.includes('/text-to-speech/') || url.endsWith('/audio/speech')) {
        return new Response(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(200)]));
      }
      if (url.endsWith('/voices/fixture-voice') && init.method === 'DELETE')
        return new Response(null, { status: 204 });
      throw new Error('Unexpected provider call');
    },
  });
  const send = (action, { cookie, method = 'GET', body, params = '', from = origin, range } = {}) =>
    studio(
      new Request(`${origin}/api/cloud?action=${action}${params}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(range ? { Range: range } : {}),
          ...(method !== 'GET' ? { Origin: from } : {}),
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      }),
    );
  const signin = async (actor) => {
    const code = createInvite(secret, actor);
    const signed = await send('signin', { method: 'POST', body: { code } });
    assert.equal(signed.status, 204);
    assert.match(signed.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    assert.equal((await send('signin', { method: 'POST', body: { code } })).status, 401);
    return signed.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await signin('first-user');
  const outsider = await signin('other-user');
  assert.equal((await send('workspace')).status, 401);
  assert.equal(
    (
      await send('project', {
        cookie,
        method: 'POST',
        body: { name: 'csrf' },
        from: 'https://other.example',
      })
    ).status,
    403,
  );
  const form = new FormData();
  form.set('name', 'Synthetic QA voice');
  form.set('audio', voice(), 'test.wav');
  assert.equal((await send('profile', { cookie, method: 'POST', body: form })).status, 400);
  form.set('consent', 'own-voice');
  const saved = await send('profile', { cookie, method: 'POST', body: form });
  assert.equal(saved.status, 201);
  const profile = await saved.json();
  const again = createCloudStudio({
    env,
    store,
    fetchImpl: () => {
      throw new Error();
    },
  });
  assert.equal(
    (
      await again(
        new Request(origin + '/api/cloud?action=workspace', { headers: { Cookie: cookie } }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await send('audio', { cookie: outsider, params: `&kind=reference&id=${profile.id}` })).status,
    404,
  );
  const prefix = await send('audio', {
    cookie,
    params: `&kind=reference&id=${profile.id}`,
    range: 'bytes=0-3',
  });
  assert.equal(prefix.status, 206);
  assert.match(prefix.headers.get('content-range'), /^bytes 0-3\//);
  assert.equal(await prefix.text(), 'RIFF');
  assert.equal(calls.length, 0);
  const project = await (
    await send('project', { cookie, method: 'POST', body: { name: 'QA project' } })
  ).json();
  const cloned = await send('clone', {
    cookie,
    method: 'POST',
    body: { id: profile.id, confirm: true },
  });
  assert.equal((await cloned.json()).clone, 'ready');
  const transcript = async () => {
    const form = new FormData();
    form.set('provider', 'groq');
    form.set('confirm', 'true');
    form.set('audio', voice(), 'test.wav');
    return send('transcribe', { cookie, method: 'POST', body: form });
  };
  assert.equal((await (await transcript()).json()).text, 'The fixture was transcribed.');
  const speech = {
    provider: 'elevenlabs',
    text: 'x'.repeat(950),
    profileId: profile.id,
    projectId: project.id,
    confirm: true,
  };
  const generated = await Promise.all([
    send('speech', { cookie, method: 'POST', body: speech }),
    send('speech', { cookie, method: 'POST', body: speech }),
  ]);
  assert.deepEqual(generated.map((result) => result.status).sort(), [201, 402]);
  const take = await generated.find((result) => result.status === 201).json();
  assert.equal(take.projectId, project.id);
  const exportFile = await send('audio', { cookie, params: `&id=${take.id}&download=1` });
  assert.match(exportFile.headers.get('content-disposition'), /^attachment/);
  assert.match(Buffer.from(await exportFile.arrayBuffer()).toString('latin1'), /Synthetic speech/);
  const openai = await send('speech', {
    cookie,
    method: 'POST',
    body: { text: 'Short preset take.', provider: 'openai', confirm: true },
  });
  assert.equal(openai.status, 201);
  assert.equal(
    (await send('profile', { cookie, method: 'DELETE', params: `&id=${profile.id}` })).status,
    204,
  );
  const response = await send('workspace', { cookie });
  const workspace = await response.text();
  assert.match(workspace, /"profiles":\[\]/);
  assert.doesNotMatch(workspace, /server-only|fixture-voice/);
  assert.equal(calls.length, 5);
});

test('provider keys never enable Cloud without explicit deployment configuration', async () => {
  const studio = createCloudStudio({ env: { ELEVENLABS_API_KEY: 'unused' }, store: memoryStore() });
  const response = await studio(new Request(origin + '/api/cloud'));
  assert.deepEqual(await response.json(), { configured: false, authenticated: false });
  const src = await readFile(new URL('../../vercel.json', import.meta.url), 'utf8');
  assert.ok(JSON.parse(src).functions['api/cloud.mjs']);
});
