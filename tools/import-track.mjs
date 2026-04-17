import fs from 'node:fs/promises';
import path from 'node:path';

console.log('StegSuite import-track helper');
console.log('For the first working version, use app/index.html and the "Choose library folder" + "Generate and save" flow.');
console.log('This script is the practical extension point for a future fully automated CLI import path.');
console.log(`Workspace: ${path.resolve('.')}`);
console.log(`Metadata dir exists: ${await fs.access(path.join('library', 'metadata')).then(() => 'yes').catch(() => 'no')}`);
