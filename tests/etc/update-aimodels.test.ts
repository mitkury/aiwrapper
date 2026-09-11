import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogRef, updateCatalog } from '../../scripts/update-aimodels.mjs';

describe('catalog update automation', () => {
  let root: string;
  let upstream: string;
  let checkout: string;
  let original: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (cwd: string, path: string, content: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
    git(cwd, 'add', path);
    git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Update fixture');
    return git(cwd, 'rev-parse', 'HEAD');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aiwrapper-catalog-update-'));
    upstream = join(root, 'upstream');
    checkout = join(root, 'aimodels');
    mkdirSync(upstream);
    git(upstream, 'init', '--initial-branch=main');
    original = commit(upstream, 'data/catalog.json', '{"models": []}');
    git(root, 'clone', upstream, checkout);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('advances to upstream catalog changes and is idempotent', () => {
    const revision = commit(upstream, 'data/catalog.json', '{"models": ["new"]}');
    expect(updateCatalog(root)).toEqual({ changed: true, revision });
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(revision);
    expect(updateCatalog(root)).toEqual({ changed: false, revision });
  });

  it('does not release documentation-only changes', () => {
    commit(upstream, 'README.md', 'Documentation update');
    expect(updateCatalog(root)).toEqual({ changed: false, revision: original });
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(original);
  });

  it('includes runtime changes even when catalog data is unchanged', () => {
    const revision = commit(upstream, 'js/src/index.ts', 'export const models = [];');
    expect(updateCatalog(root)).toEqual({ changed: true, revision });
  });

  it('preserves local uncommitted edits', () => {
    writeFileSync(join(checkout, 'data/catalog.json'), 'local work');
    commit(upstream, 'data/catalog.json', 'upstream work');
    expect(() => updateCatalog(root)).toThrow('Commit or stash');
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(original);
  });

  it('does not roll back when an older notification arrives', () => {
    git(upstream, 'tag', 'v0.7.0');
    const revision = commit(upstream, 'data/catalog.json', 'new catalog');
    updateCatalog(root);
    expect(updateCatalog(root, 'v0.7.0')).toEqual({ changed: false, revision });
    expect(updateCatalog(root, original)).toEqual({ changed: false, revision });
  });

  it('stops on divergent local commits', () => {
    commit(checkout, 'data/catalog.json', 'local commit');
    commit(upstream, 'data/catalog.json', 'upstream commit');
    expect(() => updateCatalog(root)).toThrow('histories diverged');
  });

  it('rejects tags that are not on upstream main', () => {
    git(upstream, 'checkout', '-b', 'experimental');
    commit(upstream, 'data/catalog.json', 'experimental catalog');
    git(upstream, 'tag', 'v9.0.0');
    git(upstream, 'checkout', 'main');
    expect(() => updateCatalog(root, 'v9.0.0')).toThrow('not on upstream main');
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(original);
  });

  it('accepts exact commits on upstream main', () => {
    const revision = commit(upstream, 'data/catalog.json', 'new catalog');
    expect(updateCatalog(root, revision)).toEqual({ changed: true, revision });
  });

  it('rejects ref expressions, options, and prereleases before touching git', () => {
    for (const input of ['--upload-pack=command', 'main~1', 'v0.8.0-beta.1', 'main\nchanged=true']) {
      expect(() => catalogRef(input)).toThrow('Catalog ref must be');
    }
  });
});
