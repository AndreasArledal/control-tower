export const TOWER_MARKER = /control-tower/;

/** Events Control Tower subscribes to. Matchers restrict the chatty tool events to the one tool that matters. */
export const TOWER_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop'];
const MATCHERS = { PreToolUse: 'AskUserQuestion', PostToolUse: 'AskUserQuestion' };

function isTowerHook(h) {
  return h?.type === 'command' && typeof h.command === 'string' && TOWER_MARKER.test(h.command);
}

function stripTower(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isTowerHook(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) out[event] = kept;
  }
  return out;
}

export function hasTowerHooks(settings) {
  return Object.values(settings?.hooks ?? {}).some((groups) => Array.isArray(groups) && groups.some((g) => (g.hooks ?? []).some(isTowerHook)));
}

/** Return a copy of settings with Control Tower hooks present exactly once per event. */
export function mergeHooks(settings, command) {
  const hooks = stripTower(structuredClone(settings?.hooks ?? {}));
  for (const event of TOWER_EVENTS) {
    const group = { hooks: [{ type: 'command', command, timeout: 5, async: true }] };
    if (MATCHERS[event]) group.matcher = MATCHERS[event];
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  return { ...structuredClone(settings ?? {}), hooks };
}

/** Return a copy of settings with Control Tower hooks removed; drops the hooks key if nothing is left. */
export function removeHooks(settings) {
  const out = structuredClone(settings ?? {});
  const hooks = stripTower(out.hooks);
  if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  return out;
}
