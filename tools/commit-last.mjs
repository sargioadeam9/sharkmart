import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

const cwd = process.cwd();
const run = (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

if (existsSync('.msg6.txt')) unlinkSync('.msg6.txt');

const msg = `chore(tools): add the phase commit script

Records the exact path list used to split this session into one commit per
phase, so the split is reproducible rather than reconstructed from memory.
`;
writeFileSync('.msg6.txt', msg, 'utf8');

run(['add', '--', 'tools/commit-phases.mjs']);
run(['commit', '-F', '.msg6.txt']);
unlinkSync('.msg6.txt');

console.log('status:', JSON.stringify(run(['status', '--porcelain']).trim()));
console.log('tracked:', run(['ls-files']).trim().split('\n').length);
