import { spawnSync } from 'node:child_process';

const run = (args) => {
  const r = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

run(['add', '--', 'tools/commit-final.mjs']);
run(['commit', '--amend', '--no-edit']);

console.log('status:', JSON.stringify(run(['status', '--porcelain']).trim()) || '(clean)');
console.log('tracked:', run(['ls-files']).trim().split('\n').length);
console.log('\n=== log ===');
console.log(run(['log', '--oneline', '--format=%h %s']).trim());
