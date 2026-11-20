#!/usr/bin/env node
/**
 * timing-report — aggregate ~/.mindmate/telemetry/timing.jsonl into stage costs.
 *
 * Read-only: never modifies the telemetry log or any knowledge file.
 * Sessions are split on `capture:start`; events before the first one are ignored.
 *
 * Percentage base EXCLUDES the human confirmation wait by default (use
 * --with-wait to include it). The report stage needs a `capture:end` event;
 * when absent it shows as unmeasured and the measured window ends at the last
 * available event.
 *
 * Usage:
 *   node timing-report.mjs                       # all sessions, machine-time %
 *   node timing-report.mjs --last                # last session
 *   node timing-report.mjs --last --detail       # + event-by-event breakdown
 *   node timing-report.mjs --last --json         # machine-readable
 *   node timing-report.mjs --with-wait           # include human wait in % base
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';

const HOME = os.homedir();
const DEFAULT_FILE = path.join(HOME, '.mindmate', 'telemetry', 'timing.jsonl');

const { values } = parseArgs({
  options: {
    file: { type: 'string', default: DEFAULT_FILE },
    last: { type: 'boolean', default: false },
    session: { type: 'string' },
    detail: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'with-wait': { type: 'boolean', default: false },
  },
  allowPositionals: false,
  strict: true,
});

// Machine stages tile [capture:start, capture:end]; human wait is carved out.
const MACHINE_STAGES = [
  ['探测+规划+生成确认草稿', 'capture:start', 'confirm:shown'],
  ['写盘执行', 'write:begin', 'write:end'],
  ['派生 index+lint', 'index:begin', 'lint:end'],
  ['报告生成', 'lint:end', 'capture:end'],
];
const WAIT_FROM = 'confirm:shown';
const WAIT_TO = 'confirm:received';
const SCRIPT_STAGES = ['search', 'roots', 'stage-commit', 'index', 'lint'];

function ms(n) {
  if (n == null) return '—';
  if (n < 1000) return `${n}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${(n / 60000).toFixed(1)}min`;
}
function pct(n, base) {
  if (n == null || !base) return '—';
  return `${((n / base) * 100).toFixed(1)}%`;
}
function iso(ts) {
  const d = new Date(ts);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (x) => String(Math.abs(x)).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function loadEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error(`无法读取 telemetry 文件: ${file}\n${e.message}`); process.exit(1); }
  const events = [];
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.ts === 'number' && typeof o.event === 'string') events.push(o);
      else bad++;
    } catch (_) { bad++; }
  }
  events.sort((a, b) => a.ts - b.ts);
  return { events, bad };
}

function splitSessions(events) {
  const sessions = [];
  let cur = null;
  for (const e of events) {
    if (e.event === 'capture:start') { cur = { start: e.ts, events: [] }; sessions.push(cur); }
    if (cur) cur.events.push(e);
  }
  return sessions;
}

function delta(evts, from, to) {
  const a = evts.find((e) => e.event === from);
  const b = evts.find((e) => e.event === to);
  return a && b ? b.ts - a.ts : null;
}
function scriptMs(evts, name) {
  // stage-commit may run twice: a dry-run (validation) then the real --apply.
  // The applied event marks the real commit; take the :end that follows it.
  if (name === 'stage-commit') {
    const applied = evts.find((e) => e.event === 'stage-commit:applied');
    if (applied) {
      const end = evts.find((e) => e.event === 'stage-commit:end' && e.ts >= applied.ts);
      if (end && typeof end.meta?.ms === 'number') return end.meta.ms;
      return end ? end.ts - applied.ts : null;
    }
  }
  const end = evts.find((e) => e.event === `${name}:end`);
  if (end && typeof end.meta?.ms === 'number') return end.meta.ms;
  return delta(evts, `${name}:begin`, `${name}:end`);
}

function analyse(sess, withWait) {
  const evts = sess.events;
  const waitMs = delta(evts, WAIT_FROM, WAIT_TO) || 0;
  const start = evts.find((e) => e.event === 'capture:start')?.ts ?? sess.start;
  const endEvt = evts.find((e) => e.event === 'capture:end') ?? evts[evts.length - 1];
  const end = endEvt.ts;
  const complete = evts.some((e) => e.event === 'capture:end');

  // wall clock from capture:start to end (or last event if no capture:end)
  const wallMs = end - start;
  // machine time = wall minus human wait (or full wall if --with-wait)
  const base = withWait ? wallMs : wallMs - waitMs;

  const stages = MACHINE_STAGES.map(([label, a, b]) => ({ label, ms: delta(evts, a, b) }));
  const sumStages = stages.reduce((s, r) => s + (r.ms || 0), 0);
  const gapMs = Math.max(0, (withWait ? wallMs : wallMs - waitMs) - sumStages);
  // add a residual row for inter-stage reasoning gaps
  const stageRows = [...stages, { label: '段间空隙(推理切换)', ms: gapMs }];

  const scripts = SCRIPT_STAGES.map((name) => ({ name, ms: scriptMs(evts, name) })).filter((r) => r.ms != null);

  return {
    start: sess.start,
    startTime: iso(sess.start),
    complete,
    stages: stageRows,
    scripts,
    waitMs,
    wallMs,
    base,
    baseLabel: withWait ? '总墙钟(含等待)' : '机器时间(不含等待)',
  };
}

function renderTable(r) {
  console.log(`\n=== 会话 ${r.startTime} (start ts=${r.start}) ===`);
  if (!r.complete) console.log('  [注意] 缺 capture:end：报告段未测，窗口止于最后一个事件');
  console.log('阶段'.padEnd(24) + '耗时'.padEnd(12) + `占比(/${r.baseLabel})`);
  console.log('-'.repeat(58));
  for (const s of r.stages) console.log(s.label.padEnd(22) + ms(s.ms).padEnd(12) + pct(s.ms, r.base));
  console.log('-'.repeat(58));
  for (const s of r.scripts) console.log(`  [脚本] ${s.name}`.padEnd(24) + ms(s.ms));
  console.log('-'.repeat(58));
  console.log(`${r.baseLabel}`.padEnd(22) + ms(r.base));
  console.log('人在环等待(确认)'.padEnd(22) + ms(r.waitMs));
  console.log('窗口墙钟'.padEnd(22) + ms(r.wallMs));
}

function renderDetail(r, evts) {
  console.log('\n事件明细 (相对 capture:start):');
  for (const e of evts) {
    const rel = e.ts - r.start;
    const meta = e.meta ? ` ${JSON.stringify(e.meta)}` : '';
    console.log(`  +${String(rel).padStart(7)}ms  ${e.event}${meta}`);
  }
}

const { events, bad } = loadEvents(values.file);
const sessions = splitSessions(events);
if (bad) console.error(`跳过 ${bad} 行格式异常记录`);
if (!sessions.length) { console.log('未找到任何 capture 会话（无 capture:start 事件）。'); process.exit(0); }

let selected = sessions;
if (values.session) {
  const ts = Number(values.session);
  selected = sessions.filter((s) => s.start === ts);
  if (!selected.length) { console.error(`未找到 start ts=${values.session} 的会话`); process.exit(1); }
} else if (values.last) {
  selected = [sessions[sessions.length - 1]];
}

const withWait = values['with-wait'];
const reports = selected.map((s) => analyse(s, withWait));

if (values.json) {
  console.log(JSON.stringify(reports.map((r) => ({
    start: r.start, startTime: r.startTime, complete: r.complete,
    stages: r.stages, scripts: r.scripts,
    waitMs: r.waitMs, wallMs: r.wallMs, base: r.base, baseLabel: r.baseLabel,
  })), null, 2));
} else {
  for (let i = 0; i < reports.length; i++) {
    renderTable(reports[i]);
    if (values.detail) renderDetail(reports[i], selected[i].events);
  }
}
