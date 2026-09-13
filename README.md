# Aunty F1 By The Bay

**[Play the public demo](https://marina-bay-racer.ram-d-pradhan.chatgpt.site)** · [GitHub](https://github.com/Ram349/AstraHack)

A Singapore racing prototype with a 3D Marina Bay environment, Rapier vehicle
physics, rear chase camera, aerial introduction, race countdown, live lap timer,
boost and Aunty Mei's driving reactions and Singapore stories.

Best on a desktop with a keyboard. Solo driving is public. Sign in with ChatGPT
to join online race rooms or use live voice, then allow microphone access.
WASD/arrow keys drive; Shift boosts; Space brakes; R restarts at the grid.

The live voice implementation uses **gpt-realtime-1.5**, voice **marin**, over
WebRTC. Astra was used through Codex for engineering iteration, browser
verification and deployment—not as the runtime voice model. Aunty receives
driving telemetry and curated landmark facts, not camera frames.

The real OpenAI key is excluded from Git and stored privately in Sites.
`npm start` runs the local game; `npm test` and `npm run test:hosting` run seven
checks. See [HOSTING.md](HOSTING.md) and [RACING_UPDATE.md](RACING_UPDATE.md)
for current architecture, controls and prototype limitations. Multiplayer is
casual snapshot-based play, and the physical floor/collision model is simplified.

This is an independent hackathon prototype, not an official Formula 1 product.
The environment is a supplied, credited asset, not an Astra-generated city.

## Original starter notes (historical)

The following section documents the starting point, not the current feature set.

A hackathon starter for a browser-based multiplayer racing game: Three.js on
the client, Node.js + Express + Socket.IO on the server, deployable to
Railway as a Node web service.

## What's here

- `server.js` — Express serves `public/`, plus a `/vendor/three` static route
  so the client can `import * as THREE from 'three'` (npm-installed, no CDN).
  Socket.IO handles room join/leave and relays player position/rotation
  updates to everyone else in the room.
- `public/index.html` + `public/main.js` — renders a ground plane and a red
  box (your car) driven with WASD / arrow keys, with a chase camera. Other
  players appear as blue boxes, smoothly interpolated between network
  updates.
- `railway.json` — tells Railway to build with Nixpacks and run `npm start`.

## Run locally

```bash
npm install
npm start
```

Open the printed local URL in two browser tabs to see two independently
controlled cars stay in sync.

## Deploy to Railway

```bash
railway login   # one-time, opens a browser
railway init
railway up
```

Railway auto-detects the Node app via `package.json` / `railway.json` and
sets `PORT` for you — no other config needed.

## Next steps for the hackathon

- Swap the boxes for real car models (Blender-authored, exported to glTF).
- Add lap timing, checkpoints, a track mesh instead of a flat plane.
- Add collision detection between cars.
- Support more than one room / lobby selection in the UI.

Built as a starting point — not production-hardened.

## Attribution

Marina Bay Street Circuit environment by Dave Love SketchFab (Sketchfab, CC-BY).
