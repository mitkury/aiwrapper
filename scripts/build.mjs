import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

rmSync(`${root}dist`, { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.json'], {
  cwd: root, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// tsc resolves the committed catalog declarations; its ESM bundle is copied intact.
cpSync(`${root}src/aimodels`, `${root}dist/aimodels`, { recursive: true });
