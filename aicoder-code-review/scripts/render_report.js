#!/usr/bin/env node
/**
 * render_report.js — 报告渲染脚本（批次2/3）
 *
 * 作用：读子代理的结构化标记文本，套用固定模板生成 markdown 报告。
 * 引用块语法、连续编号、速览表行数自检等格式规则内置在脚本里——主会话
 * 不再读 report-generation.md 的格式细节，只给脚本输入 + 读 stdout 正文输出。
 *
 * 输入标记文本格式（子代理按此输出，空字段不写）：
 *   ## 总体评价
 *   <文字>
 *   ## 问题
 *   ### [💡] 标题
 *   REF: src/a.vue:76
 *   CODE: <逐字代码，可多行，直到下一个字段前缀>
 *   WHY: <说明与影响>
 *   FIX: <修复建议>
 *   ### [🟢] 另一个标题
 *   ...
 *   ## 结论
 *   Comment
 *
 * 用法：
 *   node render_report.js <findingsFile> [--out <file>]
 *   不指定 --out 则 stdout 输出 markdown（主会话直接读来正文呈现）。
 *
 * 注意：直接 fs 读文件，无 Bash VT 伪影。
 */
'use strict';

const fs = require('fs');

function die(msg) { process.stderr.write('ERROR: ' + msg + '\n'); process.exit(1); }

const args = process.argv.slice(2);
if (!args.length) die('usage: node render_report.js <findingsFile> [--out <file>]');
const findingsFile = args[0];
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const txt = fs.readFileSync(findingsFile, 'utf8');
const lines = txt.split(/\r?\n/);

// ---- 解析标记文本 ----
let overall = '';
let conclusion = '';
const findings = [];
let cur = null;
let field = null;
let section = null;

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  if (line.startsWith('## 总体评价')) { section = 'overall'; field = null; continue; }
  if (line.startsWith('## 问题')) { section = 'issues'; field = null; continue; }
  if (line.startsWith('## 结论')) { section = 'conclusion'; field = null; continue; }

  const fm = line.match(/^###\s*\[(🔴|🟡|🟢|💡)\]\s*(.+)$/);
  if (fm && section === 'issues') {
    cur = { level: fm[1], title: fm[2], ref: '', code: [], why: '', fix: '' };
    findings.push(cur);
    field = null;
    continue;
  }

  if (section === 'overall') { overall += (overall ? '\n' : '') + line; continue; }
  if (section === 'conclusion') { conclusion += (conclusion ? '\n' : '') + line; continue; }

  if (section === 'issues' && cur) {
    if (line.startsWith('REF:')) { cur.ref = line.slice(4).trim(); field = 'ref'; continue; }
    if (line.startsWith('CODE:')) { field = 'code'; const v = line.slice(5).trim(); if (v) cur.code.push(v); continue; }
    if (line.startsWith('WHY:')) { cur.why = line.slice(4).trim(); field = 'why'; continue; }
    if (line.startsWith('FIX:')) { cur.fix = line.slice(4).trim(); field = 'fix'; continue; }
    if (field === 'code' && line.trim()) { cur.code.push(line); continue; }
    if (field === 'why' && line.trim()) { cur.why += '\n' + line; continue; }
    if (field === 'fix' && line.trim()) { cur.fix += '\n' + line; continue; }
  }
}

// ---- 分级排序与连续编号 ----
const order = { '🔴': 0, '🟡': 1, '🟢': 2, '💡': 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const levelName = { '🔴': '阻断', '🟡': '严重', '🟢': '一般', '💡': '轻微' };
const grouped = { '🔴': [], '🟡': [], '🟢': [], '💡': [] };
findings.forEach((f, i) => { f.no = i + 1; grouped[f.level].push(f); });

// ---- 渲染 ----
const out = [];
out.push('# 代码审查报告');
out.push('');
if (overall.trim()) { out.push('## 总体评价', '', overall.trim(), ''); }

let any = false;
for (const lv of ['🔴', '🟡', '🟢', '💡']) {
  if (!grouped[lv].length) continue;
  any = true;
  out.push('## ' + lv + ' ' + levelName[lv], '');
  for (const f of grouped[lv]) {
    out.push('### ' + f.no + '. ' + f.title, '');
    if (f.ref) {
      const m = f.ref.match(/^(.+?):(\d+)(?:-(\d+))?$/);
      if (m) {
        out.push('```' + m[2] + ':' + (m[3] || m[2]) + ':' + m[1]);
        if (f.code.length) out.push(...f.code);
        out.push('```', '');
      } else {
        out.push('`' + f.ref + '`', '');
      }
    }
    if (f.why) { out.push(f.why.trim(), ''); }
    if (f.fix) { out.push(f.fix.trim(), ''); }
  }
}
if (!any) { out.push('（无问题）', ''); }

out.push('## 审查结论', '', '**' + (conclusion.trim() || 'Comment') + '**', '');

// 问题速览表（自检：行数必须等于问题数）
if (findings.length) {
  out.push('**问题速览**', '', '| 编号 | 问题 |', '|------|------|');
  for (const f of findings) {
    const file = (f.ref.match(/^([^:]+)/) || [, ''])[1].split('/').pop();
    out.push('| ' + f.level + ' ' + f.no + ' · `' + file + '` | ' + f.title.replace(/\|/g, '\\|') + ' |');
  }
  out.push('');
}

const report = out.join('\n') + '\n';
if (outFile) { fs.writeFileSync(outFile, report, 'utf8'); process.stderr.write('written: ' + outFile + '\n'); }
else { process.stdout.write(report); }
