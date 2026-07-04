import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (e.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(root, '..');
  const src = path.join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  const dest = path.join(projectRoot, 'public', 'basis');
  try {
    await copyDir(src, dest);
    console.log('Copied basis transcoder files to', dest);
  } catch (err) {
    console.warn('Could not copy basis files (they may not exist):', err.message);
  }
}

if (process.argv[1].endsWith('copy-basis.mjs')) main();
