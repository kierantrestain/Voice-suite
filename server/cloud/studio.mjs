import { randomUUID } from 'node:crypto';
import {
  assetPath,
  account,
  currentMonth,
  privatePostgresStore,
  reserve,
  StudioError,
  update,
} from './store.mjs';
import { cloudConfig, pcmRecording, providers } from './providers.mjs';
import { readInvite, sessionActor, sessionCookie } from './session.mjs';

const ID = /^[a-f0-9-]{36}$/;
const OPENAI_VOICES = new Set(['alloy', 'coral', 'nova', 'onyx', 'sage', 'shimmer']);

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, more = {}) =>
  Response.json(body, { status, headers: { ...headers, ...more } });
const empty = (more = {}) => new Response(null, { status: 204, headers: { ...headers, ...more } });

async function input(request, maxBytes = 8192) {
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new StudioError(413, 'cloud.tooLarge');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new StudioError(400, 'cloud.invalidInput');
  }
}

function label(value, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength)
    throw new StudioError(400, 'cloud.invalidInput');
  return value.trim();
}

function owned(list, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new StudioError(404, 'cloud.missing');
  const item = list.find((item) => item.id === id);
  if (!item) throw new StudioError(404, 'cloud.missing');
  return item;
}

function describeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    consentedAt: profile.consentedAt,
    clone: profile.verificationRequired
      ? 'verification'
      : profile.voice
        ? 'ready'
        : profile.pending
          ? 'pending'
          : 'none',
  };
}

function assertCapacity(list, max) {
  if (list.length >= max) throw new StudioError(409, 'cloud.storageLimit');
}

async function audioFromForm(form) {
  const file = form.get('audio');
  if (!(file instanceof File) || file.size > 4_000_000)
    throw new StudioError(400, 'cloud.invalidRecording');
  return pcmRecording(await file.arrayBuffer());
}

async function formData(request) {
  try {
    return await request.formData();
  } catch {
    throw new StudioError(400, 'cloud.invalidInput');
  }
}

function respondAudio(request, file, type, filename, download) {
  const audioHeaders = {
    ...headers,
    'Content-Type': type,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'Accept-Ranges': 'bytes',
  };
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, file.length - Number(match?.[2]));
    const end =
      match?.[1] && match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
    if (!match || (!match[1] && !match[2]) || start >= file.length || end < start)
      return new Response(null, {
        status: 416,
        headers: { ...audioHeaders, 'Content-Range': `bytes */${file.length}` },
      });
    const part = file.subarray(start, end + 1);
    return new Response(part, {
      status: 206,
      headers: {
        ...audioHeaders,
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Content-Length': String(part.length),
      },
    });
  }
  return new Response(file, {
    headers: { ...audioHeaders, 'Content-Length': String(file.length) },
  });
}

