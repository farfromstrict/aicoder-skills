> `organize` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。用于用户想把某个 Source 重新提炼、合并/拆分已有 Concept，或把某条 Idea **探索完成后就地转变为 Concept** 时。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 输入

`--space <name>` 与一个目标：Idea 文件名，或 `--query "<描述>"`；也可给 Source 文件名（在 `shelf/sources/`）。未指定 Space 用 `inbox`。

## 步骤

1. 按 `SKILL.md` 探测 `spaces/` / `shelf/` 与目标 Space，读该 Space 的 `index.md` 定位目标文件。
2. 读目标 Source 的**原样正文**（在 `shelf/sources/`，顺着 Concept 的 `sources[].resource` 找）与其派生的 Concept（`sources[].id` / `## 出处`）。
3. **先规划，不直接写**：
   - 写盘确认前先跑**全库** `node mindmate.mjs search --query "<主题>"`（不带 `--space`，读可跨 Space）拿同名 / 同 tag 候选，「是否同一知识」由 LLM 在写盘确认环节判定（脚本只给候选、不做语义裁决）。
   - 是否已有 canonical home？有 → 就地**更新该 Concept**（必要时走「跨 Space 迁移」把归属理顺），**不新建副本**（写单归属）；无 → 才新建。
   - 是否该**合并**（多个 Concept 讲同一件事）或**拆分**（一个 Concept 混了多个主题）？把建议列给用户。
4. 按 `capture` 角色「步骤（知识摄入）」第 4 步的骨架重写 Concept：描述、事实/推断分标、`## 关联`、`## 出处`、`## 待确认`。
5. **更新只改受影响页**：允许 no-op；不做纯格式改动；争议事实放 `## 待确认`，不靠时间新近度裁决。
6. **Reference / Master**：若被整理的 Concept 是 Master（被其它 Space 的 Reference 指向），**不要改文件名或路径**；如必须改名，同步更新所有 Reference 的 `resource` 并跑 `node mindmate.mjs lint`。Reference 存根本身不需要随 Master 内容更新（它不复制内容）。
7. 运行 `node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`；在 `log.md` 追加 `**Update**` 条目。
8. 按 `SKILL.md` 安全模型，改写前展示 diff 摘要并等确认（覆盖已有 Concept 属破坏性，永远确认）。

## 就地转变（按注册表 transitions）

当目标文档要**就地转变 type**（最常见是 `type: Idea` 探索出结论转 `Concept`）、用户表示已有结论时，走本流程。**同一文件改写**，不新建文档、不另建 Source、不改文件名。

1. 读该文档的 `## 待确认` 原文条目与 `## 出处`；必要时用 `--where type=Idea` 枚举待探索项。
2. **查注册表判断合法转变目标**（不硬编码 `Idea → Concept`）：读用户数据 `~/.mindmate/types.yaml`，取当前 `type` 的 `transitions` 槽位；**转变目标必须是该列表里的一个值**（如 `Idea.transitions: [Concept]` → 允许转 `Concept`）。注册表缺失 / 损坏 / 当前 type 无 `transitions` 或目标不在列表里 → **停止**，说明「注册表未声明此转变」并让用户先修注册表或放弃，**不硬转、不猜目标**。槽位是封闭的，不能凭空造新目标。
3. **先规划，不直接写**：逐条列出「哪些条目已有可确认结论（写成事实 / 推断分标）」「哪些仍未决（保留在 `## 待确认`）」「`## 关联` 怎么补到至少两个其它 Concept」；信息不足就追问，**不编造**。
4. 展示 diff 摘要并等确认（覆盖已有文档属破坏性，**永远确认**，`--yolo` 不豁免）。
5. 改写 frontmatter：`type` 改为第 2 步确认的合法目标值；`status` 由 `draft` 按结论可靠度定 `draft` / `stable`；`description` 改为一句话结论摘要。
6. 按 `capture` 角色「步骤（知识摄入）」第 5 步的 Concept 骨架重写正文；**保留原 `sources[]` 与 `## 出处` 的 `[^s1]`**（`lint` 仍会校验），不新建 Source。
7. 运行 `node mindmate.mjs index --space <name> --root <write_root>`；`log.md` 记 `**Update**`，注明 `Idea → <目标 type>` 与来源 Source。

