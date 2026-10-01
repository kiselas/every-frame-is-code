// Start a new short from a genre template: a spec.json with the structure of the genre's requirement card (20-silent-social.md) and a voice.txt skeleton.
// Usage: node new.mjs <id> --genre <genre> [--lang ru] [--dir videos]     creates <dir>/<id>/spec.json and voice.txt (never overwrites)
//        node new.mjs --genres                                           lists the genres with their promise and length
// Languages: ru (ru-RU-DmitryNeural) and en (en-US-GuyNeural) with Oswald + IBM Plex Mono; for any other language set voice.voice and the fonts yourself.
// Then: fill in facts, voice.txt, the shots (every TODO), and run  node render/lint-spec.mjs <dir>/<id>/spec.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENRES, formatJson, scaffoldSpec } from './spec-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), templates = path.join(here, 'templates', 'genres');
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };

const listGenres = () => GENRES.map(g => `  ${g.name.padEnd(14)} ${(g.length[0] + '-' + g.length[1] + ' s').padEnd(8)} ${g.promise}`).join('\n');
const USAGE = 'usage: node new.mjs <id> --genre <genre> [--lang ru] [--dir videos]\n       node new.mjs --genres';

if (flag('--genres')) { console.log('genre          length   the promise to the viewer\n' + listGenres()); process.exit(0); }
const genre = opt('--genre', null), lang = opt('--lang', 'ru'), dir = opt('--dir', 'videos'), [id] = args;
if (!id || id.startsWith('--') || !genre) {
  console.error(USAGE + '\n\ngenres:\n' + listGenres());
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(id)) { console.error(`the id "${id}" must be [a-z0-9-]+ (it names the folder and the output)`); process.exit(1); }
if (!GENRES.some(g => g.name === genre)) { console.error(`unknown genre "${genre}". The genres:\n${listGenres()}`); process.exit(1); }

const template = JSON.parse(fs.readFileSync(path.join(templates, genre + '.json'), 'utf8'));
const { spec, notes } = scaffoldSpec(template, { id, lang });
const target = path.resolve(dir, id), specFile = path.join(target, 'spec.json'), voiceFile = path.join(target, spec.voice ? (spec.voice.file || 'voice.txt') : 'voice.txt');
const voiceSkeleton = path.join(templates, genre + '.voice.txt');
const clash = [specFile, ...(spec.voice ? [voiceFile] : [])].filter(f => fs.existsSync(f));
if (clash.length) { console.error(`refusing to overwrite: ${clash.join(', ')} exist${clash.length > 1 ? '' : 's'}. Pick another id or --dir.`); process.exit(1); }

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(specFile, formatJson(spec) + '\n');
if (spec.voice) fs.writeFileSync(voiceFile, fs.existsSync(voiceSkeleton) ? fs.readFileSync(voiceSkeleton, 'utf8') : '');
console.log(`created ${path.relative(process.cwd(), specFile) || specFile}${spec.voice ? ' and ' + path.basename(voiceFile) : ' (a silent film: no voice.txt)'}  [${genre}, ${spec.shots.length} shots]`);
for (const n of notes) console.log('note: ' + n);
console.log(`next: fill in "facts" first (every claim with its source), then ${spec.voice ? 'voice.txt (one paragraph per phrase), then ' : ''}the shots; replace every TODO.\n      node render/lint-spec.mjs ${path.relative(process.cwd(), specFile) || specFile}`);
