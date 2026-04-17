import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const metadataDir = path.join(root, 'library', 'metadata');
const indexPath = path.join(metadataDir, 'index.json');

const entries = (await fs.readdir(metadataDir))
  .filter((name) => name.endsWith('.json') && name !== 'index.json')
  .sort((a, b) => a.localeCompare(b));

const records = [];
for (const file of entries) {
  records.push(JSON.parse(await fs.readFile(path.join(metadataDir, file), 'utf8')));
}

await fs.writeFile(indexPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
console.log(`Synced ${records.length} record(s) to library/metadata/index.json`);
