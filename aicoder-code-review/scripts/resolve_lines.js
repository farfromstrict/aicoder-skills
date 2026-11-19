#!/usr/bin/env node
/**
 * resolve_lines.js — 批量行号解析（批次2）
 *
 * 作用：子代理发现不带行号，只给"逐字代码/可定位符号"。本脚本按文件聚合，
 * 一次性解析所有发现的行号，替代多次 Grep 工具调用。
 *
 * 用法：
 *   node resolve_lines.js <projectRoot> <findingsFile>
 *
 *   - projectRoot   项目根目录
 *   - findingsFile  JSON 文件，格式：
 *     [
 *       { "path": "src/a.vue", "locate": "expire-summary" },
 *       { "path": "src/b.js",  "locate": "const foo =" }
 *     ]
 *     locate 为可定位符号/文案的子串（区分大小写）；脚本找出该文件中所有匹配行。
 *
 * 输出：stdout JSON 数组，每项 { path, locate, lines: [行号...] }
 *   找不到匹配时 lines 为空数组（主会话据此降级为提问式或定点补读）。
 *
 * 注意：直接 fs 读文件，无 Bash VT 伪影；行号 1-based。
 */
'use strict';

const fs = require('fs');
const path = require('path');

function die(msg) { process.stderr.write('ERROR: ' + msg + '\n'); process.exit(1); }

const [projectRoot, findingsFile] = process.argv.slice(2);
if (!projectRoot || !findingsFile) {
  die('usage: node resolve_lines.js <projectRoot> <findingsFile>');
}

const findings = JSON.parse(fs.readFileSync(findingsFile, 'utf8'));
if (!Array.isArray(findings)) die('findingsFile must be a JSON array');

// 按文件聚合，避免同一文件重复读
const byFile = new Map();
for (const f of findings) {
  if (!f.path || !f.locate) continue;
  if (!byFile.has(f.path)) byFile.set(f.path, []);
  byFile.get(f.path).push(f.locate);
}

const cache = new Map();
function linesOf(file) {
  if (cache.has(file)) return cache.get(file);
  const full = path.join(projectRoot, file);
  if (!fs.existsSync(full)) { cache.set(file, null); return null; }
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  cache.set(file, lines);
  return lines;
}

const out = [];
for (const f of findings) {
  if (!f.path || !f.locate) { out.push({ path: f.path, locate: f.locate, lines: [] }); continue; }
  const lines = linesOf(f.path);
  const hits = [];
  if (lines) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(f.locate)) hits.push(i + 1);
    }
  }
  out.push({ path: f.path, locate: f.locate, lines: hits });
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