## 晋升（单文档 local → shared）

用户明确「把这条晋升到团队共享 / 发布到 `.mindmate`」时走本流程。**这是显式动作，不是默认**；一次晋升**一个文档**。

1. 先跑 `node mindmate.mjs roots` 确认 `scope=project`（无项目根 → 说明「当前无项目可晋升」并停止）、拿到 shared / local 两根。
2. 确认待晋升文档在 **local 根**的某 Space 下（`<repo>/.mindmate.local/spaces/<space>/...`）；来源只能是 local，不能从 global 直接晋升。
3. **写盘确认**（破坏性、永远确认，`--yolo` 不豁免），确认信息必须写明：**将移动哪个文档、从 local 到 shared、local 会删除、两边 index 会重建、共享根会进 git**。提醒「共享根一旦 push，本地回滚撤不回外发」。
4. 先 `node mindmate.mjs promote <file>`（dry-run，展示将移动 / 删除 / 重建），确认无误后 `node mindmate.mjs promote <file> --apply`。脚本做：shared 新建 + local 删除（**移动非复制**）+ 重建两边 `index.md`。
5. 报告晋升结果；若目标在 shared 已存在、Space 不存在或无项目根，脚本会明确报错——**不静默覆盖、不自动建 Space**。
   - **晋升不搬 Source**：Source 全在 `shelf/`、与 Space 无关，出处引用 `/shelf/sources/<file>.md` 在目标根解析；若目标根的 `shelf/` 无该 Source，`lint` 会报断链、交用户裁决（不自动复制、不自动改）。`repo://` 版本化引用本就不需要搬。

## 跨 Space 迁移（整理存量、建专门 Space）

用户明确「整理 inbox / 把这些内容移到专门的 Space」时走本流程。这补上 `space` 角色那句「宁可先落 inbox 以后用 `mmt:organize` 迁移」的实际动作。`mmt:space` 只管建 / 改名 / 删，不搬文档；搬运由本动作调 `node mindmate.mjs move ...`。**不新增命令、不新增角色**。

1. **列源 Space 清单**：逐条列文档（`type` / `status` / `title`）。**不列 Source**——Source 全在 `shelf/`、与 Space 无关，迁移不涉及它们。
2. **定 Space 边界**（先规划，不直接写）：按「互无关联」分组，**少而稳定、不造碎片 Space**；优先复用已有 Space；一次只提议一个，或按用户确认的整份边界清单建。Space 名用可读小写 slug。给用户看「Space 名 → 文档清单」再等确认。**不建名为 `deprecated` 的 Space**——废弃是 `status`，不是领域；废弃结论归 `shelf/deprecated/`（见「shelf 清理」）。
3. **建目标 Space**：`node mindmate.mjs space --create <name> --root <write_root>`（每个需确认；建空 Space，只建 `concepts/` / `rules/`，**没有 `sources/`**）。
4. **写盘确认**（破坏性、永远确认，`--yolo` 不豁免）：列完整迁移清单（文档 → 目标 Space）。
5. **执行**：`node mindmate.mjs move --from <源> --to <目标> --files <doc.md>[,<doc.md>...]`（默认 dry-run 展示判定，确认后 `--apply`）。脚本做：mv 语义非复制、**只搬 `concepts/` 文档**、两边 `index.md` 重建。**Source 不随搬、不改写 `sources[].resource`**（统一 `/shelf/sources/`，跨 Space 不变）。
   - **跨组相对链接**：脚本 dry-run 会报告「被搬文档 `## 关联` 里指向本批之外文档的相对链接」——这类链接迁移后会断，脚本**只报告不改**。编排层须在写盘确认清单里把它们改成 bundle-relative `/<目标Space>/concepts/<file>.md`；**指向 `shelf/deprecated/` 的链接降级为纯文字说明**（活跃文档不链向待删目标）；同批一起搬的相对链接保持不变。迁移后**逐 Space 跑 `lint`**——这是必做步骤。
