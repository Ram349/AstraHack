import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { validState } from '../hosting/worker.mjs';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_elite_maddog.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const statement of statements) out.push(await statement.all()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, ASSETS: { fetch: () => new Response('game') } };
  const call = async (path, body, user = 'driver-a', origin = 'https://race.example') => {
    const headers = { origin, 'content-type': 'application/json' };
    if (user) headers['oai-authenticated-user-id'] = user;
    const response = await worker.fetch(new Request(`https://race.example${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, data: await response.json() };
  };
  return { sqlite, env, call };
}
const state = { position: { x: -600, y: 48, z: 242 }, rotation: 0.2 };

test('public driving is open; APIs reject anonymous/cross-origin requests and invalid inputs', async () => {
  const { call, env, sqlite } = setup();
  assert.equal((await worker.fetch(new Request('https://race.example/'), env)).status, 200);
  assert.equal((await call('/api/config', undefined, null)).data.voiceAvailable, false);
  assert.equal((await call('/api/rooms/join', {}, null)).status, 401);
  assert.equal((await call('/api/rooms/join', {}, 'a', 'https://attacker.example')).status, 403);
  assert.equal((await call('/api/rooms/join', { room: "' OR 1=1" })).status, 400);
  assert.equal((await call('/api/realtime', { sdp: 'v=0\nm=audio' })).status, 503);
  assert.throws(() => validState({ position: { x: NaN, y: 0, z: 0 }, rotation: 0 }));
  sqlite.close();
});

test('two drivers share snapshots; other rooms and other drivers session tokens are isolated', async () => {
  const { call, sqlite } = setup();
  const a = (await call('/api/rooms/join', { room: 'friends', state }, 'a')).data;
  const b = (await call('/api/rooms/join', { room: 'friends', state }, 'b')).data;
  await call('/api/rooms/join', { room: 'elsewhere', state }, 'c');
  sqlite.exec('UPDATE race_players SET updated = updated - 250');
  const snapshot = await call('/api/rooms/state', { ...a, state }, 'a');
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.data.players.map(p => p.id), [b.id]);
  assert.equal((await call('/api/rooms/state', { ...a, state }, 'b')).status, 410);
  assert.equal((await call('/api/rooms/state', { ...a, token: 'wrong', state }, 'a')).status, 410);
  assert.equal((await call('/api/rooms/state', { ...a, state }, 'a')).status, 429);
  await call('/api/rooms/leave', b, 'b');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM race_players WHERE room = ?').get('friends').n, 1);
  sqlite.close();
});

test('room capacity and durable voice quotas cap requests without exposing keys', async () => {
  const { call, env, sqlite } = setup();
  for (let n = 0; n < 8; n++) assert.equal((await call('/api/rooms/join', { room: 'grid', state }, `u${n}`)).status, 200);
  assert.equal((await call('/api/rooms/join', { room: 'grid', state }, 'ninth')).status, 409);
  const originalFetch = globalThis.fetch; let upstreamCalls = 0;
  env.OPENAI_API_KEY = 'test-only-not-a-real-key';
  globalThis.fetch = async () => { upstreamCalls++; return new Response('v=0\nm=audio answer'); };
  try {
    for (let n = 0; n < 3; n++) {
      const response = await call('/api/realtime', { sdp: 'v=0\nm=audio offer' }, 'speaker');
      assert.equal(response.status, 200); assert.ok(!JSON.stringify(response).includes(env.OPENAI_API_KEY));
    }
    assert.equal((await call('/api/realtime', { sdp: 'v=0\nm=audio offer' }, 'speaker')).status, 429);
    for (let n = 0; n < 9; n++) assert.equal((await call('/api/realtime', { sdp: 'v=0\nm=audio offer' }, `speaker${n}`)).status, 200);
    assert.equal((await call('/api/realtime', { sdp: 'v=0\nm=audio offer' }, 'last')).status, 429);
    assert.equal(upstreamCalls, 12);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
