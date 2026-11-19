#!/usr/bin/env node
/**
 * repo_prep.js — 审查准备脚本（批次2）
 *
 * 作用：读取项目 config、lessons 两段、按块的 git diff，拼装成 N 份完整 prompt 文件。
 * 主会话派发时只需让子代理 Read 对应 prompt 文件，不再搬运任何正文（主会话 token≈0）。
 *
 * 用法：
 *   node repo_prep.js <projectRoot> <skillRoot> <blocksSpecFile>
 *
 *   - projectRoot   项目根目录（含 .git）
 *   - skillRoot     skill 根目录（含 references/）
 *   - blocksSpecFile JSON 文件，格式见下
 *
 * blocksSpec 格式：
 * {
 *   "files": ["src/a.vue", "src/b.js"],           // 本轮变更文件全集（来自 git diff --stat）
 *   "blocks": [                                    // 分块（主会话按功能内聚决定）
 *     { "id": "f1", "files": ["src/a.vue"], "neighbors": ["f2的邻接摘要文本"] },
 *     { "id": "f2", "files": ["src/b.js"], "neighbors": [] }
 *   ],
 *   "diffArgs": "-U1"                              // 可选，默认 -U1
 * }
 *
 * 输出：
 *   <projectRoot>/tmp/review-prompts/f1.md ... fN.md   （每块完整 prompt）
 *   stdout: manifest JSON（块 id → prompt 文件路径），供主会话解析派发
 *
 * 注意：脚本只用 fs/child_process，git diff 输出走 Buffer 不经 tty，无 Bash VT 伪影。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function die(msg) { process.stderr.write('ERROR: ' + msg + '\n'); process.exit(1); }

const [projectRoot, skillRoot, specFile] = process.argv.slice(2);
if (!projectRoot || !skillRoot || !specFile) {
  die('usage: node repo_prep.js <projectRoot> <skillRoot> <blocksSpecFile>');
}

const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const diffArgs = spec.diffArgs || '-U1';
const blocks = spec.blocks || [];
if (!blocks.length) die('blocksSpec.blocks is empty');

// ---- 读 config（简易 YAML 子集：只取 review.* 开关与 exclude 列表） ----
const configPath = path.join(projectRoot, '.aicoder/code-review/config.yaml');
let dims = { security: true, 'ai-pitfalls': true, performance: true, maintainability: true };
let excludes = [];
if (fs.existsSync(configPath)) {
  const txt = fs.readFileSync(configPath, 'utf8');
  const reviewBlock = txt.match(/^review:\s*$[\s\S]*?(?=^\S|\s*$)/m);
  if (reviewBlock) {
    for (const key of Object.keys(dims)) {
      const m = reviewBlock[0].match(new RegExp('^\\s+' + key + ':\\s*(true|false)', 'm'));
      if (m) dims[key] = m[1] === 'true';
    }
  }
  const ex = txt.match(/^exclude:\s*\[([^\]]*)\]/m);
  if (ex) excludes = ex[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

// ---- 读 lessons 两段（惯例缓存 + 用户决策口径） ----
function lessonsExcerpt() {
  const p = path.join(projectRoot, '.aicoder/code-review/lessons.md');
  if (!fs.existsSync(p)) return '';
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(/(## 项目惯例缓存[\s\S]*?)(?=## |$)/);
  const d = txt.match(/(## 用户决策口径[\s\S]*?)(?=## |$)/);
  return [m && m[1], d && d[1]].filter(Boolean).join('\n');
}

// ---- 读适用清单（按开关 + 本轮语言，简易：全部纳入，关掉的跳过） ----
function checklistText() {
  const ref = path.join(skillRoot, 'references');
  const files = [];
  if (dims['ai-pitfalls']) files.push('ai-code-pitfalls.md');
  if (dims.security) files.push('security-checklist.md');
  files.push('vue-checklist.md', 'js-ts-checklist.md', 'java-checklist.md');
  let out = '';
  for (const f of files) {
    const p = path.join(ref, f);
    if (fs.existsSync(p)) out += '\n### ' + f + '\n' + fs.readFileSync(p, 'utf8') + '\n';
  }
  const ruleDir = path.join(ref, 'rules');
  if (fs.existsSync(ruleDir)) {
    for (const f of fs.readdirSync(ruleDir).filter(x => x.endsWith('.md'))) {
      out += '\n### rules/' + f + '\n' + fs.readFileSync(path.join(ruleDir, f), 'utf8') + '\n';
    }
  }
  return out;
}

// ---- 取某块的 diff（走 Buffer，无 VT 伪影） ----
function blockDiff(files) {
  const kept = files.filter(f => !excludes.some(g => f.includes(g.replace(/\*\*\//g, '').replace(/\*/g, ''))));
  if (!kept.length) return '';
  try {
    const r = cp.execFileSync('git', ['diff', diffArgs, '--', ...kept], {
      cwd: projectRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return r || '';
  } catch (e) {
    process.stderr.write('WARN: git diff failed: ' + (e.message || e) + '\n');
    return '';
  }
}

// ---- 拼装每块 prompt ----
const outDir = path.join(projectRoot, 'tmp/review-prompts');
fs.mkdirSync(outDir, { recursive: true });
const lessons = lessonsExcerpt();
const checklists = checklistText();
const manifest = [];

for (const b of blocks) {
  if (!b.id || !Array.isArray(b.files)) die('bad block spec: ' + JSON.stringify(b));
  const diff = blockDiff(b.files);
  const neighbors = (b.neighbors || []).join('\n');
  const prompt = [
    '# 审查任务（' + b.id + '）',
    '',
    '你是代码审查子代理。本文件是你唯一需要读取的任务输入——严格遵守以下全部内容。',
    '',
    '## 红线',
    '- 纯静态分析：禁止编译/测试/写任何文件。',
    '- 每条发现给：逐字代码行 + 相对路径 + 可定位符号/文案，**不带行号**（行号由主会话 grep 解析）。',
    '- 默认不复核：不读 review.md/lessons.md 判模式、不核实历史项。',
    '- 空节不输出，不写"无"/"N/A"占位。',
    '',
    '## 执行要点（清单与规约原文，按 config 开关纳入）',
    checklists || '（无适用清单）',
    '',
    '## 项目惯例缓存与用户决策口径（各块共用）',
    lessons || '（无 lessons）',
    '',
    '## 邻接摘要（仅与本块有交互关系的块）',
    neighbors || '（无）',
    '',
    '## 本块 diff（' + b.files.join(', ') + '）',
    '```diff',
    diff || '（无 diff，可能全为新增文件，请定点读取源文件）',
    '```',
    '',
    '## 返回格式',
    '## 状态回执 / ## 发现（### F1 [级别] 标题 + 引用/代码/可定位符号/说明/修复建议）/ ## 惯例增量 / ## 模式计数增量 / ## 提问式条目',
  ].join('\n');
  const p = path.join(outDir, b.id + '.md');
  fs.writeFileSync(p, prompt, 'utf8');
  // manifest 自带产物校验信息：主会话读一次即可确认，无需额外 wc -l / grep 校验调用
  const lines = prompt.split('\n').length;
  const diffHunks = (diff.match(/^@@/gm) || []).length;
  manifest.push({
    id: b.id,
    file: path.relative(projectRoot, p).replace(/\\/g, '/'),
    files: b.files,
    lines,
    diffHunks,
    diffEmpty: !diff,
  });
}

process.stdout.write(JSON.stringify({ blocks: manifest }, null, 2) + '\n');
