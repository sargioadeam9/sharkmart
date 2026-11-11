import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const run = (args, allowFail = false) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
};

run(['add', '-A', '--', 'tools/']);
run(['commit', '--amend', '--no-edit']);

console.log('head:', run(['rev-parse', '--short', 'HEAD']).out);
console.log('status:', run(['status', '--porcelain']).out || '(clean)');
console.log('commits:', run(['rev-list', '--count', 'HEAD']).out);
console.log('tracked:', run(['ls-files']).out.split('\n').length);
console.log('\n=== unpushed commits ===');
console.log(run(['log', '--oneline', 'origin/main..HEAD']).out);
