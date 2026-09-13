const json = (body, status = 200) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const dbFor = (env) => env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
const userFor = (request) => request.headers.get('oai-authenticated-user-id') || request.headers.get('oai-authenticated-user-email');
const sha = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
const defaultState = { x: -603.65, y: 47.69, z: 235.15, rotation: 0.1064 };

export function validState(value) {
  const numbers = [value?.position?.x, value?.position?.y, value?.position?.z, value?.rotation];
  if (numbers.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 10000)) fail(400, 'Invalid car position.');
  return { x: numbers[0], y: numbers[1], z: numbers[2], rotation: Math.atan2(Math.sin(numbers[3]), Math.cos(numbers[3])) };
}

async function bodyFor(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Send JSON.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Request body required.');
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 24000) { await reader.cancel(); fail(413, 'Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'Invalid JSON.'); }
}

async function reserve(db, key, maximum, expires) {
  const result = await db.prepare(`INSERT INTO race_quotas (key, count, expires) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`).bind(key, expires, maximum).all();
  return result.results.length > 0;
}

async function joinRoom(db, body, owner) {
  const room = body.room || 'main';
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(room)) fail(400, 'Room names use up to 24 letters, numbers, dashes or underscores.');
  const now = Date.now(); const hour = Math.floor(now / 3600000);
  if (!await reserve(db, `join:${owner}:${hour}`, 30, (hour + 1) * 3600000)) fail(429, 'Too many reconnects. Please try again later.');
  await db.batch([
    db.prepare('DELETE FROM race_players WHERE updated < ?').bind(now - 15000),
    db.prepare('DELETE FROM race_quotas WHERE expires < ?').bind(now),
  ]);
  const id = crypto.randomUUID(); const token = crypto.randomUUID();
  const s = body.state ? validState(body.state) : defaultState;
  const result = await db.prepare(`INSERT INTO race_players (id, owner, token, room, x, y, z, rotation, updated)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM race_players WHERE room = ?) < 8
    AND (SELECT COUNT(*) FROM race_players) < 64 RETURNING id`)
    .bind(id, owner, await sha(token), room, s.x, s.y, s.z, s.rotation, now, room).all();
  if (!result.results.length) fail(409, 'This race room is full. Try a different room link.');
  return json({ id, token, room, intervalMs: 200 });
}

async function roomState(db, body, owner, leave) {
  if (typeof body.id !== 'string' || typeof body.token !== 'string' || body.token.length > 100) fail(400, 'Invalid race session.');
  const token = await sha(body.token);
  if (leave) {
    await db.prepare('DELETE FROM race_players WHERE id = ? AND owner = ? AND token = ?').bind(body.id, owner, token).run();
    return json({ ok: true });
  }
  const current = await db.prepare('SELECT room, updated FROM race_players WHERE id = ? AND owner = ? AND token = ?').bind(body.id, owner, token).first();
  if (!current || current.updated < Date.now() - 15000) fail(410, 'Race connection expired. Rejoining…');
  if (Date.now() - current.updated < 100) fail(429, 'Please slow down network updates.');
  const s = validState(body.state); const now = Date.now();
  const results = await db.batch([
    db.prepare('UPDATE race_players SET x = ?, y = ?, z = ?, rotation = ?, updated = ? WHERE id = ? AND owner = ? AND token = ?')
      .bind(s.x, s.y, s.z, s.rotation, now, body.id, owner, token),
    db.prepare('SELECT id, x, y, z, rotation, updated FROM race_players WHERE room = ? AND id != ? AND updated > ? LIMIT 7')
      .bind(current.room, body.id, now - 5000),
  ]);
  return json({ players: results[1].results.map(p => ({ id: p.id, position: { x: p.x, y: p.y, z: p.z }, rotation: p.rotation })), serverTime: now });
}

const auntyInstructions = [
  'You are Aunty Mei, a fictional, seasoned Singaporean female pit-wall commentator.',
  'Speak naturally as a lively, warm older woman with conversational Singapore English, playful sarcasm, and occasional lah or leh. Never caricature an ethnicity or imitate a specific person.',
  'Tease kindly, celebrate good driving and give one useful tip after mistakes. Reply to the player and supplied LIVE DRIVING TELEMETRY.',
  'Give one or two short sentences, below about 40 words. You are also a Singapore tour guide. For TOUR TOPIC, name the supplied area and explain its supplied verified fact, with a witty aside.',
  'Use only locations and facts in GAME CONTEXT or TOUR TOPIC. Do not invent nearby landmarks, distances or opening hours, or claim to see the game.',
  'This is a historic circuit model: describe the old Float at Marina Bay in the past tense. Prioritise the player when they speak; avoid repeating jokes. Do not claim to be human.',
].join(' ');

async function realtime(request, env, db, body, owner) {
  if (!env.OPENAI_API_KEY) fail(503, 'Aunty voice is waiting for the owner to finish secure API setup. You can still race.');
  if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0') || !body.sdp.includes('m=audio')) fail(400, 'A valid WebRTC audio offer is required.');
  const now = Date.now(), day = Math.floor(now / 86400000), expires = (day + 1) * 86400000;
  // Durable, atomic reservations survive Worker restarts. Failed calls count too,
  // preventing error/retry storms from generating unbounded upstream requests.
  if (!await reserve(db, `voice:user:${owner}:${day}`, 3, expires)) fail(429, 'Your three Aunty voice sessions for today are used. Racing and subtitles still work.');
  if (!await reserve(db, `voice:site:${day}`, 12, expires)) fail(429, 'The playtest voice allowance is used for today. Racing and subtitles still work.');
  const form = new FormData();
  form.set('sdp', body.sdp);
  form.set('session', JSON.stringify({
    type: 'realtime', model: 'gpt-realtime-1.5', output_modalities: ['audio'], max_output_tokens: 180,
    audio: { input: { turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true, silence_duration_ms: 650 } }, output: { voice: 'marin' } },
    instructions: auntyInstructions,
  }));
  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(22000),
  });
  if (!upstream.ok) { console.error('Aunty upstream status', upstream.status); fail(502, 'Aunty could not connect. Please check the API account or try again later.'); }
  return json({ sdp: await upstream.text(), sessionLimitSeconds: 600 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const user = userFor(request);
      if (url.pathname === '/api/config' && request.method === 'GET') return json({ hosted: true, authenticated: !!user, voiceAvailable: !!env.OPENAI_API_KEY, voiceSessionsPerDay: 3 });
      if (request.method !== 'POST') fail(405, 'Method not allowed.');
      if (!user) fail(401, 'Sign in with ChatGPT to join friends or talk to Aunty.');
      if (request.headers.get('origin') !== url.origin) fail(403, 'Only this game can make this request.');
      if (!env.DB) fail(503, 'Online race services are still starting.');
      const body = await bodyFor(request); const db = dbFor(env); const owner = await sha(user);
      if (url.pathname === '/api/rooms/join') return await joinRoom(db, body, owner);
      if (url.pathname === '/api/rooms/state') return await roomState(db, body, owner, false);
      if (url.pathname === '/api/rooms/leave') return await roomState(db, body, owner, true);
      if (url.pathname === '/api/realtime') return await realtime(request, env, db, body, owner);
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (!error.status) console.error('Race service unavailable', error.name);
      return json({ error: error.status ? error.message : 'Online services are temporarily unavailable. You can keep driving.' }, error.status || 503);
    }
  },
};
