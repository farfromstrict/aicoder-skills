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
import { join, dirname, resolve } from 'node:path';

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
    // -c / -Command 大小写敏感；且仅当 exe 是已知 shell 时才当封装解包。
    // 避免把 grep -c "x"、git -C <path> 等合法 -c/-C 选项误当脚本封装。
    const m = s.match(/^(?:(['"])(.*?)\1|(\S+))\s+-(?:c|Command)\s+(['"])([\s\S]*)\4\s*$/);
    if (m) {
      const exe = (m[2] || m[3] || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
      if (/^(?:bash|sh|dash|zsh|cmd|powershell|pwsh)$/.test(exe)) {
        s = m[5].trim();
        changed = true;
      }
    }
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
    // 同时识别 PowerShell($S=) 与 bash(S=) 变量赋值；值支持引号包裹或裸字面量（无空白/特殊字符）
    const m = seg.match(/^\$?([A-Za-z_]\w*)\s*=\s*(['"])(.*?)\2\s*$/)
      || seg.match(/^\$?([A-Za-z_]\w*)\s*=\s*([^\s'";|&`()<>]+)\s*$/);
    if (m) {
      // 保存裸值；替换时根据 $var 是否已在引号内决定是否补引号
      vars.set(m[1], m[3] ?? m[2]);
      continue; // 赋值段本身仍保留，交给 isSafeSegment 判定
    }
    let resolved = seg;
    for (const [name, value] of vars) {
      // "$var" / '$var' 已在引号内 → 用裸值，避免双引号叠加 ""path""
      resolved = resolved.replace(new RegExp("(['\"])\\$" + name + "\\b\\1", 'g'), '$1' + value + '$1');
      // 裸 $var → 补引号（保留含空格路径的完整性）
      resolved = resolved.replace(new RegExp('\\$' + name + '\\b', 'g'), '"' + value + '"');
    }
    out.push(resolved);
  }
  return out.join('; ');
}

// 脚本文件展开：bash/sh/source/. <script>、powershell/pwsh -File <script> 时读取脚本内容，
// 当作内联命令展开，复用现有逐段分析。与直接 bash -c '...' 等价。
// 读不到 / 空内容 / 超深度 → 保留原段（落到 ask，fail-safe）。
function expandScriptFiles(s, depth = 0) {
  if (depth > 5) return s;
  const segs = splitSegments(s);
  const out = [];
  for (const seg of segs) {
    const t = seg.trim();
    // 识别 shell 脚本调用：bash/sh/dash/zsh [选项] <script>  或  source/. <script>
    let m = t.match(/^(?:bash|sh|dash|zsh)\s+(?:-[a-z]+\s+)*['"]?([^'"\s]+)['"]?\s*$/i)
      || t.match(/^(?:source|\.)\s+['"]?([^'"\s]+)['"]?\s*$/i);
    // PowerShell: powershell/pwsh -File <script>（也支持 -f）
    if (!m) m = t.match(/^(?:powershell|pwsh)\s+-(?:File|f)\s+['"]?([^'"\s]+)['"]?\s*$/i);
    if (!m) { out.push(seg); continue; }
    let scriptPath = m[1];
    try {
      scriptPath = resolve(process.cwd(), scriptPath.replace(/^['"]|['"]$/g, ''));
      if (!existsSync(scriptPath)) { out.push(seg); continue; }
      let content = readFileSync(scriptPath, 'utf8').replace(/^\uFEFF/, '');
      // 去 shebang 与整行注释（bash/ps 的 # 注释；保留行内 #）
      // 换行是语句分隔符，转成 ; 后再交给现有拆段逻辑（否则触发多行 COMPLEX 检查）
      content = content.split('\n').filter(line => !/^\s*#/.test(line)).join('; ').trim();
      if (!content) { out.push(seg); continue; }
      // 脚本内容当作内联命令：解封装 + 递归展开（脚本里再调脚本）
      const expanded = expandScriptFiles(unwrapShell(content), depth + 1);
      out.push(expanded);
    } catch {
      out.push(seg); // 读失败 → 保留原段 → ask
    }
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
// 注意：
//   - do / switch 不列入——它们是命令子命令（herdr do xxx、git switch），真正的 do-while / switch
//     语句必带 {} 已被 hasScriptBlock 覆盖。
//   - if/elseif 要求后跟 '('（PowerShell 语法 if (...)），避免误判 dd 的 if= 参数。
// 循环结构（for/foreach/while）：与代码块分开 reason，提示聚焦循环体。
const LOOP_RE = /(\bfor\b|\bforeach\b|\bwhile\b)/i;
// 其他复杂结构：脚本块由 hasScriptBlock 覆盖；控制流关键字（if/function/try...）归代码块。
// 注意 if/elseif 要求后跟 '('，避免误判 dd 的 if= 参数。
const COMPLEX_RE = /(\bif\s*\(|\belseif\s*\(|\bfunction\b|\bfilter\b|\btrap\b|\btry\b|\bcatch\b|\bfinally\b|\bparam\b|\bbegin\b|\bprocess\b|\bend\b)/i;

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
  ASK_FILE_WRITE: 'ASK_FILE_WRITE',
  ASK_FILE_DELETE: 'ASK_FILE_DELETE',
  ASK_OPERATOR_SUBST: 'ASK_OPERATOR_SUBST',
  ASK_EXTERNAL_CALL: 'ASK_EXTERNAL_CALL',
  ASK_LOOP: 'ASK_LOOP',
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

// ---- if 语句展开（受限支持）----
// 支持形态：if (<cond>) { <body> } [elseif (<cond>) { <body> }]* [else { <body> }]
// 语义：只有"所有分支的 cond 都无副作用 + 所有 body 都安全"才展开为 body 顺序执行，
//       这样无论条件真假，实际执行的命令都在白名单内，可安全放行。
// 条件白名单：$? / $var / Test-* / [ -x ... ] / 字面量；含赋值/命令替换/管道/重定向/分号 → 复杂条件，拒绝。
// 【暂不支持，遇到一律保留原样 → COMPLEX】：
//   - 嵌套 if（body 里再有 if/elseif/控制流）
//   - bash 的 if <cond>; then <body>; fi 语法
//   - 复杂条件（函数调用、命令替换、比较表达式组合等白名单之外的写法）
// 这些形态保守地走 ask，待后续按需扩展。
function matchBalanced(s, start, open, close) {
  let depth = 0, quote = '';
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        if (s[i + 1] === quote) { i++; continue; } // '' / "" 转义
        quote = '';
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { if (--depth === 0) return i; }
  }
  return -1;
}

function isSafeCondition(cond) {
  const c = cond.trim();
  if (!c) return false;
  // 复杂/有副作用构造：命令替换、管道、重定向、分号、大括号、赋值（PowerShell 比较用 -eq/-ne，不含 =）
  if (/\$\(|[;|`><{}]|=[^=]/.test(c)) return false;
  if (c === '$?') return true;                              // 上一条命令退出码
  if (/^\$[A-Za-z_]\w*$/.test(c)) return true;              // 变量引用
  if (/^Test-\w+\b/i.test(c)) return true;                  // PowerShell Test-* 只读判定
  if (/^\[\s*-.*\]$/.test(c)) return true;                  // bash test [ -f x ]
  if (/^(?:'.*'|".*"|\d+(?:\.\d+)?|true|false)$/i.test(c)) return true; // 字面量
  return false;
}

// 从 startIdx（指向 if 之后）解析一条 if/elseif/else 链，返回 { clauses, end } 或 null。
function parseIfChain(s, startIdx) {
  let pos = startIdx;
  const clauses = [];
  const parseClause = (isElse) => {
    let cond = null;
    if (!isElse) {
      while (pos < s.length && /\s/.test(s[pos])) pos++;
      if (s[pos] !== '(') return false;
      const end = matchBalanced(s, pos, '(', ')');
      if (end < 0) return false;
      cond = s.slice(pos + 1, end);
      pos = end + 1;
    }
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    if (s[pos] !== '{') return false;
    const end = matchBalanced(s, pos, '{', '}');
    if (end < 0) return false;
    clauses.push({ cond, body: s.slice(pos + 1, end) });
    pos = end + 1;
    return true;
  };
  if (!parseClause(false)) return null;
  while (true) {
    const rest = s.slice(pos);
    let m = rest.match(/^\s*elseif\b/);
    if (m) { pos += m[0].length; if (!parseClause(false)) return null; continue; }
    m = rest.match(/^\s*else\b/);
    if (m) { pos += m[0].length; if (!parseClause(true)) return null; break; }
    break;
  }
  return { clauses, end: pos };
}

function expandIfBlocks(s) {
  const re = /\bif\s*\(/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s)) !== null) {
    const parsed = parseIfChain(s, m.index + 2);
    if (!parsed) continue; // 解析失败 → 保留，由 COMPLEX 检查拦
    const bodies = [];
    let ok = true;
    for (const c of parsed.clauses) {
      if (c.cond !== null && !isSafeCondition(c.cond)) { ok = false; break; }
      // 嵌套 if / 控制流 / 脚本块 → 不支持
      if (/\b(?:if|elseif|foreach|while|for|switch|function)\s*[\({]/.test(c.body)
        || /[{}]/.test(stripQuoted(c.body))) { ok = false; break; }
      bodies.push(c.body.trim());
    }
    if (!ok) continue;
    const expansion = bodies.filter(Boolean).join('; ');
    out += s.slice(last, m.index) + expansion;
    last = parsed.end;
    re.lastIndex = parsed.end;
  }
  out += s.slice(last);
  return out;
}

// ---- for 循环展开（受限支持、保守）----
// 支持形态：for <var> in <item1> <item2> ...; do <body>; done
// 展开：把 body 里每个 $var 按列表值替换，生成 N 份 body 顺序执行，复用逐段分析。
// 保守拒绝（保留原样 → ASK_LOOP）：嵌套循环、列表项含特殊字符/引号、控制流、迭代 >20、
// 找不到配对 done、变量引用形态异常。不能判断一律 ask。
function findKeyword(s, from, kw) {
  // 引号感知地找独立关键字（词边界）
  let quote = '';
  const re = new RegExp('\\b' + kw + '\\b', 'g');
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) { if (s[i + 1] === quote) { i++; } else quote = ''; } continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    re.lastIndex = i;
    const m = re.exec(s);
    if (m && m.index === i) return i;
  }
  return -1;
}

function expandForLoops(s) {
  const re = /\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;]+?)\s*[;]\s*do\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s)) !== null) {
    const varName = m[1];
    const items = m[2].trim().split(/\s+/).filter(Boolean);
    // 列表项必须是简单字面量（无特殊字符/引号/变量/命令替换）
    if (!items.length || items.length > 20 || items.some(x => /[$`'"><|&{};\\]/.test(x))) continue;
    const doneIdx = findKeyword(s, re.lastIndex, 'done');
    if (doneIdx < 0) continue;
    const body = s.slice(re.lastIndex, doneIdx);
    // body 内嵌套循环/控制流/脚本块 → 保守拒绝
    if (/\b(?:for|foreach|while|if|switch|function)\b/.test(body) || /[{}]/.test(stripQuoted(body))) continue;
    // 替换 $var（含 $var 后紧跟标点，如 $f.java）
    const expansions = items.map(v => body.replace(new RegExp('\\$' + varName + '\\b', 'g'), v));
    out += s.slice(last, m.index) + expansions.join('; ');
    last = doneIdx + 4; // done 长度
    re.lastIndex = last;
  }
  out += s.slice(last);
  return out;
}

// 剥离 bash 命令组边界：{ cmd1; cmd2; } 语义等价于 cmd1; cmd2，边界 { } 无独立语义。
// 仅剥"段首的 { "和"段尾的 }"（命令组语法）；嵌在命令里的 {（如 ForEach-Object { ... }）保留，
// 由 COMPLEX_RE 继续判定为脚本块。
function stripGroupBraces(s) {
  return splitSegments(s).map(seg => {
    let t = seg.trim();
    if (/^\{\s+/.test(t)) t = t.replace(/^\{\s+/, '');  // 段首 {（bash 命令组）
    // 段尾 } 一并剥：此时 if/elseif/else 语句已由 expandIfBlocks 在前面展开消失，
    // 段尾 } 只可能来自 bash 命令组 { ...; } 的结尾，与安全段尾剥离无冲突。
    if (/\s+\}$/.test(t)) t = t.replace(/\s+\}$/, '');
    if (t === '{' || t === '}') t = '';                   // 纯边界段
    return t;
  }).filter(Boolean).join('; ');
}

// 预处理链（规则与 hit 已就绪）：解封装 → 变量解析 → 脚本文件展开 → if块展开 → for循环展开 → 按 write_allow 剥离无害写重定向 → 安全管道归一化 → 剥命令组边界
let cmd = unwrapShell(rawCmd);
cmd = resolveVars(cmd);
cmd = expandScriptFiles(cmd);
cmd = expandIfBlocks(cmd);
cmd = expandForLoops(cmd);
cmd = stripHarmlessRedir(cmd);
cmd = normalizeSafePipes(cmd);
cmd = stripGroupBraces(cmd);

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

// 提取段中的删除目标路径：rm [-f...] / Remove-Item。支持逗号分隔的多文件。
// 返回 { targets: [...] } 或 null。
function parseQuotedList(s) {
  // 匹配引号包裹或裸 token，支持逗号分隔（带或不带空格）
  const tokens = s.match(/(['"])(.*?)\1|([^\s,]+)/g);
  if (!tokens) return [];
  return tokens.map(t => t.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
}
function extractDeleteTarget(seg) {
  let m = seg.match(/^rm\s+([\s\S]+)$/i);
  if (m) {
    const params = m[1].replace(/\s+-[a-z]+(?::\S+)?\s*$/i, '').trim(); // 去尾部选项
    const targets = parseQuotedList(params).filter(t => !/^-[a-z]/i.test(t));
    return targets.length ? { targets } : null;
  }
  m = seg.match(/^Remove-Item\s+([\s\S]+)$/i);
  if (m) {
    const params = m[1].replace(/\s+-[a-z]+(?::\S+)?\s*$/i, '').trim();
    const targets = parseQuotedList(params).filter(t => !/^-[a-z]/i.test(t));
    return targets.length ? { targets } : null;
  }
  return null;
}

// 通用写命令目标提取：覆盖 shell 与 PowerShell 的写/复制/创建命令。
// 返回 { target } 或 null。目标位置按命令语义分三类。
function extractWriteCommandTarget(seg) {
  const s = seg.trim();
  // 命令 → 目标取法：'last'=最后非选项参数, 'first'=第一个非选项参数, 数字=第N个参数, 'of='=dd的of=
  const CMD_TARGET = {
    // shell: 复制/移动（目标=最后参数）
    cp: 'last', install: 'last', rsync: 'last', mv: 'last', 'move': 'last', ln: 'last',
    // shell: 创建/写（目标=第一个参数）
    touch: 'first', mkdir: 'first', 'tee': 'first',
    // PowerShell: 复制/移动（最后参数）
    'copy-item': 'last', 'move-item': 'last',
    // PowerShell: 创建/写（第一个参数）
    'new-item': 'first', 'set-content': 'first', 'add-content': 'first', 'tee-object': 'first',
  };
  let m = s.match(/^([a-z][a-z0-9-]*)\s+(.+)$/i);
  if (!m) return null;
  const cmd = m[1].toLowerCase();

  // dd：目标在 of=<path>
  if (cmd === 'dd') {
    const of = s.match(/\bof\s*=\s*['"]?([^'"\s]+)['"]?/i);
    return of ? { target: of[1] } : null;
  }
  // tar：写归档 cf <archive>；解压 -x -C <dir>（写目标目录）
  if (cmd === 'tar') {
    const cf = s.match(/\b[cz][xf]\s+['"]?([^'"\s]+)['"]?/i);
    if (cf) return { target: cf[1] };
    // 解压：tar -x ... -C <dir> → 写目标是 -C 后的目录
    if (/\s-x\b/i.test(s)) {
      const C = s.match(/-C\s+['"]?([^'"\s]+)['"]?/i);
      if (C) return { target: C[1] };
    }
    return null;
  }
  // Out-File -FilePath（已由 extractWriteTarget 处理重定向剥离，这里也支持独立命令形态）
  if (cmd === 'out-file') {
    const fp = s.match(/-FilePath\s+['"]?([^'"\s]+)['"]?/i);
    return fp ? { target: fp[1] } : null;
  }

  const mode = CMD_TARGET[cmd];
  if (!mode) return null;
  const args = m[2].trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!args) return null;
  const clean = args.map(a => a.replace(/^['"]|['"]$/g, ''));
  // 过滤纯选项参数（以 - 开头，但排除负数字）
  const positional = clean.filter(a => !/^-[a-z]/i.test(a));
  let target;
  if (mode === 'last') target = positional[positional.length - 1];
  else if (mode === 'first') target = positional[0];
  else target = positional[mode - 1];
  return target ? { target } : null;
}

// 剥离无害的输出重定向：
//   fd 复制 2>&1 />&2、写 /dev/null → 直接剥离；
//   写目标命中 write_allow（如 Temp）→ 剥离该重定向，记入 hit_rules.write_allow。
// 真正写其他文件的 > / >> 保留，仍被运算符检查拦下。
function stripHarmlessRedir(s) {
  let r = s
    .replace(/[12]?>\s*&\s*[12]\b/g, '')
    .replace(/&>\s*\/dev\/null\b/g, '')
    .replace(/[12]?>\s*\/dev\/null\b/g, '')
    // PowerShell 丢弃输出：$null（等价 /dev/null），如 2>$null / >$null / &>$null
    .replace(/&?\s*[12]?>\s*\$null\b/gi, '')
    // PowerShell 丢弃输出：| Out-Null（等价 >/dev/null），连同前导管道一并剥离
    .replace(/\s*\|\s*Out-Null\b/gi, '');
  // 逐段处理写重定向（> / >>），命中 write_allow 才剥离
  r = splitSegments(r).map(seg => {
    // 先处理 Out-File -FilePath
    const wt = extractWriteTarget(seg);
    if (wt && wt.re && wt.re.source.includes('Out-File')) {
      const m = firstMatch(projWrite, wt.target) || firstMatch(writeRules, wt.target);
      if (m) { trackHit('write_allow', m.rule); return seg.replace(wt.re, ''); }
      return seg;
    }
    // 处理段内所有 > / >> 重定向（如 `cmd > out.txt 2> err.txt`）：全部命中才全部剥离
    const redirRe = />>?\s+(?:(['"])(.*?)\1|([^\s'">|;]+))/g;
    const matches = [...seg.matchAll(redirRe)];
    if (!matches.length) return seg;
    const targets = matches.map(m => m[2] ?? m[3]);
    const hits = targets.map(t => firstMatch(projWrite, t) || firstMatch(writeRules, t));
    if (hits.every(Boolean)) {
      hits.forEach(h => trackHit('write_allow', h.rule));
      return seg.replace(redirRe, '').trim();
    }
    return seg;
  }).join('; ');
  return r;
}

// 单段是否安全（供安全管道判定用）：命中 deny→false；safe/allow→true；其余 false。
// 去掉 PowerShell 子表达式包装的首尾括号：(Get-Content ...).overlays → Get-Content ...
function stripParens(s) {
  return s.trim().replace(/^\(+/, '').replace(/\)+(?:\.\w+)?$/, '').trim();
}

function isSegSafe(s) {
  // PowerShell 子表达式包装如 (Get-Content ... | ConvertFrom-Json).overlays —— 去掉首尾括号再判定
  let t = stripParens(s);
  // 剥调用操作符 &（管道后段首可能为 & node ...）
  t = t.replace(/^&\s+/, '').trim();
  if (firstMatch(projDeny, t) || firstMatch(denyRules, t)) return false;
  // 纯引号字符串字面量（管道喂给脚本的 stdin 数据）无副作用
  if (/^(['"]).*\1$/.test(t)) return true;
  if (isSafeSegment(t)) return true;
  if (firstMatch(projAllow, t) || firstMatch(allowRules, t)) return true;
  // 写/删除目标命中白名单（如 cp/tar 到 Temp）→ 安全管道段
  const wt = extractWriteCommandTarget(t);
  if (wt && (firstMatch(projWrite, wt.target) || firstMatch(writeRules, wt.target))) return true;
  const dt = extractDeleteTarget(t);
  if (dt && dt.targets.every(x => firstMatch(projDelete, x) || firstMatch(deleteRules, x))) return true;
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

// 安全管道归一化：按 ; 拆段后逐段处理。每个含 | 的段，若其所有管道子段都安全，
// 则把该段的 | 当 ; 归一化；否则原样保留该段。这样一条命令里"安全管道段"和"不安全段"
// 互不拖累——例如 `ls a | grep x; rm -f f` 只归一化前者，rm 段保留由逐段分类处理。
function normalizeSafePipes(s) {
  if (!s.includes('|')) return s;
  const segs = splitSegments(s);
  return segs.map(seg => {
    if (!seg.includes('|') || seg.includes('||')) return seg;
    const parts = splitPipes(seg).filter(Boolean);
    if (parts.length > 1 && parts.every(isSegSafe)) {
      // 归一化后剥掉段首调用操作符 &，避免残留 & 触发 EXTERNAL_CALL 检查
      return parts.map(p => p.replace(/^&\s+/, '').trim()).join('; ');
    }
    return seg;
  }).join('; ');
}

// 判断是否存在"脚本块"：{} 出现在非边界段里才算。
// bash 命令组 { cmd1; cmd2; } 被 splitSegments 拆开后，{ 和 } 各自独立成段（纯边界，无副作用），
// 不算脚本块；而 ForEach-Object { ... } / if (...) { ... } 的 { 嵌在命令段内，算脚本块。
function hasScriptBlock(s) {
  return splitSegments(s).some(seg => /[{}]/.test(stripQuoted(seg)) && !/^[{}]$/.test(seg.trim()));
}

// 1. 复杂结构优先判定 → ask。带脚本块/控制流的命令，本质是"无法可靠分析"，
// 比管道/重定向等运算符更根本，故优先于下面的运算符检查（给出更准的 reason）。
// 用 stripQuoted 去掉引号内内容，避免把管道传入的 JSON 字符串（含 {}）误判为脚本块。
const cmdNoQuoted = stripQuoted(cmd);
if (LOOP_RE.test(cmdNoQuoted)) {
  const lm = cmdNoQuoted.match(/\b(for|foreach|while)\b\s*([^;{]*)/i);
  const detail = lm ? '：' + truncate((lm[1] + ' ' + (lm[2] || '')).trim(), 50) : '';
  decision('ask', REASON.ASK_LOOP, '⚠️ 循环体内存在无法可靠分析的操作' + detail + '，请人工审查');
  process.exit(0);
}
if (/[\r\n]/.test(cmd) || hasScriptBlock(cmd) || COMPLEX_RE.test(cmdNoQuoted)) {
  const cm = cmdNoQuoted.match(/\b(function|if|elseif|try|catch|switch|filter|trap|param|begin|process|end)\b/i);
  const detail = cm ? '：' + cm[1].toLowerCase() : (/[{}]/.test(cmdNoQuoted) ? '：脚本块 {}' : '');
  decision('ask', REASON.ASK_COMPLEX, '⚠️ 包含脚本块/控制流等复杂结构' + detail + '，无法自动分析，请人工审查');
  process.exit(0);
}

// 2. 剩余真运算符 → ask。cmd 已剥离无害重定向（2>&1、Out-File Temp）、归一化安全管道，
// 能走到这里的：管道=至少一段不在白名单；重定向=写文件到非白名单路径；&/命令替换=无法静态分析。
// 用 stripQuoted 去掉引号内内容，避免把 -Pattern "a|b" 这类引号内的 | <> 误判为运算符。
const normalizedForCheck = stripQuoted(cmd.split('&&').join(';').split('||').join(';'));
const opMatch = normalizedForCheck.match(/[|&`><]|\$\(/);
if (opMatch) {
  const op = opMatch[0];
  const opReason = op === '|' ? REASON.ASK_OPERATOR_PIPE
    : op === '>' || op === '<' ? REASON.ASK_FILE_WRITE
    : op === '&' ? REASON.ASK_EXTERNAL_CALL
    : REASON.ASK_OPERATOR_SUBST; // ` 或 $(
  const opText = op === '|' ? '⚠️ 管道中的命令存在不在白名单的操作'
    : op === '>' || op === '<' ? '⚠️ 命令包含写文件操作，未在白名单'
    : op === '&' ? '⚠️ 调用了外部程序，无法分析其行为'
    : '⚠️ 包含命令替换，无法静态分析';
  // 细化提示：定位具体段/目标，便于用户判断
  let detail = '';
  if (op === '|') {
    const bad = splitPipes(cmd).filter(p => p.trim() && !isSegSafe(p));
    if (bad.length) detail = '：' + bad.slice(0, 2).map(s => truncate(s.trim(), 50)).join('；') + (bad.length > 2 ? '…' : '');
  } else if (op === '>' || op === '<') {
    const wt = extractWriteTarget(cmd) || (() => { const m = cmd.match(/>>?\s+['"]?([^'">|;]+)['"]?/); return m ? { target: m[1].trim() } : null; })();
    if (wt && wt.target) detail = '：' + truncate(wt.target, 60);
  } else if (op === '&') {
    const m = cmd.match(/&\s+([^\s;|]+)/);
    if (m) detail = '：' + truncate(m[1], 50);
  } else if (op === '$(' || op === '`') {
    const sub = cmd.match(/\$\(([^)]*)\)|`([^`]*)`/);
    if (sub) detail = '：' + truncate(sub[1] || sub[2], 50);
  }
  decision('ask', opReason, opText + detail);
  process.exit(0);
}

// 3. 拆段并逐段分类：deny > safe > ask > allow > unknown
const segs = splitSegments(cmd);
const results = segs.map((seg, i) => {
  const segT = stripParens(seg); // 判定用去括号版本，日志仍保留原文 seg
  if (projLayer) {
    if (projLayer.mode === 'allow-all') return { kind: 'allow', seg, i, layer: '[项目级]', note: 'mode=allow-all' };
    const pd = firstMatch(projDeny, segT);
    if (pd) return { kind: 'deny', seg, i, layer: '[项目级]', rule: pd.rule };
    const pa = firstMatch(projAsk, segT);
    if (pa) return { kind: 'ask', seg, i, layer: '[项目级]', rule: pa.rule };
    const pw = firstMatch(projAllow, segT);
    if (pw) return { kind: 'allow', seg, i, layer: '[项目级]', rule: pw.rule };
    if (projLayer.mode === 'no-ask') return { kind: 'allow', seg, i, layer: '[项目级]', note: 'mode=no-ask' };
  }
  const d = firstMatch(denyRules, segT);
  if (d) return { kind: 'deny', seg, i, rule: d.rule };
  // 纯引号字符串字面量（管道喂给脚本的 stdin 数据）无副作用
  if (/^(['"]).*\1$/.test(segT)) return { kind: 'safe', seg, i };
  if (isSafeSegment(segT)) return { kind: 'safe', seg, i };
  // 删除目标命中 delete_allow（如 Temp）→ safe（多文件时全部命中才放行）
  let deleteBlocked = false;
  const dt = extractDeleteTarget(segT);
  if (dt) {
    const allAllowed = dt.targets.every(t => firstMatch(projDelete, t) || firstMatch(deleteRules, t));
    if (allAllowed) {
      for (const t of dt.targets) {
        const dm = firstMatch(projDelete, t) || firstMatch(deleteRules, t);
        if (dm) trackHit('delete_allow', dm.rule);
      }
      return { kind: 'safe', seg, i };
    }
    deleteBlocked = true; // 删除操作但目标未命中 delete_allow
  }
  // 写命令目标命中 write_allow（如 Temp）→ safe（cp/mv/touch/mkdir/tee/Copy-Item/New-Item/Set-Content...）
  const ct = extractWriteCommandTarget(segT);
  if (ct) {
    const cm = firstMatch(projWrite, ct.target) || firstMatch(writeRules, ct.target);
    if (cm) return { kind: 'safe', seg, i, wmRule: cm.rule };
  }
  const a = firstMatch(askRules, segT);
  if (a) return { kind: 'ask', seg, i, rule: a.rule };
  const w = firstMatch(allowRules, segT);
  if (w) return { kind: 'allow', seg, i, rule: w.rule };
  if (userLayer.mode === 'no-ask') return { kind: 'allow', seg, i, layer: '[用户级]', note: 'mode=no-ask' };
  if (userLayer.mode === 'allow-all') return { kind: 'allow', seg, i, layer: '[用户级]', note: 'mode=allow-all' };
  // 删除操作但未命中 delete_allow → 独立分类，与写文件 ASK_FILE_WRITE 对齐
  if (deleteBlocked) return { kind: 'del_block', seg, i, layer: '[默认]' };
  return { kind: 'unknown', seg, i, layer: '[默认]' };
});
// 收集逐段命中的规则（去重由 trackHit 内部 Set 完成）
for (const r of results) {
  if (r.rule) trackHit(r.kind === 'allow' ? 'allow' : r.kind, r.rule);
  if (r.dmRule) trackHit('delete_allow', r.dmRule);
  if (r.wmRule) trackHit('write_allow', r.wmRule);
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
  const label = r.kind === 'del_block' ? '删除目标不在白名单'
    : (r.layer ? r.layer + ' ' : '') + (r.kind === 'ask' ? '命中 ask 规则' : '不在白名单');
  return `第 ${r.i + 1} 段 [${truncate(r.seg, 50)}] ${label}`;
});
const more = bad.length > 3 ? `（另有 ${bad.length - 3} 段）` : '';
const aReason = bad[0].kind === 'ask' ? REASON.ASK_RULE
  : bad[0].kind === 'del_block' ? REASON.ASK_FILE_DELETE
  : REASON.ASK_UNKNOWN;
decision('ask', aReason, `⚠️ 需要确认：${badDesc.join('；')}${more}`);
