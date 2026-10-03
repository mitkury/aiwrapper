// npm is a .cmd batch file on Windows. Node only finds and runs those through a
// shell (CVE-2024-27980), so there the call becomes one quoted command line.
// Returns the arguments for spawnSync or execFileSync.
export function npm(args, options = {}) {
  if (process.platform !== 'win32') return ['npm', args, options];
  return [['npm.cmd', ...args.map(quote)].join(' '), [], { ...options, shell: true }];
}

function quote(argument) {
  return /[\s"&|<>^()]/.test(argument) ? `"${argument.replaceAll('"', '""')}"` : argument;
}
