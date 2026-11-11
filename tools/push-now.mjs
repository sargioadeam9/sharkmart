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

run(['add', '--', 'tools/merge-remote.mjs']);
run(['commit', '-m', 'chore(tools): add the remote-merge helper']);

console.log('head:', run(['rev-parse', '--short', 'HEAD']).out);
console.log('status:', run(['status', '--porcelain']).out || '(clean)');

console.log('\n=== push attempt ===');
const push = run(['push', '-u', 'origin', 'main'], true);
console.log('exit:', push.status);
if (push.out) console.log(push.out);
if (push.err) console.log(push.err);
