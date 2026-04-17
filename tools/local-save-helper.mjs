import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const libraryRoot = path.join(projectRoot, 'library');
const metadataDir = path.join(libraryRoot, 'metadata');
const port = Number(process.env.STEGSUITE_SAVE_PORT || 43123);
const host = process.env.STEGSUITE_HOST || '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, statusCode, payload, origin = '') {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function safeJoin(root, relativePath) {
  const candidate = path.resolve(root, `.${path.sep}${relativePath}`);
  if (candidate === root || isWithin(root, candidate)) return candidate;
  return null;
}

async function ensureLibraryDirs() {
  await Promise.all([
    mkdir(path.join(libraryRoot, 'mp3'), { recursive: true }),
    mkdir(path.join(libraryRoot, 'images'), { recursive: true }),
    mkdir(path.join(libraryRoot, 'stegmp3'), { recursive: true }),
    mkdir(metadataDir, { recursive: true }),
    mkdir(path.join(libraryRoot, 'playlists'), { recursive: true }),
  ]);
}

function toBuffer(base64, label) {
  if (typeof base64 !== 'string' || !base64.trim()) throw new Error(`Missing ${label} payload.`);
  return Buffer.from(base64, 'base64');
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

async function readLibraryIndex() {
  await ensureLibraryDirs();
  return readJsonFile(path.join(metadataDir, 'index.json'), []);
}

async function readPlaylistsIndex() {
  await ensureLibraryDirs();
  return readJsonFile(path.join(libraryRoot, 'playlists', 'index.json'), []);
}

async function rebuildIndex() {
  const entries = await readdir(metadataDir);
  const tracks = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'index.json') continue;
    const fullPath = path.join(metadataDir, entry);
    const parsed = JSON.parse((await readFile(fullPath, 'utf8')).replace(/^\uFEFF/, ''));
    tracks.push(parsed);
  }
  tracks.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
  const indexPath = path.join(metadataDir, 'index.json');
  await writeFile(indexPath, `${JSON.stringify(tracks, null, 2)}\n`, 'utf8');
  return tracks;
}

function publicTrack(track) {
  const id = track?.id;
  return {
    ...track,
    artworkUrl: id ? `/api/artwork/${encodeURIComponent(id)}` : null,
    stegUrl: id ? `/api/steg/${encodeURIComponent(id)}` : null,
    metadataUrl: id ? `/api/tracks/${encodeURIComponent(id)}` : null,
    downloadUrl: id ? `/api/steg/${encodeURIComponent(id)}?download=1` : null,
  };
}

