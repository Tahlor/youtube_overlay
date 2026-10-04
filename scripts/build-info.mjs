import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* packaged build */ }
const assets = [...readFileSync('dist/index.html', 'utf8').matchAll(/(?:src|href)="([^"]+\/assets\/[^\"]+)"/g)].map(match => match[1]);
writeFileSync('dist/build.json', JSON.stringify({ commit, builtAt: new Date().toISOString(), assets, htmlSha256: createHash('sha256').update(readFileSync('dist/index.html')).digest('hex') }, null, 2) + '\n');
