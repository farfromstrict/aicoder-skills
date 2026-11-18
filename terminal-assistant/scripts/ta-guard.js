#!/usr/bin/env node
/**
 * ta-guard.js — terminal-assistant 全局 PreToolUse 硬闸门（Node.js 版）
 *
 * （当前未注册到 settings.json，先写好放着。）
 *
 * 读取 stdin 上的 hook JSON（PreToolUse / Bash），对「把文本注入终端窗格」的调用：
 *   1. 判定是否为注入类载体（carrier）：
 *        tmux send-keys / pipe-pane、herdr pane run|send-text|send-keys、
 *        zellij write-chars|paste、hc send|keys、node ta.js send；
 *   2. 抽出被注入的字面文本（payload）；
 *   3. 结构化拆段（; && || | 换行，忽略引号内，括号逐层 unwrap 上限 8）；
 *   4. 逐段 + 整串匹配 L3 破坏性名单；
 *   5. 命中 L3 → 写审计 + stdout 原因 + exit 2（阻断）；否则 exit 0。
 *
 * 名单唯一真源：本文件 L3_PATTERNS。
 * 局限：变量 $CMD、base64/hex 混淆、heredoc、进程替换、双引号内展开、
 *       深层 bash -c 都可能绕过。纵深防御，不是沙箱。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const AUDIT_PATH = process.env.TA_GUARD_AUDIT || path.join(os.homedir(), '.codebuddy', 'ta-audit.jsonl');
const ALL_BASH = process.env.TA_GUARD_ALL_BASH === '1';
const MAX_UNWRAP = 8;

// ---------------------------------------------------------------- L0 只读白名单（仅审计定级）
const L0_PATTERNS = [
  /^ls(\s|$)/i, /^pwd\s*$/i, /^cat\s+[^|><;`$]/i, /^head(\s|$)/i, /^tail(\s|$)/i,
  /^less(\s|$)/i, /^more(\s|$)/i, /^file(\s|$)/i, /^stat(\s|$)/i, /^tree(\s|$)/i,
  /^(?:grep|rg|ag|ack)(\s|$)/i, /^find\s+[^|><;`$-]*$/i,
  /^(?:which|whoami|date|uptime|uname|hostname)(\s|$)/i,
  /^(?:ps|top|htop)(\s|$)/i,
  /^git\s+(?:status|log|diff|show|branch|ls-files|remote)(\s|$)/i,
  /^(?:wc|sort|uniq|cut|echo)(\s|$)/i,
  /^(?:df|du|free|lsof|ss|netstat)(\s|$)/i,
  /^cd(\s|$)/i,
];

// ---------------------------------------------------------------- L3 破坏性名单
// [regex, label]。L3 > L0。
const L3_PATTERNS = [
  [/\$\(/, '命令替换 $()'],
  [/`/, '命令替换 反引号'],
  [/\beval\b/i, 'eval'],
  [/\bexec\s/i, 'exec'],
  [/\b(?:bash|sh|zsh|fish|dash|ksh)\s+-c\b/i, '解释器 -c 逃逸'],
  [/\b(?:python[0-9.]*|perl|ruby|node|php)\s+-(?:c|e|E)\b/i, '解释器内联执行'],
  [/(?<!\|)\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|dash|ksh)\b/i, '管道到 shell'],
  [/\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash|zsh|fish)\b/i, 'curl/wget 管道到 shell'],
  [/\bfind\b[^\n]*-(?:exec|delete)\b/i, 'find -exec/-delete'],
  [/\bxargs\b[^\n]*\b(?:rm|sh|bash|kill|mv|dd)\b/i, 'xargs 接危险命令'],
  [/</, 'heredoc / herestring (<)'],           // 简化：< 一律可疑（guard 作用域窄）
  [/<\s*\(/, '进程替换 <()'],
  [/\b(?:source|\.)\s+\/dev\/(?:tcp|udp)\b/i, '网络文件执行'],
  [/:\(\)\s*\{/, 'fork bomb'],
  [/(?<=\s)&(?=\s|$)/, '独立 & 后台化'],
  [/>{1,2}\s*\/?(?:etc|dev|proc|sys|boot|root|usr)(?:\/|\s|$)/i, '重定向写系统目录'],
  [/>{1,2}\s*~?\/\.(?:bashrc|zshrc|profile|bash_profile|ssh|config|gitconfig|npmrc|env)\b/i, '重定向写 dotfile'],
  [/\brm\b[^\n]*\s-(?:[a-zA-Z]*[rR][a-zA-Z]*)\b/i, 'rm 递归删除'],
  [/\brm\b[^\n]*--recursive\b/i, 'rm --recursive'],
  [/\b(?:shred|mkfs(?:\.\w+)?|fdisk|parted|sfdisk|cfdisk)\b/i, '破坏性磁盘/文件命令'],
  [/\btruncate\b[^\n]*-s\s*0\b/i, 'truncate -s 0'],
  [/\bdd\b[^\n]*\bof=\/dev\//i, 'dd 写块设备'],
  [/\b(?:sudo|doas)\b/i, '提权'],
  [/\bsu\s/i, 'su'],
  [/\bchmod\b[^\n]*(?:\+x|a\+x|777)\b/i, 'chmod 提权/全开'],
  [/\bchown\b[^\n]*(?:-R|root)\b/i, 'chown -R/root'],
  [/\b(?:systemctl|service)\s+(?:stop|disable|mask)\b/i, '停/禁用服务'],
  [/\b(?:reboot|shutdown|halt|poweroff)\b/i, '关机/重启'],
  [/\binit\s+[016]\b/i, '改变运行级别'],
  [/\b(?:killall|pkill)\b/i, '批量杀进程'],
  [/\bkill\s+-(?:9|KILL)\b/i, '强制杀进程'],
  [/\bumount\s+\//i, 'umount 根路径'],
  [/\bfsck\b/i, 'fsck'],
  [/\bmount\b[^\n]*-o[^\n]*\brw\b/i, 'mount 可写重挂'],
  [/\biptables\s+-F\b|\bnft\s+flush\b/i, '清空防火墙规则'],
  [/\bcrontab\s+-r\b/i, 'crontab -r'],
  [/\b(?:apt|apt-get|yum|dnf|pacman|brew)\s+[^\n]*\b(?:remove|purge|autoremove|erase|uninstall)\b/i, '包卸载'],
  [/\bpacman\s+-R\b/i, 'pacman -R'],
  [/\b(?:npm|yarn|pnpm)\s+uninstall\s+-g\b/i, '全局包卸载'],
  [/\bdocker\s+(?:rm|rmi)\b[^\n]*-f\b/i, 'docker 强制删除'],
  [/\bdocker\s+system\s+prune\b[^\n]*-a\b/i, 'docker system prune -a'],
  [/\bdocker\s+compose\s+down\b[^\n]*-v\b/i, 'docker compose down -v'],
  [/\bkubectl\s+delete\b/i, 'kubectl delete'],
  [/\bgit\s+push\b[^\n]*(?:--force|\s-f\b)/i, 'git push --force'],
  [/\bgit\s+reset\b[^\n]*--hard\b/i, 'git reset --hard'],
  [/\bgit\s+clean\b[^\n]*-[fFdDxX]/i, 'git clean -f'],
  [/\bgit\s+branch\b[^\n]*-D\b/i, 'git branch -D'],
  [/\bgit\s+(?:checkout|restore)\s+\.\s*$/i, 'git checkout/restore .'],
  [/\bDROP\s+(?:DATABASE|TABLE)\b/i, 'SQL DROP'],
  [/\bTRUNCATE\b/i, 'SQL TRUNCATE'],
];

const CONTROL_KEYS = new Set(['Enter', 'C-c', 'C-d', 'C-z', 'Escape', 'Esc', 'Tab',
  'ctrl+c', 'ctrl+d', 'esc', 'enter', 'Space']);

// ---------------------------------------------------------------- 拆段
function maskSingleQuotes(s) { return s.replace(/'[^']*'/g, "''"); }

function unwrapOuter(s0) {
  let s = s0.trim();
  for (let k = 0; k < MAX_UNWRAP; k++) {
    if (!(s.startsWith('(') && s.endsWith(')'))) break;
    let depth = 0, closesAtEnd = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth === 0) { closesAtEnd = i === s.length - 1; break; } }
    }
    if (depth !== 0 || !closesAtEnd) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function splitSegments(s0) {
  const s = unwrapOuter(s0);
  const segs = []; let buf = ''; let depth = 0; let quote = null; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote && !(quote === '"' && i > 0 && s[i - 1] === '\\')) quote = null;
      i++; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; i++; continue; }
    if (ch === '(') { depth++; buf += ch; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; i++; continue; }
    if (depth === 0) {
      if (ch === ';' || ch === '\n') { segs.push(buf); buf = ''; i++; continue; }
      if (s.startsWith('&&', i) || s.startsWith('||', i)) { segs.push(buf); buf = ''; i += 2; continue; }
      if (ch === '|') { segs.push(buf); buf = ''; i++; continue; }
    }
    buf += ch; i++;
  }
  segs.push(buf);
  return segs.filter(x => x.trim()).map(unwrapOuter);
}

// 极简 shell 词法切分（够用于载体判定与 payload 抽取；不支持复杂转义）
function shlex(s) {
  const toks = []; let cur = ''; let quote = null; let i = 0;
  const push = () => { if (cur) { toks.push(cur); cur = ''; } };
  while (i < s.length) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; }
      else if (quote === '"' && ch === '\\' && i + 1 < s.length) { cur += s[++i]; }
      else cur += ch;
      i++; continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue; }
    if (/\s/.test(ch)) { push(); i++; continue; }
    cur += ch; i++;
  }
  push();
  return toks;
}

// ---------------------------------------------------------------- 载体识别
function isCarrier(t) {
  if (!t.length) return false;
  const head = t[0];
  const has = (a) => t.includes(a);
  if (head === 'tmux' && (has('send-keys') || has('pipe-pane'))) return true;
  if (head === 'herdr' && has('pane') && (has('run') || has('send-text') || has('send-keys'))) return true;
  if (head === 'zellij' && (has('write-chars') || has('paste') || has('send-keys'))) return true;
  if (head === 'hc' && (has('send') || has('keys'))) return true;
  // node ta.js send ... / node .../ta.js send ...
  if ((head === 'node' || head.endsWith('/node')) && t.some(x => /(?:^|[\\/])ta\.js$/.test(x)) && has('send')) return true;
  return false;
}

function payloadFrom(t) {
  let cand;
  const di = t.indexOf('--');
  if (di >= 0) cand = t.slice(di + 1);
  else if (t[0] === 'hc' && (t.includes('send') || t.includes('keys'))) cand = t.slice(3); // hc send <pane> <text>
  else if (t[0] === 'node' && t.some(x => /(?:^|[\\/])ta\.js$/.test(x))) {
    const si = t.findIndex(x => /(?:^|[\\/])ta\.js$/.test(x));
    cand = t.slice(si + 2); // ta.js send <pane> <text> → 跳过 ta.js 之后的 send 与 pane
  } else {
    // tmux send-keys / zellij write-chars：payload 是末尾若干参数，
    // 取最后 2 个（覆盖 "… <text> Enter"），过滤控制键与 flag 后剩下的即注入文本。
    cand = t.slice(-2);
  }
  return cand.filter(c => c && !c.startsWith('-') && !CONTROL_KEYS.has(c));
}

// ---------------------------------------------------------------- 定级 / 审计
function l3Hits(text) {
  const hits = [];
  for (const [rx, label] of L3_PATTERNS) if (rx.test(text)) hits.push(label);
  if (/\b(?:DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(text) && !/\bWHERE\b/i.test(text)) hits.push('无 WHERE 的 DELETE/UPDATE');
  return hits;
}

function audit(decision, level, reasons, cmd) {
  const line = {
    ts: new Date().toISOString(), decision, level, matched: reasons.slice(0, 8),
    cmd_sha256: crypto.createHash('sha256').update(cmd).digest('hex').slice(0, 16),
    cmd_preview: cmd.slice(0, 300).replace(/\n/g, ' '),
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_PATH, JSON.stringify(line) + '\n');
  } catch (_) {}
}

function deny(reasons, cmd, level = 'L3') {
  audit('deny', level, reasons, cmd);
  const reason = '[TA-GUARD] BLOCKED: ' + [...new Set(reasons)].join('; ');
  // PreToolUse 退出码 2 = 阻断；消息优先从 stdout 取（JSON reason 字段或纯文本）。
  console.log(JSON.stringify({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }));
  process.exit(2);
}
function allow(cmd, level = 'L2', engaged = true) {
  if (engaged) audit('allow', level, [], cmd);
  process.exit(0);
}

// ---------------------------------------------------------------- main
function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { deny(['hook 输入读取失败: ' + e.message], ''); }
  let hook;
  try { hook = JSON.parse(raw || '{}'); } catch (e) { deny(['hook 输入 JSON 解析失败: ' + e.message], ''); }
  const cmd = (hook.tool_input && hook.tool_input.command) || '';
  if (typeof cmd !== 'string' || !cmd.trim()) allow(cmd, 'L2', false);

  const segments = splitSegments(cmd);
  const segTokens = segments.map(shlex);
  const engaged = ALL_BASH || segTokens.some(isCarrier);
  if (!engaged) allow(cmd, 'L2', false);

  const candidates = []; // [text, label]
  candidates.push([cmd, 'outer-whole']);
  segments.forEach((seg, i) => {
    candidates.push([seg, 'outer-seg' + i]);
    const t = segTokens[i];
    if (isCarrier(t)) {
      for (const p of payloadFrom(t)) {
        candidates.push([p, 'payload']);
        for (const sub of splitSegments(p)) candidates.push([sub, 'payload-seg']);
      }
    }
  });

  const reasons = [];
  for (const [text, label] of candidates) {
    for (const hit of l3Hits(maskSingleQuotes(text))) reasons.push(label + ': ' + hit);
  }
  const uniq = [...new Set(reasons)];
  if (uniq.length) deny(uniq, cmd);

  const payloadSegs = candidates.filter(c => c[1] === 'payload-seg').map(c => c[0]);
  const level = payloadSegs.length && payloadSegs.every(p => L0_PATTERNS.some(rx => rx.test(p.trim()))) ? 'L0' : 'L2';
  allow(cmd, level);
}

try { main(); } catch (e) { deny(['hook 内部异常（fail-closed）: ' + e.message], ''); }
