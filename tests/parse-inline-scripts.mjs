import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
for (const path of ['site/admin.html','site/reserve.html','site/manage.html','site/index.html']) {
 const html = readFileSync(path,'utf8');
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 for (const [i, code] of scripts.entries()) new Script(code,{filename:`${path}#${i}`});
 console.log(`PASS: ${path} ${scripts.length} script blocks parsed`);
}