async function handleSave(payload) {
  const { id, record, files } = payload || {};
  if (!id || typeof id !== 'string') throw new Error('Missing track id.');
  if (!record || typeof record !== 'object') throw new Error('Missing metadata record.');
  if (!files || typeof files !== 'object') throw new Error('Missing file payloads.');

  await ensureLibraryDirs();

  const outputs = [
    { relativePath: path.join('mp3', `${id}.mp3`), data: toBuffer(files.mp3Base64, 'mp3') },
    { relativePath: path.join('images', `${id}.png`), data: toBuffer(files.imageBase64, 'image') },
    { relativePath: path.join('stegmp3', `${id}.steg.png`), data: toBuffer(files.stegBase64, 'steg image') },
    { relativePath: path.join('metadata', `${id}.json`), data: Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8') },
  ];

  await Promise.all(outputs.map(async ({ relativePath, data }) => {
    const destination = path.join(libraryRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }));

  const tracks = await rebuildIndex();
  return {
    ok: true,
    id,
    saved: outputs.map(({ relativePath, data }) => ({ relativePath: `library/${normalizeSlashes(relativePath)}`, bytes: data.length })),
    trackCount: tracks.length,
  };
}

async function handleDelete(payload) {
  const { id, deleteFile } = payload || {};
  if (!id || typeof id !== 'string') throw new Error('Missing track id.');

  await ensureLibraryDirs();

  await rm(path.join(metadataDir, `${id}.json`), { force: true }).catch(() => {});

  let deletedStegFile = false;
  if (deleteFile) {
    await rm(path.join(libraryRoot, 'stegmp3', `${id}.steg.png`), { force: true }).catch(() => {});
    deletedStegFile = true;
  }

  const tracks = await rebuildIndex();
  return { ok: true, id, deletedStegFile, trackCount: tracks.length };
}

async function streamFile(res, filePath, req, extraHeaders = {}) {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return;
  }

  const headers = {
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': String(fileStat.size),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    ...extraHeaders,
  };
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

async function resolveArtworkPath(track) {
  const candidates = [track?.imageFile, track?.stegFile].filter(Boolean);
  for (const relative of candidates) {
    const filePath = safeJoin(projectRoot, normalizeSlashes(relative));
    if (!filePath) continue;
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isFile()) return filePath;
  }
  return null;
}

async function handleApiGet(url, req, res) {
  const pathname = url.pathname;
  const library = await readLibraryIndex();

  if (pathname === '/health' || pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      projectRoot,
      libraryRoot,
      remotePlayerUrl: '/remote-player/',
      trackCount: library.length,
    }, req.headers.origin || '');
    return true;
  }

  if (pathname === '/api/library') {
    sendJson(res, 200, { ok: true, tracks: library.map(publicTrack), count: library.length }, req.headers.origin || '');
    return true;
  }

  if (pathname === '/api/playlists') {
    const playlists = await readPlaylistsIndex();
    sendJson(res, 200, { ok: true, playlists }, req.headers.origin || '');
    return true;
  }

  if (pathname.startsWith('/api/tracks/')) {
    const id = decodeURIComponent(pathname.slice('/api/tracks/'.length));
    const track = library.find((item) => item.id === id);
    if (!track) {
      sendJson(res, 404, { ok: false, error: 'Track not found.' }, req.headers.origin || '');
      return true;
    }
    sendJson(res, 200, { ok: true, track: publicTrack(track) }, req.headers.origin || '');
    return true;
  }

  if (pathname.startsWith('/api/steg/')) {
    const id = decodeURIComponent(pathname.slice('/api/steg/'.length));
    const track = library.find((item) => item.id === id);
    if (!track) {
      sendJson(res, 404, { ok: false, error: 'Track not found.' }, req.headers.origin || '');
      return true;
    }
    const filePath = safeJoin(projectRoot, normalizeSlashes(track.stegFile));
    if (!filePath) {
      sendJson(res, 403, { ok: false, error: 'Forbidden.' }, req.headers.origin || '');
      return true;
    }
    const wantsDownload = url.searchParams.get('download') === '1';
    await streamFile(res, filePath, req, wantsDownload ? {
      'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
    } : {});
    return true;
  }

  if (pathname.startsWith('/api/artwork/')) {
    const id = decodeURIComponent(pathname.slice('/api/artwork/'.length));
    const track = library.find((item) => item.id === id);
    if (!track) {
      sendJson(res, 404, { ok: false, error: 'Track not found.' }, req.headers.origin || '');
      return true;
    }
    const filePath = await resolveArtworkPath(track);
    if (!filePath) {
      sendJson(res, 404, { ok: false, error: 'Artwork not found.' }, req.headers.origin || '');
      return true;
    }
    await streamFile(res, filePath, req);
    return true;
  }

  if (pathname.startsWith('/library/')) {
    const filePath = safeJoin(libraryRoot, pathname.slice('/library/'.length));
    if (!filePath) {
      sendJson(res, 403, { ok: false, error: 'Forbidden.' }, req.headers.origin || '');
      return true;
    }
    await streamFile(res, filePath, req);
    return true;
  }

  return false;
}

async function handleStaticGet(url, req, res) {
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/remote-player/';

  const staticRoots = [
    { prefix: '/remote-player/', root: path.join(projectRoot, 'remote-player') },
    { prefix: '/app/', root: path.join(projectRoot, 'app') },
  ];

  for (const { prefix, root } of staticRoots) {
    if (!pathname.startsWith(prefix)) continue;
    const suffix = pathname.slice(prefix.length) || 'index.html';
    const filePath = safeJoin(root, suffix);
    if (!filePath) {
      sendText(res, 403, 'Forbidden');
      return true;
    }
    let finalPath = filePath;
    const fileStat = await stat(finalPath).catch(() => null);
    if (fileStat?.isDirectory()) finalPath = path.join(finalPath, 'index.html');
    const finalStat = await stat(finalPath).catch(() => null);
    if (!finalStat?.isFile()) {
      sendText(res, 404, 'Not found');
      return true;
    }
    await streamFile(res, finalPath, req);
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true }, origin);
    return;
  }

  try {
    if (req.method === 'GET') {
      if (await handleApiGet(url, req, res)) return;
      if (await handleStaticGet(url, req, res)) return;
      sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
      return;
    }

    if (req.method === 'POST' && req.url === '/start') {
      sendJson(res, 200, { ok: true, alreadyRunning: true, remotePlayerUrl: '/remote-player/' }, origin);
      return;
    }

    if (req.method !== 'POST' || !['/save-track', '/delete-track'].includes(req.url)) {
      sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const result = req.url === '/save-track' ? await handleSave(payload) : await handleDelete(payload);
    sendJson(res, 200, result, origin);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || String(error) }, origin);
  }
});

server.listen(port, host, () => {
  console.log(`StegSuite helper listening on http://${host}:${port}`);
});
