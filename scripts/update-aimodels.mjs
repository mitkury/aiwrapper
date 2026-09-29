import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Accept only upstream main, a stable version tag, or an exact commit.
export function catalogRef(input = 'main') {
  if (input === 'main') return 'refs/remotes/origin/main';
  if (/^v?\d+\.\d+\.\d+$/.test(input)) return `refs/tags/v${input.replace(/^v/, '')}`;
  if (/^[a-f0-9]{40}$/.test(input)) return input;
  throw new Error('Catalog ref must be main, a stable version such as v0.7.0, or a full commit SHA');
}

export function updateCatalog(root, input = 'main') {
  const ref = catalogRef(input);
  const cwd = resolve(root, 'aimodels');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const ancestor = (before, after) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', before, after], { cwd });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error('Cannot compare catalog history');
    return result.status === 0;
  };
  if (git('status', '--porcelain')) throw new Error('Commit or stash local AIModels edits before updating');
  git('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '--tags');
  const current = git('rev-parse', 'HEAD');
  const target = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (!ancestor(target, 'refs/remotes/origin/main')) {
    throw new Error('The requested catalog revision is not on upstream main');
  }
  // Repeated and out-of-order notifications must not release or roll back a catalog.
  if (ancestor(target, current)) return { changed: false, revision: current };
  if (!ancestor(current, target)) throw new Error('Catalog histories diverged; update the submodule manually');
  const relevant = git('diff', '--name-only', current, target, '--',
    'data', 'js/src', 'js/genDataFile.js', 'js/tsup.config.js', 'js/tsconfig.json',
    'js/package.json', 'js/package-lock.json', 'LICENSE');
  if (!relevant) return { changed: false, revision: current };
  git('checkout', '--detach', target);
  return { changed: true, revision: target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = updateCatalog(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
  console.log(result.changed ? `Updated catalog to ${result.revision}` : `Catalog unchanged at ${result.revision}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\nrevision=${result.revision}\n`);
  }
}
