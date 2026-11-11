import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const candidates = [
  'gh-token.txt',
  '.gh-token',
  'token.txt',
  'pat.txt',
  'github-token.txt',
  '.github-token',
];

const found = candidates.map((f) => join(cwd, f)).find((p) => existsSync(p));

if (!found) {
  console.log('NO_TOKEN_FILE');
  console.log('looked for: ' + candidates.join(', '));
  process.exit(0);
}

const token = readFileSync(found, 'utf8').trim();
if (!token) {
  console.log('TOKEN_FILE_EMPTY: ' + found);
  process.exit(0);
}

console.log(`token file: ${found}`);
console.log(`token length: ${token.length}`);
console.log(`token prefix: ${token.slice(0, 4)}...`);

// Push using an ephemeral credential, never written to git config.
const url = `https://x-access-token:${token}@github.com/sargioadeam9/sharkmart.git`;

const push = spawnSync('git', ['push', url, 'main:main'], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});

// Redact the token from any output before printing.
const redact = (s) => (s || '').split(token).join('<TOKEN>');

console.log('\n--- push stdout ---');
console.log(redact(push.stdout).trim() || '(empty)');
console.log('--- push stderr ---');
console.log(redact(push.stderr).trim() || '(empty)');
console.log(`--- exit: ${push.status} ---`);

if (push.status === 0) {
  unlinkSync(found);
  console.log(`\ndeleted ${found} after a successful push`);
}
