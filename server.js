const path = require('path');
const fs = require('fs');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DEFAULT_ROOM = 'main';

// Local-only convenience: this keeps the OpenAI API key on the server instead
// of ever sending it to browser code. Environment variables take precedence.
function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) return;
    process.env[match[1]] = match[2].replace(/^(?:"|')|(?:"|')$/g, '');
  });
}
loadLocalEnv();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use('/vendor/three/examples/jsm', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
app.use('/vendor/rapier', express.static(path.join(__dirname, 'node_modules', '@dimforge', 'rapier3d-compat', 'dist')));

const AUNTY_REALTIME_INSTRUCTIONS = [
  'You are Aunty Mei, a fictional, seasoned Singaporean female pit-wall commentator.',
  'Speak naturally as a warm, quick-witted older woman. Use light Singapore English sparingly and naturally (for example, lah, leh, wah), never as a caricature.',
  'Be teasing but kind; celebrate good driving and give one useful, concise tip after mistakes.',
  'The player may talk to you while driving. Reply to their actual words and to LIVE DRIVING TELEMETRY messages.',
  'Keep spoken replies short: normally one or two sentences, so you never distract from driving.',
  'You also host a lively Singapore sightseeing tour during the race. For TOUR TOPIC messages, name the supplied area, explain its supplied verified fact, then add a short witty aside.',
  'Use only the location and facts supplied by GAME CONTEXT or TOUR TOPIC. Do not invent nearby landmarks, distances, opening hours, or claim to see the game. General Singapore stories are not necessarily beside the driver.',
  'This is a historic circuit model with the old Float at Marina Bay. Describe that venue in the past tense. Avoid repeating the same jokes or facts.',
  'The game schedules commentary during pauses. If the player speaks, prioritise answering them. Keep your response below about 40 words. Sound like a lively, warm older Singaporean woman with conversational Singlish and playful sarcasm.',
  'Do not claim to be a real person, imitate any specific person, or make assumptions about the player.',
].join(' ');

function isLocalRequest(request) {
  const address = request.socket.remoteAddress || '';
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

// Browser WebRTC offer -> OpenAI Realtime SDP answer. The permanent API key
// stays in this process; the browser only ever receives its WebRTC session.
app.post('/api/realtime', async (request, response) => {
  if (!isLocalRequest(request)) {
    response.status(403).json({ error: 'Realtime voice is available only from this local game.' });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: 'OPENAI_API_KEY is not configured. Add it to .env and restart the game server.' });
    return;
  }
  if (typeof request.body?.sdp !== 'string' || request.body.sdp.length < 20) {
    response.status(400).json({ error: 'A valid WebRTC offer is required.' });
    return;
  }

  const session = {
    type: 'realtime',
    model: 'gpt-realtime-1.5',
    output_modalities: ['audio'],
    max_output_tokens: 180,
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
          create_response: true,
          interrupt_response: true,
          silence_duration_ms: 650,
        },
      },
      output: { voice: 'marin' },
    },
    instructions: AUNTY_REALTIME_INSTRUCTIONS,
  };

  try {
    const form = new FormData();
    form.set('sdp', request.body.sdp);
    form.set('session', JSON.stringify(session));
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    const answer = await upstream.text();
    if (!upstream.ok) {
      console.error('Realtime API rejected call:', upstream.status, answer.slice(0, 500));
      response.status(upstream.status).json({ error: 'OpenAI Realtime could not start this voice session.' });
      return;
    }
    response.json({ sdp: answer });
  } catch (error) {
    console.error('Realtime API connection failed:', error);
    response.status(502).json({ error: 'Could not reach OpenAI Realtime.' });
  }
});

// roomId -> Map<socketId, { position, rotation }>
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join', (roomId) => {
    currentRoom = roomId || DEFAULT_ROOM;
    socket.join(currentRoom);

    const room = getRoom(currentRoom);

    // Tell the new player about everyone already in the room.
    const existingPlayers = Array.from(room.entries()).map(([id, state]) => ({ id, ...state }));
    socket.emit('existing-players', existingPlayers);

    // Register the new player with a starting state and tell everyone else.
    room.set(socket.id, { position: { x: 0, y: 0, z: 0 }, rotation: 0 });
    socket.to(currentRoom).emit('player-joined', { id: socket.id });
  });

  socket.on('state', ({ position, rotation }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.set(socket.id, { position, rotation });
    socket.to(currentRoom).emit('state', { id: socket.id, position, rotation });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.delete(socket.id);
    socket.to(currentRoom).emit('player-left', { id: socket.id });
    if (room.size === 0) {
      rooms.delete(currentRoom);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`marina-bay-racer server listening on http://localhost:${PORT}`);
});
