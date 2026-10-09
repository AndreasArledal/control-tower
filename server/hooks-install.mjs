export const RADAR_MARKER = /control-tower|claude-radar/; // the old name still matches so an upgrade replaces old hooks

/** Events radar subscribes to. Matchers restrict the chatty tool events to the one tool that matters. */
export const RADAR_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop'];
const MATCHERS = { PreToolUse: 'AskUserQuestion', PostToolUse: 'AskUserQuestion' };

function isRadarHook(h) {
  return h?.type === 'command' && typeof h.command === 'string' && RADAR_MARKER.test(h.command);
}

function stripRadar(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isRadarHook(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) out[event] = kept;
  }
  return out;
}

export function hasRadarHooks(settings) {
  return Object.values(settings?.hooks ?? {}).some((groups) => Array.isArray(groups) && groups.some((g) => (g.hooks ?? []).some(isRadarHook)));
}

/** Return a copy of settings with radar hooks present exactly once per event. */
export function mergeHooks(settings, command) {
  const hooks = stripRadar(structuredClone(settings?.hooks ?? {}));
  for (const event of RADAR_EVENTS) {
    const group = { hooks: [{ type: 'command', command, timeout: 5, async: true }] };
    if (MATCHERS[event]) group.matcher = MATCHERS[event];
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  return { ...structuredClone(settings ?? {}), hooks };
}

/** Return a copy of settings with radar hooks removed; drops the hooks key if nothing is left. */
export function removeHooks(settings) {
  const out = structuredClone(settings ?? {});
  const hooks = stripRadar(out.hooks);
  if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  return out;
}
