// Folds local scripts and stylesheets into the page, so the film becomes one self-contained HTML
// (for publishing, sharing, GitHub Pages). CDN links (http, https, //) are left as they are.
// Usage: node runtime/inline.mjs film.html [out.html]      default out: film.inline.html
import fs from 'node:fs';
import path from 'node:path';

const [input, outArg] = process.argv.slice(2);
if (!input) { console.error('usage: node runtime/inline.mjs <film.html> [out.html]'); process.exit(1); }
const dir = path.dirname(path.resolve(input));
const out = outArg || input.replace(/\.html?$/i, '') + '.inline.html';
const remote = src => /^(https?:)?\/\//i.test(src) || src.startsWith('data:');
const read = src => {
  const file = path.resolve(dir, src.split(/[?#]/)[0]);
  if (!fs.existsSync(file)) { console.error(`missing: ${src} (${file})`); process.exit(1); }
  return fs.readFileSync(file, 'utf8');
};
let n = 0;
let html = fs.readFileSync(input, 'utf8');
html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, src, b) => {
  if (remote(src)) return m;
  n++;
  const attrs = (a + b).replace(/\s+/g, ' ').trim();
  return `<script${attrs ? ' ' + attrs : ''}>\n/* inlined: ${src} */\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`;
});
html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, m => {
  const href = /\bhref=["']([^"']+)["']/i.exec(m)?.[1];
  if (!href || remote(href)) return m;
  n++;
  return `<style>\n/* inlined: ${href} */\n${read(href)}\n</style>`;
});
fs.writeFileSync(out, html);
console.log(`${out}: ${n} file(s) inlined, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
