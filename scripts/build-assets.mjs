import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const assets = ['index.html', 'styles.css', 'app.js', 'state.js', 'render.js', 'actions.js', 'storage.js', 'projects.js', 'daily.js', 'journal.js', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'sw.js', 'firebase-messaging-sw.js'];
const cacheVersion = process.env.FOCUS_HUB_CACHE_VERSION || process.env.CF_PAGES_COMMIT_SHA || `${Date.now()}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  await copyFile(resolve(root, asset), resolve(dist, asset));
}

const swPath = resolve(dist, 'sw.js');
const sw = await readFile(swPath, 'utf8');
await writeFile(swPath, sw.replace("const CACHE_VERSION = 'dev';", `const CACHE_VERSION = ${JSON.stringify(cacheVersion)};`));

console.log(`Copied ${assets.length} assets to ${dist} with cache version ${cacheVersion}`);
