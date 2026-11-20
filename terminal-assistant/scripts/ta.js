#!/usr/bin/env node
/**
 * ta.js — terminal-assistant 统一 CLI
 *
 * 子命令：
 *   probe                    产出身份 + 本屏幕 az/ez/wz 映射（供 SKILL.md 内联加载）
 *   read   <pane> [lines]    读 pane 视口/历史（各后端坑内置）
 *   send   <pane> <text>     注入文本+回车（--force/--if；--wait 已废弃）
 *   wait   <pane> --match X  标记轮询：反复读屏幕直到出现 X（不依赖 hc turn/status）
 *
 * probe 只读无副作用。read 只读。send/wait 会写/监听窗格 ——
 * 安全由外部 guard hook 负责（本脚本不内置拦截）。
 *
 * 全局参数：--json / --no-color
 * 环境：Node.js（本机 v22），不依赖 jq / python。
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 参数 / 颜色
const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const NO_COLOR = args.includes('--no-color') || !process.stdout.isTTY;
const C = NO_COLOR
  ? { b: '', d: '', g: '', y: '', r: '' }
  : { b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[0m' };

function run(cmd, argv, timeout = 5000) {
  try {
    return execFileSync(cmd, argv, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return '';
  }
}
function runSh(cmd, timeout = 5000) {
  try {
    return execFileSync('sh', ['-c', cmd], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    return '';
  }
}
function out(line = '') { process.stdout.write(line + '\n'); }
function hline() { out('-'.repeat(60)); }
function head(t) { out(`\n${C.b}=== ${t} ===${C.r}`); }

// ---------------------------------------------------------------- 1. 自证身份
function envHits() {
  const e = process.env;
  const hits = [];
  if (e.HC_TERMINAL_ID) hits.push('hc');
  if (e.HERDR_ENV === '1') hits.push('herdr');
  if (e.TMUX) hits.push('tmux');
  if (e.ZELLIJ) hits.push('zellij');
  return hits;
}

// 进程链：comm/args 推断后端；返回从近到远的链 + 最内层后端
function processChain() {
  const chain = [];
  let pid = process.pid;
  for (let i = 0; i < 24 && pid > 1; i++) {
    const ps = run('ps', ['-o', 'ppid=,comm=,args=', '-p', String(pid)]).trim();
    if (!ps) break;
    const m = ps.match(/^(\d+)\s+(\S+)\s+(.*)$/s);
    if (!m) break;
    const [, ppid, comm, args] = m;
    chain.push({ pid: Number(pid), ppid: Number(ppid), comm, args: args.slice(0, 60) });
    pid = Number(ppid);
  }
  return chain;
}

function classify(comm, args) {
  const s = `${comm} ${args}`.toLowerCase();
  if (s.includes('herdr-core') || s.includes('herdr_core')) return 'hc';
  if (s.includes('tmux')) return 'tmux';
  if (s.includes('zellij')) return 'zellij';
  if (s.includes('herdr')) return 'herdr';
  return '';
}

function resolveIdentity() {
  const hits = envHits();
  const chain = processChain();
  let chainBackend = '';
  for (const node of chain) {
    const b = classify(node.comm, node.args);
    if (b) { chainBackend = b; break; } // 从近到远第一个 = 最内层
  }
  const e = process.env;
  const selfId = {
    hc: e.HC_TERMINAL_ID || '',
    herdr: e.HERDR_PANE_ID || '',
    tmux: e.TMUX_PANE || '',
    zellij: e.ZELLIJ_SESSION_NAME || '',
  };

  let backend = '', status = 'ok', note = '';
  // 原则：进程链是唯一真相。环境变量会被父进程（herdr-core server）继承，
  //      出现 HC_TERMINAL_ID 不代表当前在 hc 里 —— 只用它取 self ID。
  if (chainBackend) {
    backend = chainBackend;
    const others = hits.filter(h => h !== backend);
    note = others.length
      ? `进程链确定为 ${backend}；变量 [${hits.join(' ')}] 中 ${others.join(' ')} 为继承/无关，忽略`
      : `进程链与变量一致：${backend}`;
  } else if (hits.length === 1) {
    // 进程链无特征（如 Git Bash 的 ps 不兼容）→ 回退唯一变量
    backend = hits[0];
    note = `进程链未识别到后端，采信唯一变量 ${backend}`;
  } else if (hits.length === 0) {
    status = 'unknown';
    note = '进程链与变量均无后端特征：普通 shell / 会话外';
  } else {
    status = 'ambiguous';
    note = `进程链无特征且变量多命中：[${hits.join(' ')}]，无法裁决`;
  }
  return { hits, chain, chainBackend, backend, status, note, self: selfId[backend] || '' };
}

// ---------------------------------------------------------------- 2. 采集 pane + 3. 分角色
// 统一 pane 对象：{ id, cwd, title, x, y, w, h, self, markedRole }
function assignRoles(panes) {
  // panes: 本屏幕的 pane 数组（含几何）。按几何分 az(左) / ez(右上) / wz(右下)。
  // 标记 ta-ezN / ta-wzN 优先；否则按几何；无几何则按列出顺序临时编号。
  const self = panes.find(p => p.self);
  const withGeo = panes.every(p => p.x != null && p.y != null);
  const result = {};

  if (withGeo && panes.length) {
    const xs = panes.map(p => p.x), maxX = Math.max(...xs), minX = Math.min(...xs);
    const colWidth = (maxX - minX);
    const left = panes.filter(p => p.x === minX);
    const right = panes.filter(p => p.x > minX);
    // 左列 = az（self 所在列）；多列时最左列整体算 az 区
    left.forEach((p, i) => { result[p.id] = left.length === 1 ? 'az' : `az${i + 1}`; });
    // 右列按 y 分上下：上半 ez、下半 wz
    if (right.length) {
      const ys = right.map(p => p.y), minY = Math.min(...ys), maxY = Math.max(...ys);
      const upper = right.filter(p => p.y <= (minY + maxY) / 2).sort((a, b) => a.x - b.x);
      const lower = right.filter(p => p.y > (minY + maxY) / 2).sort((a, b) => a.x - b.x);
      upper.forEach((p, i) => { if (!result[p.id]) result[p.id] = `ez${i + 1}`; });
      lower.forEach((p, i) => { if (!result[p.id]) result[p.id] = `wz${i + 1}`; });
    }
  } else {
    // 无几何：self=az；其余按列出顺序轮转 ez/wz，用独立计数器（不含 self），编号从 1 起
    let n = 0;
    for (const p of panes) {
      if (p.self) { result[p.id] = 'az'; continue; }
      const isEz = (n % 2 === 0);        // 第 1/3/5... 个非 self → ez；第 2/4/6... → wz
      const num = Math.floor(n / 2) + 1; // 同区编号从 1 起
      result[p.id] = (isEz ? 'ez' : 'wz') + num;
      n++;
    }
  }

  // 标记优先覆盖
  for (const p of panes) {
    const m = /(?:^|[\s/])(ta-(?:ez|wz)\d+)/.exec(p.title || '');
    if (m) result[p.id] = m[1].replace('ta-', '').replace(/(\d+)/, '$1'); // ezN/wzN
  }
  return result;
}

function collectHc(self) {
  // hc ls → JSON；docs.json 布局树给出 terminal 分区。self 所在 tab = 本屏幕。
  const lsRaw = run('hc', ['ls', '--json']);
  let terms = [];
  try { terms = JSON.parse(lsRaw).terminals || []; } catch (_) {}
  const selfTerm = terms.find(t => t.address === self);
  const where = selfTerm ? selfTerm.where : '';
  const selfInfo = hcGetInfo(self);
  // 本屏幕 = 与 self 同 space+tab 的窗格。where 只是显示名，不同 space 可重名
  // （如本机与 WSL 都叫 aitalk / 1），不能用它判定，否则会跨 space 误收窗格。
  const screen = selfInfo.space && selfInfo.tab
    ? terms.filter(t => {
        const info = hcGetInfo(t.address);
        return info.space === selfInfo.space && info.tab === selfInfo.tab;
      })
    : terms.filter(t => t.where === where); // labels 缺失时回退旧逻辑

  // 布局树：从 docs.json 找 self 所在 tab 的 root，按递归方向给 terminal 标 role
  // 路径因平台而异：
  //   WSL/Linux: ~/.local/state/herdr-core/default/docs.json
  //   Windows(Git Bash 的原生 node): %LOCALAPPDATA%\herdr-core\default\docs.json
  //   从 WSL 侧访问 Windows: /mnt/c/Users/<解析自 LOCALAPPDATA>/AppData/Local/...
  let layoutRoles = {};
  const home = process.env.HOME || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const pathCandidates = [`${home}/.local/state/herdr-core/default/docs.json`];
  if (localAppData) {
    // Windows 原生：C:\Users\x\AppData\Local
    const winPath = path.join(localAppData, 'herdr-core', 'default', 'docs.json');
    pathCandidates.push(winPath);
    // WSL 侧访问同一位置：C:\Users\x\AppData\Local -> /mnt/c/Users/x/AppData/Local
    const m = localAppData.match(/^([A-Za-z]):[\\/](.*)$/);
    if (m) pathCandidates.push(`/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}/herdr-core/default/docs.json`);
  }
  // 兜底：常见用户名（仅当上面都失败；不硬编码，从 USERPROFILE 推导）
  const userProfile = process.env.USERPROFILE || '';
  if (userProfile) pathCandidates.push(path.join(userProfile, 'AppData', 'Local', 'herdr-core', 'default', 'docs.json'));
  const candidates = pathCandidates;
  let docs = null, docsPath = '';
  for (const p of candidates) {
    try { docs = JSON.parse(fs.readFileSync(p, 'utf8')); docsPath = p; break; } catch (_) {}
  }
  try {
    if (!docs) throw new Error('docs.json not found');
    const app = (docs['herdr-app'] || {}).value || {};
    for (const sp of app.spaces || []) {
      for (const tb of sp.tabs || []) {
        if (tb.root) {
          collectHcRoles(tb.root, '', layoutRoles);
        }
      }
    }
  } catch (_) {}

  const panes = screen.map(t => {
    const info = hcGetInfo(t.address);
    return {
      id: t.address, cwd: info.cwd || t.cwd || '', title: t.where || '', self: t.address === self,
      isAgent: info.isAgent,
    };
  });
  // hc 的 docs.json 没有几何坐标，用布局树角色覆盖
  let roles = assignRoles(panes);
  let hasLayoutRole = false;
  for (const t of terms) {
    if (layoutRoles[t.address]) {
      roles[t.address] = layoutRoles[t.address];
      if (screen.some(s => s.address === t.address)) hasLayoutRole = true;
    }
  }
  return { panes, roles, screen: where, source: hasLayoutRole ? 'hc ls + docs.json(布局树)' : 'hc ls(无布局树,顺序编号)' };
}

// 递归解析 hc 布局树：root/children，方向 row→左右、column→上下
function collectHcRoles(node, prefix, acc) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'block' && node.content && node.content.terminal) {
    acc[node.content.terminal] = normalizeRole(prefix);
    return;
  }
  (node.children || []).forEach((ch, i) => {
    let dir = '';
    if (node.type === 'row') dir = i === 0 ? 'L' : 'R';       // row: 0=左 1=右
    else if (node.type === 'column') dir = i === 0 ? 'U' : 'D'; // column: 0=上 1=下
    collectHcRoles(ch, prefix + dir, acc);
  });
}
function normalizeRole(prefix) {
  // L=左=az；R+U=右上=ez；R+D=右下=wz。数字按出现顺序补。
  if (prefix.startsWith('L')) return 'az';
  if (prefix.startsWith('RU')) return 'ez1';
  if (prefix.startsWith('RD')) return 'wz1';
  return 'other';
}

function collectHerdr(self) {
  const raw = run('herdr', ['api', 'snapshot']);
  let snap;
  try { snap = JSON.parse(raw).result.snapshot; } catch (_) { return { panes: [], roles: {}, screen: '', source: 'herdr snapshot 解析失败' }; }
  const selfPane = (snap.panes || []).find(p => p.pane_id === self);
  const tabId = selfPane ? selfPane.tab_id : snap.focused_tab_id;
  const panes = (snap.panes || []).filter(p => p.tab_id === tabId);
  const layout = (snap.layouts || []).find(l => l.tab_id === tabId);
  const rectMap = {};
  (layout && layout.panes || []).forEach(lp => {
    rectMap[lp.pane_id] = { x: lp.rect.x, y: lp.rect.y, w: lp.rect.width, h: lp.rect.height };
  });
  const unified = panes.map(p => {
    const r = rectMap[p.pane_id] || {};
    return {
      id: p.pane_id, cwd: p.cwd || '', title: p.terminal_title || '',
      self: p.pane_id === self, x: r.x, y: r.y, w: r.w, h: r.h,
    };
  });
  return { panes: unified, roles: assignRoles(unified), screen: tabId, source: 'herdr api snapshot' };
}

function collectTmux(self) {
  const fmt = '#{pane_id}|#{pane_left}|#{pane_top}|#{pane_width}|#{pane_height}|#{pane_current_path}|#{pane_title}|#{session_name}:#{window_index}';
  const raw = run('tmux', ['list-panes', '-a', '-F', fmt]);
  const lines = raw.split('\n').filter(Boolean).map(l => l.split('|'));
  const selfLine = lines.find(f => f[0] === self);
  const screen = selfLine ? selfLine[7] : '';
  const panes = lines.filter(f => !screen || f[7] === screen).map(f => ({
    id: f[0], x: +f[1], y: +f[2], w: +f[3], h: +f[4],
    cwd: f[5] || '', title: f[6] || '', self: f[0] === self,
  }));
  return { panes, roles: assignRoles(panes), screen, source: 'tmux list-panes' };
}

function collectZellij(self) {
  const raw = run('zellij', ['action', 'list-panes']);
  // zellij 输出格式随版本变化，尽力解析：每行取第一个 token 作 id
  const panes = raw.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
    const id = (l.match(/^(\S+)/) || [])[1] || `p${i}`;
    return { id, cwd: '', title: l.slice(0, 60), self: id === self };
  });
  return { panes, roles: assignRoles(panes), screen: process.env.ZELLIJ_SESSION_NAME || '', source: 'zellij list-panes' };
}

// ---------------------------------------------------------------- 4. 输出
function render(id, info) {
  if (AS_JSON) {
    out(JSON.stringify({
      backend: id.backend, self: id.self, status: id.status, note: id.note,
      screen: info ? info.screen : '', source: info ? info.source : '',
      panes: (info ? info.panes : []).map(p => ({
        role: (info.roles[p.id] || '?'), id: p.id, self: p.self, cwd: p.cwd, title: p.title,
        isAgent: !!p.isAgent,
      })),
    }, null, 2));
    return;
  }
  head('身份');
  out(`  ${C.d}backend${C.r} : ${C.g}${id.backend || '(none)'}${C.r}`);
  out(`  ${C.d}self${C.r}    : ${id.self || '(none)'}`);
  out(`  ${C.d}命中${C.r}    : [${id.hits.join(' ')}]  进程链最内层：${id.chainBackend || '(none)'}`);
  if (id.note) out(`  ${C.d}说明${C.r}    : ${id.note}`);
  if (id.status !== 'ok') {
    out(`\n  ${C.y}状态：${id.status} —— 按 SKILL.md 异常分支处理，不硬猜${C.r}`);
    hline();
    return;
  }

  if (!info || !info.panes.length) {
    out(`\n  ${C.y}未采集到 pane（source=${info ? info.source : 'n/a'}）${C.r}`);
    hline();
    return;
  }
  head('本屏幕 pane');
  out(`  ${C.d}screen${C.r}  : ${info.screen || '(n/a)'}`);
  out(`  ${C.d}source${C.r}  : ${info.source}`);
  out('');
  // 受众是加载 SKILL 的 LLM：一行一窗格、key=value、无截断，避免残缺信息误导。
  const order = { az: 0, ez1: 1, wz1: 2 };
  const sorted = [...info.panes].sort((a, b) => {
    const ra = info.roles[a.id] || 'zz', rb = info.roles[b.id] || 'zz';
    return (order[ra] ?? 9) - (order[rb] ?? 9) || String(a.id).localeCompare(String(b.id));
  });
  for (const p of sorted) {
    const role = info.roles[p.id] || '?';
    const rc = role === 'az' ? C.y : C.g;
    out(`  ${rc}${role}${C.r}  id=${p.id}  self=${p.self ? 'YES' : 'no'}  agent=${p.isAgent ? 'agent' : 'shell'}  cwd=${p.cwd}  title=${p.title}`);
  }
  out(`\n  ${C.d}注${C.r}：无 ta-ezN/ta-wzN 标记时为几何/顺序临时编号；写只在本屏幕，跨屏只读。`);
  hline();
}

// ---------------------------------------------------------------- read / send / wait
// 各后端命令封装，坑内置（herdr 必须 --source visible；文本与回车原子化等）。
function backendOf() { return resolveIdentity().backend; }

function cmdRead(id, pane, lines, extra) {
  const L = lines || 0;
  switch (id.backend) {
    case 'hc': return ['hc', ['read', pane, '--lines', String(L)]];
    case 'herdr': return ['herdr', ['pane', 'read', pane, '--source', 'visible', '--lines', String(L)]];
    case 'tmux': return ['tmux', ['capture-pane', '-p', '-t', pane, '-S', String(-L)]];
    case 'zellij': return ['zellij', ['action', 'dump-screen', '-p', pane]];
    default: throw new Error('read: 未知后端 ' + id.backend);
  }
}

function cmdSend(id, pane, text, opts) {
  switch (id.backend) {
    case 'hc': {
      const a = ['send', pane, text];
      if (opts.force) a.push('--force');
      if (opts.ifStatus) a.push('--if', opts.ifStatus);
      // 不再透传 --wait：hc 的 turn 状态对裸 shell 不可靠（见 wait 的标记轮询实现）。
      return ['hc', a];
    }
    case 'herdr': return ['herdr', ['pane', 'run', pane, text]]; // 原子：文本+Enter
    case 'tmux': return ['tmux', ['send-keys', '-t', pane, text, 'Enter']]; // 文本与回车分开传
    case 'zellij': return ['zellij', ['action', 'write-chars', text]];
    default: throw new Error('send: 未知后端 ' + id.backend);
  }
}

// wait 统一走标记轮询（见 main 的 wait 分支）：反复 cmdRead 屏幕找标记。
// 不调用 hc wait / herdr wait-output —— 它们依赖 agent turn / 内部状态机，
// 对裸 shell 不可靠（turn 不上报 → 一直挂到超时）。

function runLive(cmd, argv) {
  try {
    const r = execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 300000 });
    return r;
  } catch (e) {
    // 工具非零退出也把已产出内容透传
    if (e.stdout) return e.stdout;
    throw e;
  }
}

// 一次 hc get 拿全一个 pane 的元信息：是否 agent、实时 cwd、space/tab ID。
// - isAgent：agent 有 status 对象或 turn>0，裸 shell 为 null/0。不用 agent 字段
//   判断——它是启动程序名，裸 shell 也显示 bash.exe。
// - cwd：foreground.cwd 是实时工作目录；顶层 cwd 是启动快照（会滞后于 cd）。
// - space/tab：来自 labels，是判定"本屏幕"的唯一可靠依据（where 显示名会重名）。
function hcGetInfo(pane) {
  let j = null;
  try {
    j = JSON.parse(runLive('hc', ['get', '--json', pane]));
  } catch (_) {}
  const labels = (j && j.labels) || {};
  return {
    isAgent: !!(j && (j.status != null || (j.turn || 0) > 0)),
    cwd: (j && j.foreground && j.foreground.cwd) || (j && j.cwd) || '',
    space: labels['herdr.space'] || '',
    tab: labels['herdr.tab'] || '',
  };
}

function hcIsAgent(pane) {
  return hcGetInfo(pane).isAgent; // 查不到 → isAgent=false，按裸 shell 处理（用 raw 最安全）
}

function parseOpts(rest) {
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') o.force = true;
    else if (a === '--wait') o.wait = true;
    else if (a === '--raw') o.raw = true;
    else if (a === '--if') o.ifStatus = rest[++i];
    else if (a === '--match') o.match = rest[++i];
    else if (a === '--regex') o.regex = rest[++i];
    else if (a === '--timeout') o.timeout = parseInt(rest[++i], 10);
  }
  return o;
}

// ---------------------------------------------------------------- main（子命令分发）
function main() {
  const argv = args.filter(a => a !== '--json' && a !== '--no-color');
  const sub = argv[0] || 'probe';
  const rest = argv.slice(1);

  if (sub === 'probe') {
    const id = resolveIdentity();
    let info = null;
    if (id.status === 'ok') {
      switch (id.backend) {
        case 'hc': info = collectHc(id.self); break;
        case 'herdr': info = collectHerdr(id.self); break;
        case 'tmux': info = collectTmux(id.self); break;
        case 'zellij': info = collectZellij(id.self); break;
      }
    }
    render(id, info);
    return;
  }

  const id = resolveIdentity();
  if (id.status !== 'ok') {
    out(`ERROR: 后端判定失败（${id.status}）：${id.note}`);
    process.exit(2);
  }

  if (sub === 'read') {
    const pane = rest[0];
    if (!pane) { out('用法: ta.js read <pane> [lines]'); process.exit(2); }
    const [cmd, a] = cmdRead(id, pane, parseInt(rest[1], 10) || 0, parseOpts(rest.slice(2)));
    process.stdout.write(runLive(cmd, a));
    return;
  }

  if (sub === 'send') {
    const pane = rest[0], text = rest[1];
    if (!pane || text == null) { out('用法: ta.js send <pane> <text> [--raw] [--force] [--if idle|working]'); process.exit(2); }
    const opts = parseOpts(rest.slice(2));
    if (opts.wait) process.stderr.write('提示: --wait 已废弃（hc 的 turn 状态对裸 shell 不可靠）；同步等待请用 wait --match <唯一标记>\n');
    // 裸 shell 不认识 <hc> 包装（< 被当重定向符），自动去包装；agent 保留包装。
    // --raw 可强制去包装。
    const wantRaw = !!opts.raw || (id.backend === 'hc' && !hcIsAgent(pane));
    if (wantRaw) delete process.env.HC_TERMINAL_ID;
    const [cmd, a] = cmdSend(id, pane, text, opts);
    const raw = runLive(cmd, a);
    // hc send 原样返回 {"started":..,"status":..,"turn":..}：对裸 shell 恒为
    // false/null/0，容易被误读成"没发出去"。成功判据是随后 read 回读，故精简为
    // 一句确认；非 JSON（错误文本）则原样透传，不丢诊断信息。
    let sent = false;
    try { JSON.parse(raw); sent = true; } catch (_) {}
    if (sent) out(`sent → ${pane}`);
    else process.stdout.write(raw);
    return;
  }

  if (sub === 'wait') {
    const pane = rest[0];
    if (!pane) { out('用法: ta.js wait <pane> --match <text> | --regex <pat> [--timeout ms]'); process.exit(2); }
    const opts = parseOpts(rest.slice(1));
    const pat = opts.regex ? new RegExp(opts.regex) : null;
    const needle = opts.match || '';
    if (!pat && !needle) {
      out('wait: 需要 --match <text> 或 --regex <pat>；建议用唯一标记（如 __TA_done_<id>__），避免命中历史输出');
      process.exit(2);
    }
    // 标记轮询：反复读屏幕找标记，不依赖任何终端状态机。
    const deadline = Date.now() + (opts.timeout || 120000);
    let last = '';
    while (Date.now() < deadline) {
      const [c, a] = cmdRead(id, pane, 200, {});
      last = runLive(c, a);
      if (pat ? pat.test(last) : last.includes(needle)) { process.stdout.write(last); return; }
      execFileSync('sleep', ['0.2']);
    }
    process.stdout.write(last);
    out('\n(wait 超时)');
    process.exit(1);
  }

  out('未知子命令: ' + sub + '（可用: probe/read/send/wait）');
  process.exit(2);
}

// 被 require 时不执行 main，便于测试导出函数；作为 CLI 直接运行时行为不变。
if (require.main === module) main();

module.exports = { render, assignRoles, collectHcRoles, normalizeRole, hcGetInfo };
