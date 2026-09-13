import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
await mkdir('dist/client', { recursive: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await cp('public', 'dist/client', { recursive: true });
for (const [from, to] of [
  ['three/build', 'three'], ['three/examples/jsm', 'three/examples/jsm'],
  ['@dimforge/rapier3d-compat/dist', 'rapier'],
]) await cp(resolve('node_modules', from), resolve('dist/client/vendor', to), { recursive: true });
await mkdir('dist/client/socket.io', { recursive: true });
await cp('node_modules/socket.io/client-dist/socket.io.js', 'dist/client/socket.io/socket.io.js');
await writeFile('dist/client/hosting-config.js', 'window.__HOSTED_GAME__ = true;\n');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await build({ entryPoints: ['hosting/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js' });
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (!manifest.project_id || manifest.d1 !== 'DB') throw new Error('Sites registration and DB binding are required.');
console.log('Built Marina Bay Racer for Sites: browser assets, Worker, and database migrations.');
