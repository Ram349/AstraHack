// Local-only recording server. Does not modify or deploy the game build.
// Run: node scripts/record-demo.mjs, then open http://localhost:3040.
import express from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.demo-capture');
await mkdir(output, { recursive: true });
const app = express();
app.get('/main.js', async (_req, res) => {
  let source = await readFile(path.join(root, 'public/main.js'), 'utf8');
  const recorder = await readFile(path.join(root, 'scripts/demo-capture.js'), 'utf8');
  source = source.replace('function animate() {', recorder + '\nfunction animate() {');
  source = source.replace('  updatePresentation(dt);', '  demoBeforeFrame();\n  updatePresentation(dt);');
  source = source.replace('  renderer.render(scene, camera);', '  renderer.render(scene, camera);\n  demoAfterFrame();');
  res.type('js').send(source);
});
app.get('/socket.io/socket.io.js', (_req, res) => res.type('js').send('window.io=()=>({connected:false,on(){},emit(){}});'));
app.post('/capture', express.raw({ type: '*/*', limit: '150mb' }), async (req, res) => {
  if (req.get('origin') !== 'http://localhost:3040') return res.sendStatus(403);
  await writeFile(path.join(output, 'gameplay.webm'), req.body);
  console.log('Capture saved:', req.body.length, 'bytes');
  res.json({ saved: true });
});
app.use(express.static(path.join(root, 'public')));
app.use('/vendor/three/examples/jsm', express.static(path.join(root, 'node_modules/three/examples/jsm')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three/build')));
app.use('/vendor/rapier', express.static(path.join(root, 'node_modules/@dimforge/rapier3d-compat/dist')));
app.listen(3040, '127.0.0.1', () => console.log('Demo recorder: http://localhost:3040 (local only)'));
