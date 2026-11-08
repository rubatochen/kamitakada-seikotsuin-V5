import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
for (const path of ['site/admin.html','site/reserve.html','site/manage.html','site/index.html']) {
 const html = readFileSync(path,'utf8');
 const blocks=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
 let js=0, json=0;
 for (const [i, m] of blocks.entries()) {
  if (/type=["']application\/ld\+json["']/.test(m[1])) { JSON.parse(m[2]); json++; }
  else { new Script(m[2],{filename:`${path}#${i}`}); js++; }
 }
 console.log(`PASS: ${path} ${js} script blocks parsed${json?`, ${json} JSON-LD block(s) valid`:''}`);
}
