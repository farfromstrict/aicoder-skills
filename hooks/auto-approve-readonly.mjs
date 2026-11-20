#!/usr/bin/env node
/**
 * PreToolUse hook：按 permission.json 的三级正则规则逐段决策命令执行。
 *
 * 配置：C:\Users\<user>\.codebuddy\permission.json（每次执行实时读取，改完即生效）
 *   { "permissions": { "deny": [正则...], "ask": [正则...], "allow": [正则...] } }
 *
 * 决策模型：逐段白名单——命令按 ; && || 拆段（感知引号），每段独立分类：
 *   deny（拦截）> ask（弹框）> safe（cd/$env 前缀）> allow（白名单）> unknown（未命中）
 *   全部段为 allow/safe → 放行；否则取失败段生成 reason（只列有问题的段）。
 * 复杂结构（for/foreach/if 等控制流、{} 脚本块、多行）无法可靠分析 → 一律 ask 并明示原因。
 * 管道/重定向/反引号/命令替换/单 & → 一律 ask。
 * reason 经 \uXXXX 编码输出（JSON 文本纯 ASCII，规避插件解码问题，中文可正常渲染）。
 *
 * 前提：CodeBuddy 设置中「Auto Run」已开启，否则插件以 bypassImmune 否决 hook 的 allow。
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// 参数：argv 可为 <configPath>、--mode <mode>、--rules <json>；hook 正常调用时不传，走默认。
const ARGS = process.argv.slice(2);
let MODE_OVERRIDE = null;
let RULES_OVERRIDE = null;
let userConfigPath = null;
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === '--mode' && i + 1 < ARGS.length) {
    MODE_OVERRIDE = ARGS[++i];
  } else if (ARGS[i] === '--rules' && i + 1 < ARGS.length) {
    RULES_OVERRIDE = ARGS[++i];
  } else if (!ARGS[i].startsWith('--') && !userConfigPath) {
    userConfigPath = ARGS[i];
  }
}
const USER_CONFIG = userConfigPath || join(homedir(), '.codebuddy', 'permission.json');
const LOG_FILE = join(homedir(), '.codebuddy', 'hooks', 'hook-probe.log');
// 决策日志按日期分文件：~/.codebuddy/logs/auto-approve/YYYY-MM-DD.jsonl
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const DECISION_LOG = process.env.AUTO_APPROVE_LOG_OVERRIDE || join(homedir(), '.codebuddy', 'logs', 'auto-approve', `${day}.jsonl`);
// 重放调用（传了任一覆盖参数）不落盘，避免污染生产日志
const REPLAY = MODE_OVERRIDE !== null || RULES_OVERRIDE !== null || userConfigPath !== null;

// 配置缺失/非法时的兜底白名单
const FALLBACK_ALLOW = [
  '^git\\s+(status|log|show|diff|branch|tag|blame|remote|ls-files|rev-parse|describe|shortlog|check-ignore|cat-file|reflog|symbolic-ref|for-each-ref|show-ref|ls-remote|name-rev|merge-base|worktree|count-objects)\\b',
  '^git\\s+--no-pager\\b',
  '^git\\s+config\\s+(--get|--list|--get-all|--get-regexp|-l)\\b',
  '^git\\s+stash\\s+list\\b',
  '^openspec-cn\\b',
];

function loadRules(file, fallback) {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const p = parsed?.permissions ?? {};
    let mode = ["allow-all", "no-ask", "normal"].indexOf(parsed && parsed.mode) >= 0 ? parsed.mode : "normal";
    // --mode 覆盖 mode（重放历史决策用）；非法值忽略
    if (MODE_OVERRIDE && ["allow-all", "no-ask", "normal"].includes(MODE_OVERRIDE)) mode = MODE_OVERRIDE;
    const layer = {
      mode,
      deny: Array.isArray(p.deny) ? p.deny : [],
      ask: Array.isArray(p.ask) ? p.ask : [],
      allow: Array.isArray(p.allow) ? p.allow : (fallback || FALLBACK_ALLOW),
      write_allow: Array.isArray(p.write_allow) ? p.write_allow : [],
      delete_allow: Array.isArray(p.delete_allow) ? p.delete_allow : [],
    };
    // --rules 在下面独立构造用户层，不经过这里
    return layer;
  } catch {
    return null;
  }
}

function compile(rules) {
  return rules
    .map(r => {
      try { return { rule: r, re: new RegExp(r, 'i') }; } catch { return null; }
    })
    .filter(Boolean);
}

function firstMatch(rules, text) {
  return rules.find(r => r.re.test(text)) || null;
}

// 解封装单段：循环剥前导 & 和 <exe> -c <script>（两种可叠加）
function unwrapOne(input) {
  let s = input.trim();
  for (let i = 0; i < 5; i++) {
    let changed = false;
    const amp = s.match(/^&\s+(.+)$/);
    if (amp) { s = amp[1].trim(); changed = true; }
    const m = s.match(/^(?:(['"])(.*?)\1|(\S+))\s+-(?:c|Command)\s+(['"])([\s\S]*)\4\s*$/i);
    if (m) { s = m[5].trim(); changed = true; }
    if (!changed) break;
  }
  return s;
}

// 解封装：先按 ; && || 分段，逐段解包；解包后若内层又出现分隔符则递归再拆。
// 例：
//   & 'bash.exe' -c 'echo hi'           -> echo hi
//   & 'bash.exe' -c 'echo hi; ls'       -> echo hi; ls        （内层 ; 递归拆）
//   $p = "x.exe"; & $p --version        -> $p = "x.exe"; $p --version  （& 在段首被剥）
// & 只在段首剥，2>&1 里的 & 不受影响。递归最多 5 层，防异常输入死循环。
function unwrapShell(input, depth = 0) {
  let s = input.trim();
  if (depth === 0) {
    const wrap = s.match(/^PowerShell\(([\s\S]*)\)$/i);
    if (wrap) s = wrap[1].trim();
  }
  if (depth > 5) return unwrapOne(s);
  const segs = splitSegments(s);
  if (!segs.length) return '';
  const out = [];
  for (const seg of segs) {
    const u = unwrapOne(seg);
    // 仅当解包改变了内容且内层又出现分隔符时才递归，避免 (a; a) 这类无变化输入死循环
    if (u !== seg && splitSegments(u).length > 1) {
      out.push(unwrapShell(u, depth + 1));
    } else {
      out.push(u);
    }
  }
  return out.join('; ');
}

// 变量解析：收集 $var = "字面量" 赋值，替换后续段中的 $var 引用。
// 仅处理简单字面量赋值（无副作用），不解析表达式/命令替换。
function resolveVars(cmd) {
  const segs = splitSegments(cmd);
  const vars = new Map();
  const out = [];
  for (const seg of segs) {
    const m = seg.match(/^\$([A-Za-z_]\w*)\s*=\s*(['"])(.*?)\2\s*$/);
    if (m) {
      vars.set(m[1], m[2] + m[3] + m[2]); // 保留引号，如 "C:\...\herdr-app.exe"
      continue; // 赋值段本身仍保留，交给 isSafeSegment 判定
    }
    let resolved = seg;
    for (const [name, value] of vars) {
      resolved = resolved.replace(new RegExp('\\$' + name + '\\b', 'g'), value);
    }
    out.push(resolved);
  }
  return out.join('; ');
}

// 安全段：切换目录 / 设置环境变量（无副作用；$env: 排除 PATH/GIT_ 开头/PSModulePath 等敏感变量）
function isSafeSegment(seg) {
  const cdRe = /^(cd|Set-Location|sl)\s+\S/;
  const envRe = /^\$env:(?!PATH\b|PSModulePath\b|GIT_)[A-Za-z_][A-Za-z0-9_]*\s*=\s*['"][^'"]*['"]$/i;
  const exportRe = /^export\s+(?!PATH\b|PSModulePath\b|GIT_)[A-Za-z_]\w*=/;
  // bash 普通变量赋值（S="..." / TMP=...）：无副作用，与 $env:/export 同等对待并排除敏感名
  const bashVarRe = /^(?!PATH\b|PSModulePath\b|GIT_)[A-Za-z_]\w*\s*=/;
  // PowerShell 变量赋值（$p = "..."）：无副作用的字面量赋值
  const psVarRe = /^\$[A-Za-z_]\w*\s*=\s*['"][^'"]*['"]$/;
  // PowerShell 只读查看命令（Out-File 剥离后用于读回临时文件）
  const psReadRe = /^(Get-Content|Select-String|ConvertFrom-Json|Out-String|Sort-Object|Format-List|Format-Table)\b/i;
  return cdRe.test(seg) || envRe.test(seg) || exportRe.test(seg) || bashVarRe.test(seg) || psVarRe.test(seg) || psReadRe.test(seg);
}

// 引号感知拆段：' " 内的 ; && || 不作为分隔符
function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === ';') { segs.push(cur); cur = ''; continue; }
    if (ch === '&' && cmd[i + 1] === '&') { segs.push(cur); cur = ''; i++; continue; }
    if (ch === '|' && cmd[i + 1] === '|') { segs.push(cur); cur = ''; i++; continue; }
    cur += ch;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

// 去掉引号内内容（避免参数里的关键词干扰复杂结构检测）
function stripQuoted(s) {
  return s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

// 复杂结构：PowerShell 控制流关键词（引号外）、{} 脚本块、多行。
// 注意：do 不列入——它是 herdr-app.exe 的子命令（do xxx），真正的 do-while 循环必带 {} 已被上面覆盖。
const COMPLEX_RE = /\b(for|foreach|while|if|elseif|switch|function|filter|trap|try|catch|finally|param|begin|process|end)\b/i;

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
raw = raw.replace(/^\uFEFF/, '').trim();

let input = {};
try {
  input = JSON.parse(raw || '{}');
} catch {
  process.exit(0);
}

const command = input?.tool_input?.command ?? input?.command ?? '';
const rawCmd = typeof command === 'string' ? command.trim() : '';

// --rules 重放：直接用日志里的命中项构造用户层，完全不依赖 permission.json
let userLayer;
if (RULES_OVERRIDE) {
  try {
    const r = JSON.parse(RULES_OVERRIDE);
    const norm = k => Array.isArray(r[k]) ? r[k].filter(x => typeof x === 'string') : [];
    userLayer = {
      mode: ["allow-all", "no-ask", "normal"].includes(MODE_OVERRIDE) ? MODE_OVERRIDE : 'normal',
      deny: norm('deny'), ask: norm('ask'), allow: norm('allow'),
      write_allow: norm('write_allow'), delete_allow: norm('delete_allow'),
    };
  } catch {
    userLayer = { mode: 'normal', deny: [], ask: [], allow: FALLBACK_ALLOW, write_allow: [], delete_allow: [] };
  }
} else {
  userLayer = loadRules(USER_CONFIG, FALLBACK_ALLOW) || { mode: 'normal', deny: [], ask: [], allow: FALLBACK_ALLOW, write_allow: [], delete_allow: [] };
}
const pDir = process.env.CODEBUDDY_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || '';
const projLayer = pDir ? loadRules(join(pDir, '.codebuddy', 'permission.json')) : null;
const denyRules = compile(userLayer.deny);
const askRules = compile(userLayer.ask);
const allowRules = compile(userLayer.allow);
const writeRules = compile(userLayer.write_allow);
const deleteRules = compile(userLayer.delete_allow);
const projDeny = projLayer ? compile(projLayer.deny) : [];
const projAsk = projLayer ? compile(projLayer.ask) : [];
const projAllow = projLayer ? compile(projLayer.allow) : [];
const projWrite = projLayer ? compile(projLayer.write_allow) : [];
const projDelete = projLayer ? compile(projLayer.delete_allow) : [];




// 命中的规则（去重，按文本），供决策日志与 --rules 重放使用
const hit = { deny: new Set(), ask: new Set(), allow: new Set(), write_allow: new Set(), delete_allow: new Set() };
function trackHit(kind, rule) {
  if (rule && hit[kind]) hit[kind].add(rule);
}
function hitRules() {
  return {
    deny: [...hit.deny],
    ask: [...hit.ask],
    allow: [...hit.allow],
    write_allow: [...hit.write_allow],
    delete_allow: [...hit.delete_allow],
  };
}

// reason 枚举：deny=路径, ask=内部判定类型, allow=放行路径
const REASON = {
  DENY_USER_WHOLE: 'DENY_USER_WHOLE',
  DENY_USER_SEG: 'DENY_USER_SEG',
  DENY_PROJECT: 'DENY_PROJECT',
  DENY_SEG: 'DENY_SEG',
  DENY_VETO: 'DENY_VETO',
  ASK_OPERATOR_PIPE: 'ASK_OPERATOR_PIPE',
  ASK_OPERATOR_REDIRECT: 'ASK_OPERATOR_REDIRECT',
  ASK_OPERATOR_SUBST: 'ASK_OPERATOR_SUBST',
  ASK_EXTERNAL_CALL: 'ASK_EXTERNAL_CALL',
  ASK_COMPLEX: 'ASK_COMPLEX',
  ASK_RULE: 'ASK_RULE',
  ASK_UNKNOWN: 'ASK_UNKNOWN',
  ALLOW_MODE_ALL: 'ALLOW_MODE_ALL',
  ALLOW_MODE_PROJECT: 'ALLOW_MODE_PROJECT',
  ALLOW_MODE_NOASK: 'ALLOW_MODE_NOASK',
  ALLOW_WHITELIST: 'ALLOW_WHITELIST',
};

function decision(level, reasonCode, reasonText) {
  // 决策日志（按日期分文件）：raw / decision / reason(enum) / mode / hit_rules，重放不落盘
  if (!REPLAY) {
    try {
      mkdirSync(dirname(DECISION_LOG), { recursive: true });
      appendFileSync(DECISION_LOG, JSON.stringify({
        raw: rawCmd.slice(0, 4000),
        decision: level,
        reason: reasonCode,
        mode: userLayer.mode,
        hit_rules: hitRules(),
      }) + '\n');
    } catch { /* fail-open：写日志失败不影响决策 */ }
  }
  // 人读文本日志（保留原有行为）
  try {
    const rawNote = rawCmd !== cmd ? ` | raw=${rawCmd.slice(0, 200)}` : '';
    appendFileSync(LOG_FILE,
      `${new Date().toISOString()} | decision=${level} | cwd=${process.cwd()} | cmd=${cmd.slice(0, 200)}${rawNote}\n`);
  } catch {}
  // 强制非 ASCII 字符以 \uXXXX 转义（JSON 文本纯 ASCII，中文渲染正常）
  const json = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: level,
      permissionDecisionReason: reasonText,
    },
  }).replace(/[\u0080-\uFFFF]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  process.stdout.write(json);
}

