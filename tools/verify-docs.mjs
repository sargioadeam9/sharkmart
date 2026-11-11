import { readFileSync } from 'node:fs';

for (const path of ['HANDOFF.md', 'STATUS.md']) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    console.log(`${path}: MISSING`);
    continue;
  }
  const text = buf.toString('utf8');
  const roundTrip = Buffer.from(text, 'utf8').equals(buf);
  const hasBOM = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const hasReplacement = text.includes('\uFFFD');
  const lines = text.split(/\r?\n/);
  const headings = lines.filter((l) => /^#{1,3}\s/.test(l)).length;
  const qmarks = lines.filter((l) => /\?\?/.test(l));

  console.log(`=== ${path} ===`);
  console.log(`bytes=${buf.length} lines=${lines.length} headings=${headings}`);
  console.log(`utf8 round-trip=${roundTrip} BOM=${hasBOM} U+FFFD=${hasReplacement}`);
  console.log(`"??" lines=${qmarks.length}`);
  qmarks.slice(0, 5).forEach((l) => console.log(`   ${l.slice(0, 120)}`));
  console.log(`non-ascii count=${[...text].filter((c) => c.codePointAt(0) > 127).length}`);
}
