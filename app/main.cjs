// Control Tower as a macOS menu bar app: the same server, embedded, plus a tray item that shows
// how many sessions need you and opens the dashboard in a window.
const { app, Tray, Menu, BrowserWindow, nativeImage, shell, dialog } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/** GUI apps get a minimal environment; borrow PATH and CLAUDE_CONFIG_DIR from the login shell so `claude` resolves and the right config dir is watched. */
function fixPath() {
  if (process.platform === 'win32') return;
  try {
    const sh = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(sh, ['-ilc', 'echo "__PATH__$PATH"; echo "__CFG__$CLAUDE_CONFIG_DIR"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.split('\n').find((l) => l.startsWith('__PATH__'));
    if (m) process.env.PATH = m.slice(8);
    const c = out.split('\n').find((l) => l.startsWith('__CFG__'));
    if (c && c.slice(7)) process.env.CLAUDE_CONFIG_DIR = c.slice(7);
  } catch { /* keep what we have */ }
  for (const extra of [path.join(process.env.HOME || '', '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) if (!process.env.PATH.split(':').includes(extra)) process.env.PATH += ':' + extra;
}

const PORT = Number(process.env.PORT || 4747);
const BASE = `http://127.0.0.1:${PORT}`;
let tray, win, tower = null, snap = null, fleet = null;

/** A normal app by default: Dock icon, a window that closing only hides. "Menu bar only" turns the Dock icon off, remembered across launches. */
const prefs = { menuBarOnly: false, remindHooks: true };
let hooksInstalled = null, hooksPrompted = false;
const prefsPath = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() { try { Object.assign(prefs, JSON.parse(fs.readFileSync(prefsPath(), 'utf8'))); } catch { /* defaults */ } }
function savePrefs() { try { fs.mkdirSync(path.dirname(prefsPath()), { recursive: true }); fs.writeFileSync(prefsPath(), JSON.stringify(prefs)); } catch { /* best effort */ } }
function applyDock() { if (process.platform !== 'darwin') return; if (prefs.menuBarOnly && !win?.isVisible()) app.dock?.hide(); else app.dock?.show(); }
/** Template icons are monochrome, so the beacon's shape carries the state: hollow (nothing running), filled (sessions alive), haloed (something needs you). */
const ICONS = Object.fromEntries([['empty', 'iconTemplate.png'], ['live', 'iconLiveTemplate.png'], ['needs', 'iconNeedsTemplate.png']].map(([k, f]) => { const i = nativeImage.createFromPath(path.join(__dirname, f)); i.setTemplateImage(true); return [k, i]; }));

const get = (p) => new Promise((resolve) => { http.get(BASE + p, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); }).on('error', () => resolve(null)); });
const post = (p, body) => new Promise((resolve) => { const req = http.request(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); }); req.on('error', resolve); req.end(body ? JSON.stringify(body) : undefined); });

async function ensureServer() {
  if (await get('/api/health')) return 'already running';
  const { startTower } = await import('../server/start.mjs');
  tower = await startTower({ port: PORT, onError: (e) => console.error('[tower]', e.message) });
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
  snap = s; hooksInstalled = Boolean(s.hooksInstalled);
  const needs = s.sessions.filter((v) => v.needsYou).length; // blocking prompts and unseen follow-ups, like the page
  const working = s.sessions.filter((v) => v.state === 'working').length;
  const agents = s.sessions.reduce((n, v) => n + v.runningAgents, 0);
  tray.setTitle(needs ? ` ${needs} need${needs === 1 ? 's' : ''} you` : working ? ` ${working} working${agents ? ` · ${agents} agent${agents === 1 ? '' : 's'}` : ''}` : '');
  tray.setToolTip(`Control Tower — ${s.sessions.filter((v) => v.alive).length} live sessions, ${needs} waiting for you`);
  const next = needs ? 'needs' : s.sessions.some((v) => v.alive) ? 'live' : 'empty';
  if (next !== fleet) { fleet = next; tray.setImage(ICONS[next]); }
  tray.setContextMenu(buildMenu());
  maybePromptHooks();
}

/** Hooks give exact needs-you and finished signals; the app offers them once per launch until installed, unless told not to. */
async function installHooks() {
  await post('/api/hooks/install');
  const st = await get('/api/hooks'); hooksInstalled = Boolean(st?.installed);
  tray.setContextMenu(buildMenu());
  if (!hooksInstalled) dialog.showErrorBox('Hooks were not installed', 'Control Tower could not update settings.json. Run `control-tower hooks install` in a terminal to see why.');
}
async function maybePromptHooks() {
  if (hooksPrompted || hooksInstalled !== false || prefs.remindHooks === false) return;
  hooksPrompted = true;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'info', message: 'Install Claude Code hooks?',
    detail: 'Hooks tell Control Tower the exact moment a session asks you something, waits for a permission, or finishes. They are added to ~/.claude/settings.json next to any hooks you already have, run a four-line script, and never block a session. Sessions already running pick them up after /hooks reload or a restart.',
    buttons: ['Install hooks', 'Later'], defaultId: 0, cancelId: 1, checkboxLabel: 'Do not remind me again', checkboxChecked: false,
  });
  if (checkboxChecked) { prefs.remindHooks = false; savePrefs(); }
  if (response === 0) await installHooks();
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
  if (hooksInstalled === false) items.push({ label: 'Install Claude Code hooks…', click: () => installHooks() }, { type: 'separator' });
  const mode = snap?.summaries.mode ?? 'auto';
  items.push({ label: 'Summaries', submenu: ['auto', 'manual', 'off'].map((m) => ({ label: { auto: 'Automatic', manual: 'On request', off: 'Off' }[m], type: 'radio', checked: mode === m, click: () => post('/api/settings', { summaries: m }) })) });
  items.push({ label: 'Open in browser', click: () => shell.openExternal(BASE) });
  if (process.platform === 'darwin' && app.isPackaged) items.push({ label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }) });
  if (process.platform === 'darwin') items.push({ label: 'Menu bar only (no Dock icon)', type: 'checkbox', checked: prefs.menuBarOnly, click: (mi) => { prefs.menuBarOnly = mi.checked; savePrefs(); applyDock(); } });
  items.push({ type: 'separator' }, { label: 'Quit Control Tower', role: 'quit' });
  return Menu.buildFromTemplate(items);
}

