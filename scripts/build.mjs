import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = `${root}aimodels/js`;
const generated = `${root}src/aimodels`;
const catalogOnly = process.argv.includes('--catalog-only');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(`${catalog}/package.json`)) {
  throw new Error('Initialize the catalog first: git submodule update --init --recursive');
}

// Reinstall only when the submodule's locked build dependencies change.
const lockHash = createHash('sha256').update(readFileSync(`${catalog}/package-lock.json`)).digest('hex');
const installedHash = `${catalog}/node_modules/.aiwrapper-lock-hash`;
if (!existsSync(installedHash) || readFileSync(installedHash, 'utf8') !== lockHash) {
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], catalog);
  writeFileSync(installedHash, lockHash);
}

// The upstream build validates the canonical JSON and runs its deterministic tests.
run('npm', ['run', 'build'], catalog);
rmSync(generated, { recursive: true, force: true });
mkdirSync(generated, { recursive: true });
cpSync(`${catalog}/dist`, generated, { recursive: true });
cpSync(`${root}aimodels/LICENSE`, `${generated}/LICENSE`);

if (!catalogOnly) {
  rmSync(`${root}dist`, { recursive: true, force: true });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.json']);
  // tsc resolves the generated declarations; the upstream ESM bundle is copied intact.
  cpSync(generated, `${root}dist/aimodels`, { recursive: true });
}
