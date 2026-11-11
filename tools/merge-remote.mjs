import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';

const cwd = process.cwd();
const run = (args, allowFail = false) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    console.error(`FAILED: git ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return { out: r.stdout || '', err: r.stderr || '', status: r.status };
};

console.log('before:', run(['rev-parse', '--short', 'HEAD']).out.trim());

const msg = `chore: merge the remote README into local history

The GitHub repo was created with an initial commit containing only README.md,
which shares no ancestry with this project's history. Merging it in with
--allow-unrelated-histories keeps that file instead of force-pushing over it,
and makes the eventual push a fast-forward rather than a rejection.
`;
writeFileSync('.merge-msg.txt', msg, 'utf8');

const merge = run(
  ['merge', 'origin/main', '--allow-unrelated-histories', '--no-edit', '-F', '.merge-msg.txt'],
  true,
);
unlinkSync('.merge-msg.txt');

console.log('merge status:', merge.status);
console.log(merge.out.trim());
if (merge.err.trim()) console.log('stderr:', merge.err.trim());

console.log('\nafter:', run(['rev-parse', '--short', 'HEAD']).out.trim());
console.log('status:', JSON.stringify(run(['status', '--porcelain']).trim()) || '(clean)');
console.log('\nREADME present:', existsSync('README.md'));
if (existsSync('README.md')) {
  console.log('README bytes:', readFileSync('README.md').length);
}
console.log('\n=== log ===');
console.log(run(['log', '--oneline', '--graph', '--format=%h %s']).out.trim());