export function createCloudStudio({ env = process.env, store, fetchImpl = fetch } = {}) {
  const config = cloudConfig(env);
  const provider = providers(config, fetchImpl);
  const storage = () => (store ??= privatePostgresStore(env));

  async function handle(request) {
    const url = new URL(request.url);
    const method = request.method;
    const action = url.searchParams.get('action') ?? 'status';
    if (method === 'GET' && action === 'status') {
      return json({
        configured: config.ready,
        authenticated: config.ready && Boolean(sessionActor(request, config.secret)),
      });
    }
    if (!config.ready) throw new StudioError(503, 'cloud.unavailable');
    if (!['GET', 'POST', 'DELETE'].includes(method))
      throw new StudioError(405, 'cloud.invalidInput');
    // Cookie authentication is host-only. Mutations must also come from this site's origin.
    if (method !== 'GET' && request.headers.get('origin') !== url.origin)
      throw new StudioError(403, 'cloud.session');

    if (method === 'POST' && action === 'signin') {
      const body = await input(request, 1024);
      const invite = readInvite(
        config.secret,
        typeof body.code === 'string' ? body.code.trim() : '',
      );
      if (!invite) throw new StudioError(401, 'cloud.invite');
      await update(storage(), (state) => {
        const now = Date.now() / 1000;
        for (const nonce of Object.keys(state.redeemed))
          if (state.redeemed[nonce] <= now) delete state.redeemed[nonce];
        if (Object.hasOwn(state.redeemed, invite.nonce)) throw new StudioError(401, 'cloud.invite');
        if (!Object.hasOwn(state.accounts, invite.sub)) {
          assertCapacity(Object.keys(state.accounts), 50);
          state.accounts[invite.sub] = { profiles: [], projects: [], takes: [], usage: {} };
        }
        state.redeemed[invite.nonce] = invite.exp;
      });
      return empty({ 'Set-Cookie': sessionCookie(config.secret, invite.sub) });
    }
    if (method === 'POST' && action === 'signout') {
      return empty({ 'Set-Cookie': sessionCookie(config.secret, null) });
    }

    const actor = sessionActor(request, config.secret);
    if (!actor) throw new StudioError(401, 'cloud.session');
    const db = storage();
    const read = async () => account((await db.workspace()).state, actor);
    const change = (mutate, audio) =>
      update(db, (state) => mutate(account(state, actor), state), audio);

    if (method === 'GET' && action === 'workspace') {
      const { state } = await db.workspace();
      const user = account(state, actor);
      const month = currentMonth(state);
      return json({
        profiles: user.profiles.map(describeProfile),
        projects: user.projects,
        takes: user.takes,
        providers: config.capabilities,
        budget: { month, limit: config.monthly, reserved: state.reserved, usage: user.usage },
      });
    }

    if (method === 'POST' && action === 'profile') {
      const form = await formData(request);
      const name = label(form.get('name'), 80);
      if (form.get('consent') !== 'own-voice') throw new StudioError(400, 'cloud.consent');
      const { bytes, seconds } = await audioFromForm(form);
      if (seconds < 3) throw new StudioError(400, 'cloud.invalidRecording');
      const profile = { id: randomUUID(), name, consentedAt: new Date().toISOString() };
      const path = assetPath(actor, profile.id + '.wav');
      await change(
        (user) => {
          assertCapacity(user.profiles, 12);
          user.profiles.unshift(profile);
        },
        { path, bytes },
      );
      return json(describeProfile(profile), 201);
    }

    if (method === 'POST' && action === 'project') {
      const body = await input(request);
      const name = label(body.name, 80);
      const project = { id: randomUUID(), name };
      await change((user) => {
        assertCapacity(user.projects, 40);
        user.projects.unshift(project);
      });
      return json(project, 201);
    }

    if (method === 'POST' && action === 'clone') {
      if (!config.capabilities.clone) throw new StudioError(503, 'cloud.providerUnavailable');
      const body = await input(request);
      if (body.confirm !== true) throw new StudioError(400, 'cloud.consent');
      const profile = await change((user, state) => {
        const item = owned(user.profiles, body.id);
        if (item.deleting || item.pending) throw new StudioError(409, 'cloud.busy');
        if (!item.voice) {
          reserve(state, actor, 'elevenlabs:clone', config.rates.clone, config.monthly);
          item.pending = true;
        }
        return item;
      });
      if (profile.voice) return json(describeProfile(profile));
      let voice;
      try {
        const recording = await db.getAudio(assetPath(actor, profile.id + '.wav'));
        if (!recording) throw new StudioError(404, 'cloud.missing');
        voice = await provider.clone(profile.name, recording);
      } catch (error) {
        await change((user) => {
          delete owned(user.profiles, profile.id).pending;
        });
        throw error;
      }
      try {
        return json(
          await change((user) => {
            const item = owned(user.profiles, profile.id);
            item.voice = voice.id;
            item.verificationRequired = voice.verificationRequired;
            delete item.pending;
            return describeProfile(item);
          }),
        );
      } catch (error) {
        // The provider created a voice but the workspace could not attach it.
        // Revoke that orphan before allowing another paid attempt for this profile.
        await provider.revoke(voice.id);
        await change((user) => {
          delete owned(user.profiles, profile.id).pending;
        });
        throw error;
      }
    }

    if (method === 'DELETE' && action === 'profile') {
      const id = url.searchParams.get('id');
      const item = await change((user) => {
        const profile = owned(user.profiles, id);
        if (profile.pending) throw new StudioError(409, 'cloud.busy');
        profile.deleting = true;
        return profile;
      });
      if (item.voice) await provider.revoke(item.voice);
      await change(
        (user) => {
          user.profiles = user.profiles.filter((profile) => profile.id !== id);
        },
        { path: assetPath(actor, item.id + '.wav') },
      );
      return empty();
    }

    if (method === 'POST' && action === 'speech') {
      const body = await input(request);
      if (!config.capabilities.speech.includes(body.provider))
        throw new StudioError(503, 'cloud.providerUnavailable');
      if (body.confirm !== true) throw new StudioError(400, 'cloud.consent');
      const script = label(body.text, 1500);
      const take = {
        id: randomUUID(),
        provider: body.provider,
        createdAt: new Date().toISOString(),
        projectId: null,
        profileId: null,
        synthetic: true,
      };
      const voiceId = await change((user, state) => {
        assertCapacity(user.takes, 120);
        if (body.projectId) take.projectId = owned(user.projects, body.projectId).id;
        let voice = OPENAI_VOICES.has(body.voice) ? body.voice : 'alloy';
        if (body.provider === 'elevenlabs') {
          const profile = owned(user.profiles, body.profileId);
          if (!profile.voice || profile.deleting || profile.verificationRequired)
            throw new StudioError(409, 'cloud.voiceRequired');
          voice = profile.voice;
          take.profileId = profile.id;
        }
        const cost = Math.ceil(
          (config.rates[body.provider + 'Speech'] * Buffer.byteLength(script)) / 1000,
        );
        reserve(state, actor, body.provider + ':speech', cost, config.monthly);
        return voice;
      });
      const audio = await provider.speech(take.provider, script, voiceId);
      const path = assetPath(actor, take.id + '.mp3');
      await change(
        (user) => {
          assertCapacity(user.takes, 120);
          if (take.profileId && owned(user.profiles, take.profileId).deleting)
            throw new StudioError(409, 'cloud.voiceRequired');
          user.takes.unshift(take);
        },
        { path, bytes: audio },
      );
      return json(take, 201);
    }

    if (method === 'POST' && action === 'transcribe') {
      const form = await formData(request);
      const engine = form.get('provider');
      if (!config.capabilities.transcription.includes(engine))
        throw new StudioError(503, 'cloud.providerUnavailable');
      if (form.get('confirm') !== 'true') throw new StudioError(400, 'cloud.consent');
      const { bytes, seconds } = await audioFromForm(form);
      const cost = Math.ceil(
        (config.rates[engine + 'Transcribe'] *
          Math.max(engine === 'groq' ? 10 : 1, Math.ceil(seconds))) /
          60,
      );
      await change((_user, state) => {
        reserve(state, actor, engine + ':transcribe', cost, config.monthly);
      });
      return json({ text: await provider.transcribe(engine, bytes) });
    }

    if (method === 'GET' && action === 'audio') {
      const user = await read();
      const kind = url.searchParams.get('kind');
      const reference = kind === 'reference';
      const item = owned(reference ? user.profiles : user.takes, url.searchParams.get('id'));
      if (item.deleting) throw new StudioError(404, 'cloud.missing');
      const suffix = reference ? '.wav' : '.mp3';
      const file = await db.getAudio(assetPath(actor, item.id + suffix));
      if (!file) throw new StudioError(404, 'cloud.missing');
      const download = url.searchParams.get('download') === '1';
      return respondAudio(
        request,
        file,
        reference ? 'audio/wav' : 'audio/mpeg',
        `voice-suite-${item.id}${suffix}`,
        download,
      );
    }

    if (method === 'DELETE' && action === 'audio') {
      const user = await read();
      const take = owned(user.takes, url.searchParams.get('id'));
      await change(
        (user) => {
          user.takes = user.takes.filter((item) => item.id !== take.id);
        },
        { path: assetPath(actor, take.id + '.mp3') },
      );
      return empty();
    }

    throw new StudioError(404, 'cloud.missing');
  }

  return async (request) => {
    try {
      return await handle(request);
    } catch (error) {
      if (error instanceof StudioError) return json({ error: error.code }, error.status);
      // Never log request bodies, tokens, storage URLs, or provider errors.
      console.warn('[Voice Suite Cloud]', error?.name ?? 'Unknown error');
      return json({ error: 'cloud.unavailable' }, 503);
    }
  };
}
