#!/usr/bin/env node
'use strict';

// CodeBuddy hook -> agent state file -> statusLine emits OSC 7501 to herdr-core.
//
// A hook is a child process whose stdout CodeBuddy captures, so it cannot write
// the escape sequence to the pty itself. statusLine output IS written to the pty
// by CodeBuddy, so it carries the sequence. Both processes share session_id.
//
// Event -> status map (verified earlier):
//   working : prompts and tool activity; a compact resumes mid-turn
//   blocked : AskUserQuestion / permission_prompt
//   done    : the turn finished (Stop / StopFailure) — shows as Done, turns idle once seen
//   idle    : SessionStart registers the agent
//   clear   : SessionEnd — the final statusLine render drops the sidebar record

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_DIR = path.join(os.homedir(), '.codebuddy', 'logs', 'herdr-core-state');
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;

const EVENTS = {
  SessionStart: { state: 'idle' },
  UserPromptSubmit: { state: 'working' },
  PreToolUse: { state: 'working' },
  PostToolUse: { state: 'working' },
  PostToolUseFailure: { state: 'working' },
  PermissionDenied: { state: 'working' },
  Stop: { state: 'done' },
  StopFailure: { state: 'done' },
  Notification: { state: 'blocked' },
};

function decide(event) {
  const name = event && event.hook_event_name;
  if (!Object.hasOwn(EVENTS, name)) return null;
  const cfg = EVENTS[name];
  if (name === 'Notification' && event.notification_type !== 'permission_prompt') return null;
  // Waiting on the user to answer a question is a real "needs you" state, but
  // this build never emits permission_prompt notifications, so catch the tool.
  if (name === 'PreToolUse' && event.tool_name === 'AskUserQuestion') {
    return { state: 'blocked' };
  }
  const state = name === 'SessionStart' && event.source === 'compact' ? 'working' : cfg.state;
  return { state };
}

async function main() {
  // Only report when running inside a herdr-core managed terminal.
  if (!process.env.HC_TERMINAL_ID) return;

  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let event;
  try { event = JSON.parse(input); } catch { return; }

  const sid = typeof event.session_id === 'string' && SESSION_ID.test(event.session_id)
    ? event.session_id
    : 'default';
  const file = path.join(STATE_DIR, `.herdr-agent-state-${sid}.json`);

  // SessionEnd: write clear so the final statusLine render drops the record.
  const report = event.hook_event_name === 'SessionEnd'
    ? { state: 'clear' }
    : decide(event);
  if (!report) return;

  const payload = JSON.stringify({ ...report, ts: Date.now() });
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(file, payload);
  } catch { /* fail-open */ }
}

main().catch(() => {});
