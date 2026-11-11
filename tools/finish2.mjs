import { spawnSync } from 'node:child_process';

const run = (args) => {
  const r = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

run(['add', '--', 'tools/finish.mjs']);
run(['commit', '--amend', '--no-edit']);

const status = run(['status', '--porcelain']).trim();
console.log('status:', status ? JSON.stringify(status) : '(clean)');
console.log('tracked:', run(['ls-files']).trim().split('\n').length);
console.log('branch:', run(['rev-parse', '--abbrev-ref', 'HEAD']).trim());
console.log('\n=== log ===');
console.log(run(['log', '--format=%h %s']).trim());
console.log('\n=== per-commit file counts ===');
for (const line of run(['log', '--format=%h']).trim().split('\n')) {
  const n = run(['show', '--name-only', '--format=', line]).trim().split('\n').filter(Boolean).length;
  const s = run(['log', '-1', '--format=%s', line]).trim();
  console.log(`${line}  ${String(n).padStart(2)} files  ${s}`);
}
