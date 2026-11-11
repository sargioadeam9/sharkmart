import { readFileSync } from 'node:fs';

const token = readFileSync('gh-token.txt', 'utf8').trim();

async function api(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'perch-push-check',
    },
  });
  const scopes = r.headers.get('x-oauth-scopes');
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, scopes, body };
}

const me = await api('/user');
console.log('=== identity ===');
console.log('status:', me.status);
console.log('login:', me.body?.login);
console.log('token type hint (x-oauth-scopes):', me.scopes ?? '(none — classic PAT scopes absent, likely fine-grained)');

const repo = await api('/repos/sargioadeam9/sharkmart');
console.log('\n=== repo access ===');
console.log('status:', repo.status);
if (repo.body) {
  console.log('full_name:', repo.body.full_name);
  console.log('private:', repo.body.private);
  console.log('permissions:', JSON.stringify(repo.body.permissions));
  console.log('default_branch:', repo.body.default_branch);
  if (repo.body.message) console.log('message:', repo.body.message);
}
