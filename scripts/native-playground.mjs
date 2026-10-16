import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('exit', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  });
}
await run('cargo', ['build', '--locked', '-p', 'aiwrapper', '--example', 'sandbox']);
await run('npm', ['--prefix', 'playground', 'run', 'dev', '--', ...process.argv.slice(2)], {
  ...process.env,
  AIWRAPPER_RUNTIME: 'rust',
  AIWRAPPER_NATIVE_BINARY: fileURLToPath(new URL('../target/debug/examples/' + (process.platform === 'win32' ? 'sandbox.exe' : 'sandbox'), import.meta.url))
});
