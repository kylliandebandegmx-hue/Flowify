import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');

const aliases = {
  'index.js': [
    'index-CdAedjhZ.js',
    'index-CFFD0rdp.js',
    'index-CFWzOOjG.js',
  ],
  'index.css': [
    'index-ChFsEs08.css',
    'index-C3svhTYz.css',
  ],
};

await mkdir(assetsDir, { recursive: true });

for (const [source, targets] of Object.entries(aliases)) {
  const sourcePath = path.join(assetsDir, source);
  for (const target of targets) {
    await copyFile(sourcePath, path.join(assetsDir, target));
  }
}
