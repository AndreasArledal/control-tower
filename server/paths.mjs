import { join } from 'node:path';

/** Resolve the Claude Code config dir (~/.claude unless CLAUDE_CONFIG_DIR is set). */
export function claudeHome(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  return join(env.HOME || env.USERPROFILE || '', '.claude');
}

/** Claude Code names a project's transcript dir by replacing every non-alphanumeric char of the cwd with '-'. */
export function encodeProjectDir(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function projectsDir(home) {
  return join(home, 'projects');
}

export function transcriptPathFor(home, cwd, sessionId) {
  return join(projectsDir(home), encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

/** Where Control Tower keeps its own state (hook spool, summaries, settings). */
export function towerDir(home) {
  return join(home, 'control-tower');
}