/** Closing the window hides it; the app keeps running in the Dock (unless menu bar only) and the menu bar. */
function showWindow(hash = '') {
  if (!win) {
    win = new BrowserWindow({ width: 1360, height: 900, show: false, title: 'Control Tower', backgroundColor: '#0D1117', webPreferences: { contextIsolation: true, sandbox: true } });
    win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
    win.on('hide', () => applyDock());
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  }
  if (process.platform === 'darwin') app.dock?.show();
  if (hash || !win.isVisible()) win.loadURL(BASE + '/' + hash);
  win.show(); win.focus();
}

app.whenReady().then(async () => {
  fixPath(); loadPrefs(); applyDock();
  tray = new Tray(ICONS.empty);
  tray.setToolTip('Control Tower');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { if (win?.isVisible()) win.hide(); else showWindow(); });
  const how = await ensureServer();
  console.log(`control-tower menu bar: server ${how} at ${BASE}`);
  subscribe();
  if (!prefs.menuBarOnly) showWindow(); // a normal app opens its window on launch
  if (process.env.TOWER_SMOKE) setTimeout(() => app.quit(), Number(process.env.TOWER_SMOKE));
});
app.on('before-quit', () => { app.isQuitting = true; tower?.close(); });
app.on('window-all-closed', () => { /* keep running: Dock and menu bar */ });
app.on('activate', () => showWindow()); // Dock click or ⌘-Tab while hidden