// 预处理链（规则与 hit 已就绪）：解封装 → 变量解析 → 按 write_allow 剥离无害写重定向 → 安全管道归一化
let cmd = unwrapShell(rawCmd);
cmd = resolveVars(cmd);
cmd = stripHarmlessRedir(cmd);
cmd = normalizeSafePipes(cmd);

if (userLayer.mode === 'allow-all') {
  decision('allow', REASON.ALLOW_MODE_ALL, '✅ mode=allow-all：全部放行');
  process.exit(0);
}
const segDenyHit = splitSegments(cmd).map(s => ({ seg: s, m: firstMatch(denyRules, s) })).find(x => x.m) || null;
const wholeDeny = firstMatch(denyRules, cmd);
if (wholeDeny || segDenyHit) {
  trackHit('deny', (wholeDeny || segDenyHit.m).rule);
  decision('deny', wholeDeny ? REASON.DENY_USER_WHOLE : REASON.DENY_USER_SEG,
    '⛔ 用户级 deny 兜底：' + truncate(segDenyHit ? segDenyHit.seg : cmd, 60));
  process.exit(0);
}
if (projLayer && projLayer.mode === 'allow-all') {
  decision('allow', REASON.ALLOW_MODE_PROJECT, '✅ 项目级 mode=allow-all（未命中用户 deny）');
  process.exit(0);
}
const projSegDenyHit = projLayer ? splitSegments(cmd).map(s => ({ seg: s, m: firstMatch(projDeny, s) })).find(x => x.m) : null;
const projWholeDeny = projLayer ? firstMatch(projDeny, cmd) : null;
if (projLayer && (projWholeDeny || projSegDenyHit) && (userLayer.mode === 'no-ask' || projLayer.mode === 'no-ask')) {
  trackHit('deny', (projWholeDeny || projSegDenyHit.m).rule);
  decision('deny', REASON.DENY_PROJECT, '⛔ 项目级 deny：' + truncate(projSegDenyHit ? projSegDenyHit.seg : cmd, 60));
  process.exit(0);
}
if (userLayer.mode === 'no-ask' || (projLayer && projLayer.mode === 'no-ask')) {
  decision('allow', REASON.ALLOW_MODE_NOASK, '✅ mode=no-ask：未命中 deny 规则，放行');
  process.exit(0);
}
// 提取段中的写入目标路径：> / >> / Out-File -FilePath。返回 { target, rest } 或 null。
function extractWriteTarget(seg) {
  let m = seg.match(/\|?\s*Out-File\s+-FilePath\s+(['"])([^'"]+)\1/i);
  if (m) return { target: m[2], re: /\|?\s*Out-File\s+-FilePath\s+(['"])([^'"]+)\1(\s+-Encoding\s+\S+)?/gi };
  m = seg.match(/>>?\s+['"]?([^'">|;]+)['"]?\s*$/);
  if (m) return { target: m[1].trim(), re: />>?\s+['"]?([^'">|;]+)['"]?\s*$/g };
  return null;
}

// 提取段中的删除目标路径：rm [-f...] / Remove-Item。返回 { target, re } 或 null。
function extractDeleteTarget(seg) {
  let m = seg.match(/^rm\s+(?:-[a-z]+(?::\S+)?\s+)*['"]?([^'">|;]+?)['"]?(?:\s+-[a-z]+(?::\S+)?)?\s*$/i);
  if (m) return { target: m[1].trim(), re: /^rm\s+.*$/i };
  m = seg.match(/^Remove-Item\s+(?:-[a-z]+(?::\S+)?\s+)*['"]?([^'">|;]+?)['"]?(?:\s+-[a-z]+(?::\S+)?)?\s*$/i);
  if (m) return { target: m[1].trim(), re: /^Remove-Item\s+.*$/i };
  return null;
}

// 剥离无害的输出重定向：
//   fd 复制 2>&1 />&2、写 /dev/null → 直接剥离；
//   写目标命中 write_allow（如 Temp）→ 剥离该重定向，记入 hit_rules.write_allow。
// 真正写其他文件的 > / >> 保留，仍被运算符检查拦下。
function stripHarmlessRedir(s) {
  let r = s
    .replace(/[12]?>\s*&\s*[12]\b/g, '')
    .replace(/&>\s*\/dev\/null\b/g, '')
    .replace(/[12]?>\s*\/dev\/null\b/g, '');
  // 逐段处理写重定向（> / >>），命中 write_allow 才剥离
  r = splitSegments(r).map(seg => {
    const wt = extractWriteTarget(seg);
    if (!wt) return seg;
    const m = firstMatch(projWrite, wt.target) || firstMatch(writeRules, wt.target);
    if (m) { trackHit('write_allow', m.rule); return seg.replace(wt.re, ''); }
    return seg;
  }).join('; ');
  return r;
}

// 单段是否安全（供安全管道判定用）：命中 deny→false；safe/allow→true；其余 false。
function isSegSafe(s) {
  if (firstMatch(projDeny, s) || firstMatch(denyRules, s)) return false;
  if (isSafeSegment(s)) return true;
  if (firstMatch(projAllow, s) || firstMatch(allowRules, s)) return true;
  return false;
}

// 引号感知地按单 | 拆管道（忽略 || 和引号内的 |）
function splitPipes(cmd) {
  const parts = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '|' && cmd[i + 1] !== '|') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(s => s.trim()).filter(Boolean);
}

// 安全管道归一化：把含 | 的命令按 | 和 ; 拆段，若所有段都安全，则把 | 当 ; 放行；
// 否则保留 |，让下面的运算符检查拦下。这样只读过滤链（grep|head、Get-Content|ConvertFrom-Json）可自动通过。
function normalizeSafePipes(s) {
  if (!s.includes('|') || s.includes('||')) return s;
  const parts = splitPipes(s).flatMap(p => splitSegments(p)).filter(Boolean);
  if (parts.length && parts.every(isSegSafe)) return parts.join('; ');
  return s;
}

// 1. 管道/重定向/反引号/命令替换/单 & 调用操作符 → ask（按运算符类型细分 reason）
// cmd 已在预处理链剥离无害重定向（2>&1、Out-File 到 Temp）并归一化安全管道，这里检查剩余的真运算符。
// 用 stripQuoted 去掉引号内内容，避免把 -Pattern "a|b" 这类引号内的 | <> 误判为运算符。
const normalizedForCheck = stripQuoted(cmd.split('&&').join(';').split('||').join(';'));
const opMatch = normalizedForCheck.match(/[|&`><]|\$\(/);
if (opMatch) {
  const op = opMatch[0];
  const opReason = op === '|' ? REASON.ASK_OPERATOR_PIPE
    : op === '>' || op === '<' ? REASON.ASK_OPERATOR_REDIRECT
    : op === '&' ? REASON.ASK_EXTERNAL_CALL
    : REASON.ASK_OPERATOR_SUBST; // ` 或 $(
  decision('ask', opReason, '⚠️ 包含管道/重定向等运算符，无法自动分析');
  process.exit(0);
}

// 2. 复杂结构 → ask（诚实告知无法分析）
if (/[\r\n]/.test(cmd) || /[{}]/.test(cmd) || COMPLEX_RE.test(stripQuoted(cmd))) {
  decision('ask', REASON.ASK_COMPLEX, '⚠️ 包含循环/脚本块等复杂结构，无法自动分析，请人工审查');
  process.exit(0);
}

// 3. 拆段并逐段分类：deny > safe > ask > allow > unknown
const segs = splitSegments(cmd);
const results = segs.map((seg, i) => {
  if (projLayer) {
    if (projLayer.mode === 'allow-all') return { kind: 'allow', seg, i, layer: '[项目级]', note: 'mode=allow-all' };
    const pd = firstMatch(projDeny, seg);
    if (pd) return { kind: 'deny', seg, i, layer: '[项目级]', rule: pd.rule };
    const pa = firstMatch(projAsk, seg);
    if (pa) return { kind: 'ask', seg, i, layer: '[项目级]', rule: pa.rule };
    const pw = firstMatch(projAllow, seg);
    if (pw) return { kind: 'allow', seg, i, layer: '[项目级]', rule: pw.rule };
    if (projLayer.mode === 'no-ask') return { kind: 'allow', seg, i, layer: '[项目级]', note: 'mode=no-ask' };
  }
  const d = firstMatch(denyRules, seg);
  if (d) return { kind: 'deny', seg, i, rule: d.rule };
  if (isSafeSegment(seg)) return { kind: 'safe', seg, i };
  // 删除目标命中 delete_allow（如 Temp）→ safe
  const dt = extractDeleteTarget(seg);
  if (dt) {
    const dm = firstMatch(projDelete, dt.target) || firstMatch(deleteRules, dt.target);
    if (dm) return { kind: 'safe', seg, i, dmRule: dm.rule };
  }
  const a = firstMatch(askRules, seg);
  if (a) return { kind: 'ask', seg, i, rule: a.rule };
  const w = firstMatch(allowRules, seg);
  if (w) return { kind: 'allow', seg, i, rule: w.rule };
  if (userLayer.mode === 'no-ask') return { kind: 'allow', seg, i, layer: '[用户级]', note: 'mode=no-ask' };
  if (userLayer.mode === 'allow-all') return { kind: 'allow', seg, i, layer: '[用户级]', note: 'mode=allow-all' };
  return { kind: 'unknown', seg, i, layer: '[默认]' };
});
// 收集逐段命中的规则（去重由 trackHit 内部 Set 完成）
for (const r of results) {
  if (r.rule) trackHit(r.kind === 'allow' ? 'allow' : r.kind, r.rule);
  if (r.dmRule) trackHit('delete_allow', r.dmRule);
}

// 4. 任一段命中 deny → 拦截并指出所在段
if (userLayer.mode !== 'allow-all') {
  const veto = results.find(r => r.kind === 'allow' && firstMatch(denyRules, r.seg));
  if (veto) {
    veto.kind = 'deny'; veto.layer = '[用户级兜底]';
    veto.rule = firstMatch(denyRules, veto.seg).rule;
    trackHit('deny', veto.rule);
  }
}
const denyHit = results.find(r => r.kind === 'deny');
if (denyHit) {
  const dReason = denyHit.layer === '[用户级兜底]' ? REASON.DENY_VETO
    : denyHit.layer === '[项目级]' ? REASON.DENY_PROJECT
    : REASON.DENY_SEG;
  decision('deny', dReason, `⛔ 第 ${denyHit.i + 1} 段命中 deny 规则：${truncate(denyHit.seg, 60)}`);
  process.exit(0);
}

// 5. 全部段 allow/safe → 放行
if (results.every(r => r.kind === 'allow' || r.kind === 'safe')) {
  decision('allow', REASON.ALLOW_WHITELIST, segs.length > 1 ? `✅ 共 ${segs.length} 段，均在白名单内` : '✅ 白名单命令');
  process.exit(0);
}

// 6. 提取失败段（只列有问题的段）
const bad = results.filter(r => r.kind !== 'allow' && r.kind !== 'safe');
const badDesc = bad.slice(0, 3).map(r => {
  const label = (r.layer ? r.layer + ' ' : '') + (r.kind === 'ask' ? '命中 ask 规则' : '不在白名单');
  return `第 ${r.i + 1} 段 [${truncate(r.seg, 50)}] ${label}`;
});
const more = bad.length > 3 ? `（另有 ${bad.length - 3} 段）` : '';
const aReason = bad[0].kind === 'ask' ? REASON.ASK_RULE : REASON.ASK_UNKNOWN;
decision('ask', aReason, `⚠️ 需要确认：${badDesc.join('；')}${more}`);
