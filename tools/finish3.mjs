import { spawnSync } from 'node:child_process';

const run = (args) => {
  const r = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

// Stage every remaining untracked helper, including this file, then fold them
// into the existing tools commit so the tree ends clean.
run(['add', '-A', '--', 'tools/']);
run(['commit', '--amend', '--no-edit']);

const status = run(['status', '--porcelain']).trim();
console.log('status:', status ? JSON.stringify(status) : '(clean)');
console.log('tracked:', run(['ls-files']).trim().split('\n').length);
console.log('branch:', run(['rev-parse', '--abbrev-ref', 'HEAD']).trim());
console.log('\n=== log ===');
console.log(run(['log', '--format=%h %s']).trim());
