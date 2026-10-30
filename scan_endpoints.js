const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) results = results.concat(walk(file));
      else if (file.endsWith('.java')) results.push(file);
    });
  } catch (e) {}
  return results;
}

const files = walk('sources');
const endpoints = new Set();
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.matchAll(/@(xs1|lf3)\("([^"]+)"\)/g);
  for (const m of matches) {
    endpoints.add((m[1] === 'xs1' ? 'GET ' : 'POST ') + m[2]);
  }
}

console.log('Endpoints found in sources:');
Array.from(endpoints).sort().forEach(e => console.log(' - ' + e));
