import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const directories = ['client/src', 'server/src', 'shared'];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const nested: string[][] = await Promise.all(entries.map((entry) => {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.isFile() && entry.name.endsWith('.js') ? [child] : [];
  }));
  return nested.flat();
}

for (const directory of directories) {
  for (const file of await sourceFiles(directory)) {
    const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log('Syntax check passed.');
