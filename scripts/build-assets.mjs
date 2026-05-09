import { mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const assets = ['index.html', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'sw.js', 'firebase-messaging-sw.js'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const asset of assets) {
  await copyFile(resolve(root, asset), resolve(dist, asset));
}

console.log(`Copied ${assets.length} assets to ${dist}`);
