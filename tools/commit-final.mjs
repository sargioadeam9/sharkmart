import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const cwd = process.cwd();
const run = (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

writeFileSync(
  '.msg7.txt',
  `chore(tools): add the single-file commit helper

Used to make the last commit after the shell kept appending an unsupported
--trailer flag to "git add". Kept because it is the reliable way to commit from
this environment.
`,
  'utf8',
);

run(['add', '--', 'tools/commit-last.mjs']);
run(['commit', '-F', '.msg7.txt']);
unlinkSync('.msg7.txt');

console.log('status:', JSON.stringify(run(['status', '--porcelain']).trim()) || '(clean)');
console.log('\n=== log ===');
console.log(run(['log', '--oneline', '--format=%h %s']).trim());
