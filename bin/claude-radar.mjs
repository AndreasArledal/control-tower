#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { startRadar } from '../server/start.mjs';
import { makeHooksCtl } from '../server/hooks-ctl.mjs';
import { claudeHome } from '../server/paths.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const usage = `claude-radar — local mission control for Claude Code sessions

  claude-radar [--port 4747] [--no-open] [--no-summaries] [--model haiku]
  claude-radar hooks install|uninstall|status      exact "needs you" / "done" signals via Claude Code hooks
`;

if (flag('--help') || flag('-h')) { console.log(usage); process.exit(0); }

if (args[0] === 'hooks') {
  const ctl = makeHooksCtl(claudeHome());
  const sub = args[1];
  try {
    const r = sub === 'install' ? await ctl.install() : sub === 'uninstall' ? await ctl.uninstall() : await ctl.status();
    console.log(JSON.stringify(r, null, 2));
  } catch (err) { console.error(err.message); process.exit(1); }
  process.exit(0);
}

let radar;
try {
  radar = await startRadar({ port: Number(opt('--port', process.env.PORT ?? 4747)), summaries: flag('--no-summaries') ? 'off' : null, model: opt('--model', 'haiku') });
} catch (err) {
  console.error(err.code === 'EADDRINUSE' ? `Port is already in use. Is claude-radar already running? Try --port.` : err.message);
  process.exit(1);
}
const hooks = await radar.hooksCtl.status();
console.log(`claude-radar  ${radar.url}`);
console.log(`  watching ${radar.home}`);
console.log(hooks.installed ? '  hooks: installed' : '  hooks: not installed (run `claude-radar hooks install` for exact needs-you/done signals)');
if (!flag('--no-open')) openBrowser(radar.url);

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { spawn(cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true }).unref(); } catch { /* user opens it by hand */ }
}
