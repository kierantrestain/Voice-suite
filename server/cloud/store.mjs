import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const MAX_STORED_AUDIO = 128 * 1024 * 1024;

export function cloudDatabaseUrl(env) {
  return env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
}

function storageNamespace(env) {
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV !== 'preview') return 'development';
  const ref = env.VERCEL_GIT_COMMIT_REF || 'preview';
  return 'preview-' + createHash('sha256').update(ref).digest('hex').slice(0, 24);
}

export class StudioError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function newWorkspace() {
  return { version: 1, redeemed: {}, accounts: {}, month: '', reserved: 0 };
}

export function account(state, actor) {
  // Only an authenticated invitation can create an account, and Object.hasOwn
  // keeps reserved object property names from becoming an identity.
  if (!Object.hasOwn(state.accounts, actor)) throw new StudioError(401, 'cloud.session');
  return state.accounts[actor];
}

export function currentMonth(state) {
  const month = new Date().toISOString().slice(0, 7);
  if (state.month !== month) {
    state.month = month;
    state.reserved = 0;
    for (const user of Object.values(state.accounts)) user.usage = {};
  }
  return month;
}

export function reserve(state, actor, action, microDollars, limit) {
  currentMonth(state);
  if (
    !Number.isSafeInteger(microDollars) ||
    microDollars <= 0 ||
    state.reserved + microDollars > limit
  ) {
    throw new StudioError(402, 'cloud.budget');
  }
  state.reserved += microDollars;
  const usage = account(state, actor).usage;
  const totals = (usage[action] ??= { calls: 0, reserved: 0 });
  totals.calls++;
  totals.reserved += microDollars;
}

export function privatePostgresStore(env) {
  const sql = neon(cloudDatabaseUrl(env));
  const namespace = storageNamespace(env);
  let schema;
  const ready = () =>
    (schema ??= sql
      .transaction([
        // Serialise first use across concurrent serverless instances.
        sql`SELECT pg_advisory_xact_lock(860601, 1)`,
        sql`CREATE TABLE IF NOT EXISTS voice_suite_cloud_workspaces (
        namespace text PRIMARY KEY,
        revision integer NOT NULL,
        state jsonb NOT NULL
      )`,
        sql`CREATE TABLE IF NOT EXISTS voice_suite_cloud_audio (
        namespace text NOT NULL,
        path text NOT NULL,
        content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 4000000),
        stored_bytes integer GENERATED ALWAYS AS (octet_length(content)) STORED,
        PRIMARY KEY (namespace, path)
      )`,
      ])
      .catch((error) => {
        schema = undefined;
        throw error;
      }));
  return {
    async workspace() {
      await ready();
      const [row] = await sql`SELECT state, revision FROM voice_suite_cloud_workspaces
        WHERE namespace = ${namespace}`;
      if (!row) return { state: newWorkspace(), revision: null };
      if (row.state?.version !== 1) throw new StudioError(503, 'cloud.unavailable');
      return row;
    },
    async replaceWorkspace(state, revision, audio) {
      await ready();
      const data = JSON.stringify(state);
      if (audio?.bytes) {
        const content = Buffer.from(audio.bytes).toString('base64');
        const [, [result]] = await sql.transaction(
          [
            sql`SELECT pg_advisory_xact_lock(860601, 2)`,
            sql`WITH capacity AS (
              SELECT coalesce(sum(stored_bytes), 0) + ${audio.bytes.byteLength}::integer
                <= ${MAX_STORED_AUDIO} AS fits FROM voice_suite_cloud_audio
            ), changed AS (
              UPDATE voice_suite_cloud_workspaces SET state = ${data}::jsonb, revision = revision + 1
                WHERE namespace = ${namespace} AND revision = ${revision} AND (SELECT fits FROM capacity)
                RETURNING revision
            ), written AS (
              INSERT INTO voice_suite_cloud_audio (namespace, path, content)
                SELECT ${namespace}, ${audio.path}, decode(${content}, 'base64') FROM changed RETURNING path
            ) SELECT fits, EXISTS (SELECT 1 FROM written) AS updated FROM capacity`,
          ],
          { isolationLevel: 'ReadCommitted' },
        );
        if (!result.fits) throw new StudioError(409, 'cloud.storageLimit');
        return result.updated;
      }
      if (audio) {
        const rows = await sql`WITH changed AS (
            UPDATE voice_suite_cloud_workspaces SET state = ${data}::jsonb, revision = revision + 1
              WHERE namespace = ${namespace} AND revision = ${revision} RETURNING revision
          ), removed AS (
            DELETE FROM voice_suite_cloud_audio WHERE namespace = ${namespace} AND path = ${audio.path}
              AND EXISTS (SELECT 1 FROM changed)
          ) SELECT revision FROM changed`;
        return rows.length === 1;
      }
      const rows =
        revision === null
          ? await sql`INSERT INTO voice_suite_cloud_workspaces (namespace, revision, state)
            VALUES (${namespace}, 1, ${data}::jsonb) ON CONFLICT DO NOTHING RETURNING revision`
          : await sql`UPDATE voice_suite_cloud_workspaces SET state = ${data}::jsonb, revision = revision + 1
            WHERE namespace = ${namespace} AND revision = ${revision} RETURNING revision`;
      return rows.length === 1;
    },
    async getAudio(path) {
      await ready();
      const [row] = await sql`SELECT encode(content, 'base64') AS audio FROM voice_suite_cloud_audio
        WHERE namespace = ${namespace} AND path = ${path}`;
      return row ? Buffer.from(row.audio, 'base64') : null;
    },
  };
}

/** A mutation never performs network side effects inside a retried transaction. */
export async function update(store, mutate, audio) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, revision } = await store.workspace();
    const result = mutate(state);
    if (await store.replaceWorkspace(state, revision, audio)) return result;
  }
  throw new StudioError(409, 'cloud.busy');
}

export function assetPath(actor, id) {
  return `voice-suite/cloud-v1/${actor}/${id}`;
}
