// Control Tower as a macOS menu bar app: the same server, embedded, plus a tray item that shows
// how many sessions need you and opens the dashboard in a window.
const { app, Tray, Menu, BrowserWindow, nativeImage, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** GUI apps get a minimal PATH; borrow the login shell's so `claude` (and wezterm, tmux…) resolve. */
function fixPath() {
  if (process.platform === 'win32') return;
  try {
    const sh = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(sh, ['-ilc', 'echo "__PATH__$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.split('\n').find((l) => l.startsWith('__PATH__'));
    if (m) process.env.PATH = m.slice(8);
  } catch { /* keep what we have */ }
  for (const extra of [path.join(process.env.HOME || '', '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) if (!process.env.PATH.split(':').includes(extra)) process.env.PATH += ':' + extra;
}

const PORT = Number(process.env.PORT || 4747);
const BASE = `http://127.0.0.1:${PORT}`;
let tray, win, radar = null, snap = null;

const get = (p) => new Promise((resolve) => { http.get(BASE + p, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); }).on('error', () => resolve(null)); });
const post = (p, body) => new Promise((resolve) => { const req = http.request(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); }); req.on('error', resolve); req.end(body ? JSON.stringify(body) : undefined); });

async function ensureServer() {
  if (await get('/api/health')) return 'already running';
  const { startRadar } = await import('../server/start.mjs');
  radar = await startRadar({ port: PORT, onError: (e) => console.error('[tower]', e.message) });
  return 'embedded';
}

function subscribe() {
  const req = http.get(BASE + '/api/events', (res) => {
    let buf = '';
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const m = block.match(/^data: (.*)$/m);
        if (m) { try { onSnapshot(JSON.parse(m[1])); } catch { /* ignore */ } }
      }
    });
    res.on('end', () => setTimeout(subscribe, 2000));
  });
  req.on('error', () => setTimeout(subscribe, 2000));
}

function onSnapshot(s) {
  snap = s;
  const needs = s.unseen ?? s.attention.length;
  const working = s.sessions.filter((v) => v.state === 'working').length;
  const agents = s.sessions.reduce((n, v) => n + v.runningAgents, 0);
  tray.setTitle(needs ? ` ${needs} need${needs === 1 ? 's' : ''} you` : working ? ` ${working}${agents ? `+${agents}` : ''}` : '');
  tray.setToolTip(`Control Tower — ${s.sessions.filter((v) => v.alive).length} live sessions, ${needs} waiting for you`);
  tray.setContextMenu(buildMenu());
}

function buildMenu() {
  const items = [{ label: 'Open Control Tower', click: () => showWindow() }, { type: 'separator' }];
  if (snap?.attention.length) {
    for (const a of snap.attention) items.push({ label: `${a.seen ? '   ' : '●  '}${a.state === 'done' ? '✓' : '?'}  ${a.projectName}: ${a.title.slice(0, 60)}`, click: () => { post(`/api/session/${encodeURIComponent(a.sessionId)}/seen`); showWindow(`#session=${encodeURIComponent(a.sessionId)}`); } });
    items.push({ type: 'separator' });
  } else if (snap) {
    for (const v of snap.sessions.filter((x) => x.alive).slice(0, 8)) items.push({ label: `${v.state === 'working' ? '●' : '○'}  ${path.basename(v.cwd)}: ${v.title.slice(0, 60)}`, click: () => showWindow(`#session=${encodeURIComponent(v.id)}`) });
    items.push({ type: 'separator' });
  }
  const mode = snap?.summaries.mode ?? 'auto';
  items.push({ label: 'Summaries', submenu: ['auto', 'manual', 'off'].map((m) => ({ label: { auto: 'Automatic', manual: 'On request', off: 'Off' }[m], type: 'radio', checked: mode === m, click: () => post('/api/settings', { summaries: m }) })) });
  items.push({ label: 'Open in browser', click: () => shell.openExternal(BASE) });
  if (process.platform === 'darwin' && app.isPackaged) items.push({ label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }) });
  items.push({ type: 'separator' }, { label: 'Quit Control Tower', role: 'quit' });
  return Menu.buildFromTemplate(items);
}

function showWindow(hash = '') {
  if (!win) {
    win = new BrowserWindow({ width: 1360, height: 900, show: false, title: 'Control Tower', backgroundColor: '#161B26', webPreferences: { contextIsolation: true, sandbox: true } });
    win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  }
  win.loadURL(BASE + '/' + hash);
  win.show(); win.focus();
}

app.whenReady().then(async () => {
  fixPath();
  if (process.platform === 'darwin') app.dock?.hide();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'iconTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Control Tower');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { if (win?.isVisible()) win.hide(); else showWindow(); });
  const how = await ensureServer();
  console.log(`control-tower menu bar: server ${how} at ${BASE}`);
  subscribe();
  if (process.env.RADAR_SMOKE) setTimeout(() => app.quit(), Number(process.env.RADAR_SMOKE));
});
app.on('before-quit', () => { app.isQuitting = true; radar?.close(); });
app.on('window-all-closed', () => { /* stay in the menu bar */ });
