import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'aiwrapper-package-'));

try {
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', temporary,
  ], { cwd: root, encoding: 'utf8' }))[0];
  for (const path of ['dist/aimodels/index.js', 'dist/aimodels/index.d.ts', 'dist/aimodels/LICENSE']) {
    assert(packed.files.some(file => file.path === path), `Missing packed catalog file: ${path}`);
  }
  assert(!packed.files.some(file => file.path.startsWith('aimodels/')), 'Submodule source must stay out of the package');
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // This consumer has neither a submodule nor a separately installed aimodels package.
  execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], {
    cwd: temporary, stdio: 'inherit',
  });
  const installed = JSON.parse(readFileSync(join(temporary, 'package-lock.json'), 'utf8'));
  assert(!installed.packages['node_modules/aimodels'], 'AIWrapper must not fetch aimodels from npm');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Lang, models, Model } from 'aiwrapper';
    import { SpeechToText } from 'aiwrapper/speech';
    assert(models.length > 0);
    assert(models[0] instanceof Model);
    assert.equal(typeof Lang.openai, 'function');
    assert.equal(typeof SpeechToText.openai, 'function');
  `], { cwd: temporary, stdio: 'inherit' });
  writeFileSync(join(temporary, 'consumer.ts'), `
    import { models, type Model, Lang } from 'aiwrapper';
    const model: Model | undefined = models.id('gpt-6-astra');
    Lang.openai({ apiKey: 'test', model: model?.id });
  `);
  execFileSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`,
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts',
  ], { cwd: temporary, stdio: 'inherit' });
  console.log(`Verified ${packed.filename}: standalone catalog, runtime imports, and TypeScript consumer.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
