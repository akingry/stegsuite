const { app, BrowserWindow, dialog } = require('electron');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');
const helperPort = Number(process.env.STEGSUITE_SAVE_PORT || 43123);
const helperUrl = `http://127.0.0.1:${helperPort}`;
const staticPort = Number(process.env.STEGSUITE_APP_PORT || 18400);

let mainWindow = null;
let staticServer = null;
let helperProcess = null;
let ownsHelper = false;

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ping(urlPath = '/health') {
  return new Promise((resolve, reject) => {
    const req = http.get(`${helperUrl}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('timeout')));
  });
}

async function ensureHelper() {
  try {
    await ping('/health');
    return;
  } catch {}

  // process.execPath is the Electron binary, not Node.js — use system node
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  helperProcess = spawn(nodeExe, ['tools/local-save-helper.mjs'], {
    cwd: projectRoot,
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      STEGSUITE_SAVE_PORT: String(helperPort),
    },
  });
  ownsHelper = true;

  helperProcess.stdout.on('data', (chunk) => console.log(`[save-helper] ${String(chunk).trim()}`));
  helperProcess.stderr.on('data', (chunk) => console.error(`[save-helper] ${String(chunk).trim()}`));
  helperProcess.on('exit', (code) => {
    if (!app.isQuitting) console.error(`StegSuite save helper exited with code ${code}`);
    helperProcess = null;
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await ping('/health');
      return;
    } catch {
      if (helperProcess && helperProcess.exitCode !== null) break;
      await wait(250);
    }
  }

  throw new Error('Timed out waiting for the local save helper to start.');
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const pathname = decoded === '/' ? '/app/' : decoded;
  const candidate = path.normalize(path.join(root, pathname));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

function createStaticServer() {
  return http.createServer(async (req, res) => {
    try {
      const resolved = safeJoin(projectRoot, new URL(req.url, `http://127.0.0.1:${staticPort}`).pathname);
      if (!resolved) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      let filePath = resolved;
      const stat = await fsp.stat(filePath).catch(() => null);
      if (stat?.isDirectory()) filePath = path.join(filePath, 'index.html');
      const finalStat = await fsp.stat(filePath).catch(() => null);
      if (!finalStat?.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(error.message || String(error));
    }
  });
}

async function ensureStaticServer() {
  if (staticServer) return;
  staticServer = createStaticServer();
  await new Promise((resolve, reject) => {
    staticServer.once('error', reject);
    staticServer.listen(staticPort, '127.0.0.1', () => resolve());
  });
}

async function createMainWindow() {
  await ensureHelper();
  await ensureStaticServer();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    title: 'StegSuite',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${staticPort}/app/`);
}

async function shutdownChildren() {
  if (staticServer) {
    await new Promise((resolve) => staticServer.close(() => resolve()));
    staticServer = null;
  }
  if (helperProcess && ownsHelper && helperProcess.exitCode === null) {
    helperProcess.kill();
  }
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.whenReady().then(createMainWindow).catch(async (error) => {
  console.error(error);
  await dialog.showMessageBox({
    type: 'error',
    title: 'StegSuite failed to start',
    message: error.message || String(error),
  });
  await shutdownChildren();
  app.quit();
});

app.on('window-all-closed', async () => {
  await shutdownChildren();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
