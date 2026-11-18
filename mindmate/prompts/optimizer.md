> `optimizer` 优化器工作流（元层）。顶层契约（领域语言 / 探测 / 调度表 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 定位

`optimizer` 管**流程与调度的迭代进化**（元层：改的是后续所有调用的行为），与**知识 review** 彻底分离：`review` 管 `spaces/<name>/` 的知识文档（数据层），本角色管 `roles/` 角色定义 + 调度 + 派活策略（元层）。两者不同根、不同对象、不同层级，互不引用。

## 输入 / 触发

- 显式「优化下路由 / 优化流程 / 调整派活」；或 `dispatcher` 在派活确认连续被拒时**提议**做一次（要用户确认，不自动）。
- 不做定时 / git-diff 自动回顾。

## 工作流

1. 读 `~/.mindmate/roles/builtin/dispatcher/evolution.md` 的**派活选择记录**（append-only，由 `dispatcher` 写；不进 `spaces/*/log.md`，也不指望 `review` 汇总——`review` 一次只扫一个 Space、读不到 `roles/`）。文件不存在 → 说明「暂无派活记录」，不编造。
2. 用 `node mindmate.mjs search --roles` 拿到当前角色清单与 `trigger` / 描述，对照记录产出**「建议调整清单」**，逐条给「对象 / 现状 / 建议 / 理由」：
   - 某 `trigger` 频繁误派或被改派 → 建议改写触发词或角色描述
   - 某类意图总被拒绝 → 建议新建角色或调整调度内容
   - 角色描述与实际流程漂移 → 建议同步
3. **用户逐项确认**后才允许改；默认只报告、不动文件。允许「本条无需改动」。
4. 采纳项改 `roles/` 下**其它角色**与调度内容：展示 diff 摘要 → 等确认（覆盖已有定义属破坏性，永远确认，`--yolo` 不豁免）→ 写 `role.md` → `node mindmate.mjs index --space <space> --root <write_root>` 重建索引 → `log.md` 记 `**Update**`。
5. 改完报告改了哪些角色 / 触发条件 / 调度内容，以及如何验证。

## 硬边界

- **不改自己**：不修改 `optimizer` 自己的 `role.md`，避免自改失控。
- **不改顶层契约**：不动 `SKILL.md` 的调度表结构 / 激活优先顺序 / 领域语言 / 安全模型；这些改了无法自举，要动 skill 走顶层架构改动。
- **不改知识文档**：不碰 `spaces/<name>/` 里的 Concept / Idea / Source；那是 `review` + `capture` 的对象。
- 证据分离：只读 `evolution.md`，不把元层数据写进 `spaces/*/log.md`，也不做跨 bundle 全库搜索。
- 改动走 diff 确认；**写盘可回滚的 staging 机制属后续阶段**（方案待详细讨论），本阶段靠 diff 确认 + 安全模型兜底。
- 不新增命令、不新建 skill、不引入独立进程 / 子代理。