6. **派生 + 报告**：两边 `log.md` 记 `**Move**`（注明来源 / 目标）；跑 `node mindmate.mjs lint` 校验引用完整性；报告各 Space 内容与剩余。
7. **分期**：多组迁移时先做最内聚的一组验证（引用改写 + lint），通过后再做其余，不一次全搬。

## shelf 清理（用户主动触发，待处置区）

用户明确「清理 shelf / 整理待处置区 / 有没有能删的 Source / 清掉废弃的东西」时才做本动作。**不做定时 / 自动批量清理**（属「明确不做」）。`shelf/` 装两类都有待删属性的内容：`shelf/sources/`（原始输入）与 `shelf/deprecated/`（废弃结论）。

1. 跑 `node mindmate.mjs shelf --root <write_root>`（**只读**）。脚本在**合并三根视图**上按 `sources[].resource` 判定引用，输出一份清单，自动分两组：
   - **「仍被引用 / 建议保留」**：还被活跃文档引用的 Source（列引用方）。
   - **「无引用或已废弃 / 可删」**：孤儿 Source、仅被待删文档引用的 Source、`shelf/deprecated/` 全部文档。
   - 另有**断链告警**：引用解析不到（不是孤儿，须先修，禁止抹字段）。
2. 把清单原样呈现给用户，**逐条确认**删哪些（破坏性永远确认，`--yolo` 不豁免）。
3. **删除顺序**：删引用方（废弃文档 / 活跃文档）→ 确认无断链 → 再删被引用方（Source）。逐条跑 `node mindmate.mjs shelf --drop <file>`（dry-run 展示）→ 确认后 `shelf --drop <file> --apply`。脚本会**拒绝删除仍被引用的 Source**（防断链）并列出引用方，此时先删那些引用方再重试。
4. **口径**：只有活跃文档 frontmatter `sources[].resource` 算链；`log.md` / `index.md` / 脚注文字 / Rule 的「来源：」句 / `repo://` 都**不算**（Rule 保持现状、不算引用）。时间 / 体积 / 年代不作清理标准。
5. **禁止伪造**：断链时不得靠删 `sources[].resource` 字段或抹掉 `## 出处` 脚注来「修」——优先从同步单元 / 备份恢复 Source，找不回就显式标「出处已丢失」并保留字段。
6. 脚本每次 `--drop --apply` 自动重建 `shelf/index.md` 并往 `shelf/log.md` 追加 `**Drop**` 记录；报告删了哪些、剩余多少。

## 硬约束

- **不修改 Source 内容**：Source 只追加、内容不可变（**流程约定**，靠本命令与 `capture` 保证，代码不强制）。重整理只动 Concept / Idea；Source 原文只作出处、不进检索。Source 全在 `shelf/`、与 Space 无关，**跨 Space 迁移不搬 Source、不改写出处**。
- **就地转变只改同一文件**：具体转变目标以注册表 `transitions` 为准（默认 `Idea → Concept`，因为 `Idea.transitions: [Concept]`），沿用原文件名与原 `sources[]`；禁止「新建目标文档 + 删除/保留旧文档」这种双写，也禁止另建 Source。
- **NEVER 生成占位内容或 TODO**；信息不足就追问或明确写「无来源」，不编造。
- `index.md` 由脚本生成，LLM 不手写。
- **不做定时 / 自动批量全库整理、不做定时 / 自动 shelf 清理**（后续演进项）；跨 Space 迁移与 shelf 清理都是用户显式触发、逐项 / 逐组确认的动作。
- **跨组相对链接必须改成 bundle-relative** `/<目标Space>/concepts/<file>.md`，否则迁移后断链；指向 `shelf/deprecated/` 的链接降级为纯文字。脚本 dry-run 会列出这类链接，编排层负责改写。迁移后逐 Space 跑 `lint`，不只看默认 `inbox`。
- **迁移清单必须逐组写盘确认**：跨 Space 移动属破坏性（原 Space 删除），即使 `--yolo` 也要确认。
- **shelf 删除逐条确认、先删引用方**：`shelf --drop` 拒绝删除仍被引用的 Source；断链时禁止抹 `sources[].resource` 字段或脚注伪造「无引用」。已 `deprecated` 的文档归 `shelf/deprecated/` 待删，不是新建 `deprecated` Space。
