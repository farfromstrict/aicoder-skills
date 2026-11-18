> `review` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。回顾是**显式触发的手动回顾**，不是定时任务。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 与 lint 的分工

- `mmt:lint` 只管**结构合规**（断链、`type` 缺失、`index.md` 不一致、Reference 指向不存在的 Master），纯机械、只报告。
- `mmt:review` 管**内容时效与知识演进**，需要 LLM 判断，产出「建议更新清单」。

## shelf 清理入口（用户主动触发）

用户明确「清理 shelf / 有没有能删的 Source / 整理待处置区」时，**本动作只出清单、不写盘**：跑 `node mindmate.mjs shelf --root <write_root>`（只读）把两组清单与断链告警并入「建议更新清单」，提醒用户逐条确认。**实际删除走 `mmt:organize` 的「shelf 清理」动作**（`shelf --drop`，破坏性、逐条确认）。不做定时 / 自动清理。判定口径见 `SKILL.md`「shelf 待处置区与清理」。

## repo 证据复核（用户主动触发，C3）

**仅当用户明确要求**（「复核下源码证据 / 检查 repo 引用是否还有效 / 证据有没有漂移」）才做本动作，**不并入常规每次回顾、不自动触发**。

1. 跑 `node mindmate.mjs repo-check --space <name> --root <write_root>`（只读、确定性）。它扫该 Space 所有 `repo://` 引用（`sources[].resource` 与正文链接），逐条报 `ok` / `missing`（文件不存在）/ `range`（行号越界）/ `no-project`（无项目根无法判定）/ `invalid-format`。
2. **判定口径是轻量的**：只查「文件存在 + 行号是否在文件当前行数内」，**不判定源码内容是否变化**（无版本基线、不依赖 git、不存哈希）。`no-project` 不算问题，如实说明「当前不在项目上下文、无法核对工作树」即可。
3. 把 `missing` / `range` / `invalid-format` 并入「建议更新清单」，每条给「文件 / 引用 / 问题 / 建议」：建议「重新核实该事实并重写引用」「确认源码已删则把该事实标 `status: deprecated` 退役」「修引用格式」等，**不自动改**。
4. **用户逐项确认后才允许改写**（沿用本角色纪律，删除/覆盖永远确认，`--yolo` 不豁免）。默认只报告。
5. 提示边界：源码内容变了但行号没变，本检查抓不到——如用户怀疑内容漂移，建议人工打开源码对照，或后续引入版本锚点（属后续演进）。

## 输入

`--space <name>`（默认 `inbox`）。本动作是**用户显式触发的手动回顾**，一次回顾一个 Space、逐项确认。`search` 缺省全库（读可跨 Space），但回顾清单按用户指定的 Space 产出，避免把全库整理变成自动批量动作。

## 步骤

1. 按 `SKILL.md` 探测 `spaces/` / Space，读 `index.md` 与该 Space 下的 Concept / Idea（可只读 frontmatter + `## 待确认` 段以省上下文）。
2. 产出**建议更新清单**，逐条给出「文件 / 现状 / 建议 / 理由」：
   - `stale_after` 已过期 → 建议重新核实或续期（**含 Rule 文档**：规则也会过期）
   - `status: draft` 已久 → 建议升 `stable` 或补充
   - **`type: Idea` 积压**：列出待探索项，建议「探索出结论后用 `mmt:organize` 就地转为 Concept」或「确认无价值后标 `status: deprecated` 并留在原地（废弃结论归 `shelf/deprecated/`，由清理动作处理）」；**不自动改写、不自动删除**
   - `## 待确认` 中的争议/积压
   - 新 Source 与已有 Concept 该**合并还是拆分**（一条内容只应有一个 canonical home）
   - 孤立 Concept（没有 `## 关联`、也没被别的页链接）
   - 相互冲突或已不适用的 Rule → 建议改 `status: deprecated`（列出冲突，`不自行裁决`）
   - `repo://` 证据是否失效：**仅用户主动要求时**按上文「repo 证据复核」动作跑 `repo-check`，不纳入常规清单

查看「当前生效规则清单」请用 `/mmt:ask --rules`，不在本命令重复列举。
3. **用户逐项确认后才允许改写**。默认只报告、不动文件。允许「本条无需改动」。
4. 采纳的改动按 `capture` 角色的骨架执行；遵守「只改受影响页、允许 no-op、不做纯格式改动、争议事实不靠时间新近度裁决」。
5. 需要长期留存的**待探索开放问题**：按 `type: Idea` 骨架落 `concepts/<slug>.md`（`status: draft` + `tags: [backlog]`），不引入新的保留文件名；任务型待办仍走 `role: todo` 角色。
6. 运行 `node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`；把本次回顾结果记入 `log.md`。

## 硬约束

- 覆盖/删除 Concept 属破坏性，**永远确认**，即使 `--yolo`。
- 不做定时调度、git-diff 增量更新（后续演进项）。
- 不做定时 / 自动批量全库整理；要回顾别的 Space 请用户再跑一次并换 `--space`（读本身可跨 Space，但回顾动作按 Space 逐次显式触发）。
