> `role-creator` 建角器工作流。顶层契约（领域语言 / 探测 / 调度表 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 定位

`role-creator` 创建**用户级 / 项目级自定义角色**。一个角色 = 一个目录 + `role.md` + 可选 `rules/`，创建成本低、不新增概念。它覆盖所有根的自定义角色创建；`capture` **不再**承担角色创建（那是旧设计，已移出）。触发走 `dispatcher` 非确定路径（「建个 XX 角色」→ 提议 → 派活确认 → 激活），不新增命令。

## 输入 / 触发

「建个角色 / 新建角色 / 特化成 XX 模式 / 帮我配一个 TODO 角色」。

## 工作流

1. 按 `SKILL.md` 探测目标根，`node mindmate.mjs search --roles` 检查是否已有同名角色（避免重复）。
2. **确认定义**（逐项，信息不足就追问，不编造）：
   - **目标根**：按本文件「写目标根」段的 `write_root`（有项目 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`），写入该根的 `roles/custom/<slug>/`。默认不写共享根；若用户明确要团队共享此角色，走 `organize` 的「晋升」动作。
   - **`<slug>`**：可读小写（a-z / 0-9 / `-`）。
   - **`trigger`**：触发词，用 `/` 分隔；只 `roles/custom/` 参与 `trigger` 内容匹配。
   - **是否 `extends` 差分继承**某个普适角色：只写项目术语 / 字段 schema / Role Rules 差异。
   - **工作流动作**、**字段 schema**（frontmatter 字段名 / 取值 / 格式）、建议的 **Role Rules**。
3. **列写盘清单**（含目标根与完整路径）+ 复述拟落盘的 `role.md` 全文 → **写盘确认**（安全模型，先列后写；`--yolo` 不豁免新建这种破坏性动作）。已有同名角色走**更新或拒绝**，**不静默覆盖**。
4. 写 `roles/custom/<slug>/role.md`：
   ```
   ---
   type: Concept
   title: <角色名>
   description: <一句话>
   tags: [role]
   role: <slug>
   trigger: <触发词，用 / 分隔>
   target_space: inbox        # 仅写类 / 读兜底角色按需带；控制面角色省略此行
   status: stable
   ---
   ## 工作流
   <动作清单，如 add / list / done / reopen>
   ## 字段 schema
   <frontmatter 字段名、取值、格式>
   ```
   - **不列 rule 清单**：Role Rule 放 `roles/custom/<slug>/rules/`，靠目录反向索引，避免双写漂移。
   - 角色**不是**新 `type`、**不是**新 skill、**不新增命令**、不属于任何 Space；`target_space` **按需携带**——写类 / 读兜底角色带（表示产出落到哪个 Space / 兜底元信息），控制面角色不带。
5. 建议的 Role Rule 集合（每条 `type: Rule`，放 `rules/`，**默认不写 `scope`**）**逐条复述并等确认**后落盘。例：TODO 角色「完成只标 `state: done`，不删除文件」「`due` 用 ISO 8601 带 UTC 偏移」。任务文档用 `role: <slug>` 字段引用角色，不用跨 bundle Markdown 链接。
6. `node mindmate.mjs index --space <space> --root <write_root>` 重建 `index.md`；`log.md` 记 `**Creation**`。
7. 报告：slug、目标根、触发条件、`target_space`、建了哪些 Role Rule、如何试用（`mmt:ask --roles <slug>` 直接 Read 对应 `role.md`）。作废角色用 `status: deprecated`，**不删文件**。

## 硬约束

- **目标根写进确认**：写盘确认里必须明确将写入哪个根 / 路径。
- **不静默覆盖**同名角色；不作废就删文件。
- 角色文档**不列 rule 清单**；两类 Rule 靠目录区分（Domain Rule 在 `rules/`，Role Rule 在 `roles/*/<slug>/rules/`）。
- 不新建 skill、不新增第七个命令、不引入独立进程 / 子代理；角色不是新 `type`。
- 若角色产出需要新 Space，走 `space` 角色「判断是否需要新 Space」流程（说明 + 起名建议 + 确认），不静默建。
