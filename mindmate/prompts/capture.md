> `capture` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 输入范围（v1）

只接受：粘贴/键入的纯文本、本地 `.md`/`.txt` 文件。网页、剪贴截图、OCR、其它 skill 产物一律延后；遇到就告知用户「v1 暂不支持」并建议粘贴为文本。

## 混合输入：先分片，再一次确认（前置）

一次输入含**多个互不相干主题**时（随手记一批、会议纪要混了待办与设计点等），先把输入切成若干**片段**，逐片走下面的「先分流」与「步骤（知识摄入）」；**不要**把整批塞进一个 Concept，也不要静默拆。

**识别依据**：「互无关联」——片段之间无法用一条主线串起来。同一主题的多个要点 / 问句属于同一片，不拆。判断不准 → 按单片走原流程，不硬拆。

**前置优先级不变**：敏感信息识别仍第一优先（明文绝不进上下文），非摄入意图（建角 / 建库）按「先分流」第二优先处理、不落盘；分片只作用于其余内容。

**步骤**：

1. **输出分片表**（写盘前，整表只确认一次）：

   | # | 片段原文（摘录） | 一句话摘要 | 分流类型 | 建议 Space | 落点 |
   |---|---|---|---|---|---|
   | 1 | … | … | 知识 | inbox | 新建 / 更新 `<slug>`（`type: Concept`） |
   | 2 | … | … | 想法 | inbox | 新建 `concepts/<slug>.md`（`type: Idea`） |
   | 3 | … | … | 规则 | 全局→— / 某 Space→该 Space | `rules/global/<slug>.md` 或 `spaces/<name>/rules/<slug>.md` |

   - 分流类型 = 知识 / **想法** / 规则 / 私人卡片，决定该片走哪个分支；按「先分流」第三优先判断知识还是想法，**判断不准按想法处理**。建角意图不由本角色落盘（见「先分流」第二优先）。
   - **会话中补充的确定知识另起一组**，按「摄入补充说明」节处理（单独一条 Source、按描述世界/规定解码分流），不要混进原始输入的分片。
   - 建议 Space：**默认全部同一个**（`inbox` 或用户给的 `--space`），复用优先；**不按片段各配一个 Space**。规则 / 卡片类片段不属于 Space，表中记 `—`。
   - 落点：写盘确认前先跑**全库** `node mindmate.mjs search --query "<片段摘要>"`（不带 `--space`，读可跨 Space）拿同名 / 同 tag 候选；「是否同一知识」由 LLM 在**写盘确认环节**判定（脚本只给候选、不做语义裁决）。命中已有 → 就地更新或走 `mmt:organize` 迁移，**不新建副本**；无 → 才新建。同一知识只归一个 Space（写单归属）。
   - 表后附**将创建/修改的完整文件清单与每片摘要**，按安全模型等**一次**确认；规则 / 卡片类片段把拟落盘的全文或模板一并列进表里。`--yolo` 不豁免破坏性确认，明文三条铁律不因合并确认而豁免。

2. **确认后逐片执行**：
   - **一条 Source**：整批原文只写**一条** `shelf/sources/<ISO日期>-<slug>.md`（待处置区，不进任何 Space），正文是**原样全量输入**（含标题行），不按片段拆 Source。Source 只追加、不可变。
   - **每片按其类型落一个文档**：知识 → `type: Concept`（走「步骤（知识摄入）」）；想法 → `type: Idea`（走「Idea 分支」）。两者 `## 出处` 都用 `[^s1]` 指向**同一条** Source（各自 `sources: [{ id: s1, resource: /shelf/sources/<file>.md }]`）；`lint` 的脚注↔id 对应仍成立。**出处引用前缀统一 `/shelf/sources/`，跨 Space 不变、迁移 / 晋升都不改**。
   - **`## 关联` 用同批文档互连**：Concept 在解释关系的句子里链接**同批的其它片**（同批 ≥3 片时可满足「至少连接两个」）；**Idea 不强制**，凑不足时如实写「同主题文档暂无其它，待后续摄入补充」，**不硬凑、不编造**。
   - 规则 / 卡片类片段 → 分别按各自分支落盘（规则全文、脱敏模板），不混进 Concept / Idea。
   - **不双写**：一片只落一处；跨 Space 提议仍走知识摄入第 6 步 Q15，默认不双写。

3. **新 Space 仍一次最多一个**：只有用户显式确认某片确属「现有 Space 都无法容纳」的独立边界时才新建，一次只提一个、需确认；否则全部落 `inbox`，留给 `mmt:organize` 迁移。守住防碎片（Space 是少而稳定的**知识唯一归属维度**，读可跨、写不分散，不是标签）。

4. **派生文件**：`node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`（Idea 条目自动带 ` · Idea` 标记）；`log.md` 同一天一条 `## YYYY-MM-DD`，逐片记 `**Creation**` / `**Update**`（注明类型、来自同一 Source），倒序；纯 prose，不写脚本。

## 摄入补充说明：会话中补充的确定知识（前置）

用户在摄入流程里针对待摄入内容补充的**确定知识**（术语含义、缩写映射、实体归属、背景事实，如「`mmt` 是 mindmate 的简写」「`herdr` 是分屏工具」「我有一只叫 tom 的猫」）必须**独立落盘**：不得只作为 Idea 正文里的一句附注，也不得伪称来自原始输入那条 Source。

**为什么单独处理**：这类说明是「解读这批对象用的字典」，与「被解读的内容」在三点上不同——不同源（是第二次输入，不是原始输入那条 Source）、不同消费方式（当下就被用掉，但可跨批次复用）、不同维护预期（几乎不会被主动更正，容易静默过期）。把它和 Concept 混在一起，会被 `mmt:ask` 当事实引用、且过期无人察觉。**区分方式不新增 `type`**，而是看它「进哪个根、进不进 `Ranked facts`」。

**步骤**：

1. **单独一条 Source**：`shelf/sources/<ISO日期>-clarifications.md`，`type: Source`，正文**原样记录**补充说明（含用户口径与日期）。它与原始输入的 Source 是两条，**不并入、不伪称**。派生的 Concept 的 `## 出处` 指向本条（`/shelf/sources/<file>.md`）；Rule 沿用「规则写入分支」骨架（无出处脚注、**不算引用**），由 `generated` 与本条 Source 共同体现来源。
2. **按性质分流**（判断标准：这句话是在**描述世界**，还是在**规定怎么读我的输入**）：
   - **描述世界**（「X 是一个分屏工具」「X 是某项目的 feature」「我有一只叫 tom 的猫」）→ `type: Concept`，走「步骤（知识摄入）」。`## 出处` 指向本条 Source；`## 关联` 在解释关系的句子里**显式链接到它所解释的那批文档**（Idea / Concept），说明「本条为解读 <那批文档> 提供上下文」。它本身就是可检索的答案，进 `Ranked facts`。
   - **规定解码 / 处理约定**（「X 指 Y」「X 是 Y 的简写」「以后写 X 按 Y 理解」）→ `type: Rule`，走「规则写入分支」，路径优先放 `rules/global/`（跨 Space 的缩写习惯）或 `spaces/<name>/rules/`（仅该 Space）。Rule 不带出处脚注（按规则分支骨架），不进 `Ranked facts`（脚本已排除），**也不作为检索结果分区呈现**；用户显式问约定时走 `mmt:ask --rules`，`mmt:review` 按 `stale_after` / `status` 检查过期——正好避开「混进答案」与「静默过期」两个代价。
   - **判断不准按 Concept 处理**（宁可多一条可检索事实，不可把事实写成约定）。
3. **分片表要体现**：把补充说明作为**独立一组**列入「混合输入」分片表（或单独一小表），表后附完整文件清单，整表一次确认；注明每条指向哪条 Source、落在哪个根。
4. **被解读的文档只留链接**：Idea / Concept 正文**不重复抄写**补充说明全文，改在 `## 关联` 里链接到上面落盘的 Concept、或注明「术语见 <Rule 标题>」，避免确定知识寄生在 `type: Idea` 里而检索不到。
5. **派生文件**：`node mindmate.mjs index --space <name> --root <write_root>`；`log.md` 单独记 `**Creation**`，注明「摄入补充说明 / 第二条 Source / 落在哪个根」。

> 判断示例：「`mmt` 是 mindmate 的简写」= 规定怎么读我的输入 → `Rule`；「`herdr` 是我正在用的分屏工具」= 描述世界 → `Concept`。同一批说明里两类都可能有，**不要压成一个文档**。

## 先分流：知识 / 想法 / 规则 / 私人卡片 / 角色

**第一优先：识别敏感信息。** 用户提到密码、卡号、证件号、密钥、病历、财务账号等，或明确说「这个别让大模型看到」→ 走「私人卡片」分支。**绝不把明文读进上下文、绝不代填**。

**第二优先：识别非摄入意图（建角 / 建库）。** 用户说「建一个 TODO 角色 / 新建角色 / 特化成 XX 模式 / 建个知识库」时，这**不是摄入**、本角色不落盘：说明这是独立工作，归 `role-creator`（建角，走 `dispatcher` 非确定路径 + 派活确认）/ `bootstrap`（建库，按 `trigger` 直达、只走一次写盘确认，见 `SKILL.md` 建库例外），并提示用户可直接用无命令名的自然语言表达。**不要在 capture 里拼角色定义或调 init。**

**第三优先：知识 还是 想法。** 这是每片都要做的类型判断，标准是**结论是否已定**：
- 内容是可确认的事实 / 已定论的结论 → `type: Concept`，走「步骤（知识摄入）」。
- 内容是**待探索、未定论**的想法 / 问句 / 缩写 / 假设 / 随手记的要点（用户说「这是想法」「需要探索」「还没定」时也在此列）→ `type: Idea`，走下面的「Idea 分支」。
- **判断不准按 Idea 处理**（宁可标「待探索」，不可把未定论写成断言）。Idea 不是知识的草稿，二者是不同 `type`，不是同一文档的两个 `status`。

**私人卡片分支**（mindmate 生成模板，用户在会话外填充）：

1. 若用户已经在对话里贴了明文 → **立即停止**，说明「这段内容已进入上下文，无法撤回；建议作废重来」，并给出下面的模板让用户**在会话外**重新填。不要复述、不要引用、不要把它写进任何文件。
2. 按 `SKILL.md` 探测 `spaces/` / Space；用 `node mindmate.mjs search --space <name> --query "<脱敏关键词>"` 查是否已有同主题卡片（**此处必须带 `--space` 收窄**：全库检索排除 private 私人卡片，只有收窄到归属 Space 才查得到）。
3. 生成 `<id>`：**可读小写 slug**（如 `cmb-debit-2024`），不用 MD5、不用哈希。
4. 生成 Card 模板 `concepts/<slug>.md`（**只含脱敏内容**），并**等用户确认**：
   ```
   ---
   type: Concept
   title: <脱敏短名>
   description: <脱敏一句话摘要>
   tags: [private, <分类>]
   secret: <id>
   ---
   <脱敏摘要；必须自带检索关键词，如「招行储蓄卡、工资卡、2024 办」>
   ```
   - 摘要里**不得**出现卡号、密码、具体金额、证件号等任何明文。
   - 关键词要足以让 `mmt:ask` 定位到这张卡（否则场景「找含竞业条款的合同」会搜不到）。
5. **给出会话外填充指引**（只输出命令/路径文本，绝不代执行）。位置 / 格式 / 风险规则的**唯一出处是 `SKILL.md`「Secret 与明文」节**，本角色不复制这些规则，只按下面给出可操作的话术：
   - 让用户打开**所在根的明文 Secret 文件**（文件名与位置见契约节），按该文件的**头部注释**里的说明与示例填写——那是由 `init` 生成的格式可读副本；`<id>` 与本卡片 `secret:` 一致。
   - 查看命令（会话外终端）：`node ~/.codebuddy/skills/mindmate/scripts/mindmate.mjs secret <id>`
   - 一句话提醒「该文件含明文、勿同步 / 勿提交 / 勿贴回对话」；细则（同步排除、`.gitignore`、共享根禁放）一律指回契约节，不在此展开。
6. `node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`；`log.md` 记 `**Creation**`（只记卡片标题与 `<id>`，**不记明文**）。
7. 报告：卡片落在哪个 Space、`<id>` 是什么、检索关键词有哪些。**不要**报告或暗示明文内容。

> mindmate 能生成的是**模板、结构、脱敏字段提示与命令**；摘要的语义内容由用户提供且必须自行脱敏。mindmate 不读明文文件，因此永远不知道 `<id>` 对应什么。

**规则分支**：用户说「以后 / 记住 / 凡是…都 / 别再 / 一律」这类**处理约定**时走下面。判断标准是 **Rule 只写怎么处理，不写什么为真**：

- 「以后都用中文整理」→ Rule
- 「会议纪要要列出席人、决议、待办」→ Rule
- 「这个项目不写周报」→ **这是事实，不是规则**，走正常摄入落为 `type: Concept`
- 判断不准时按事实处理（宁可多一条可检索知识，不可少一条事实）

**规则写入分支**：

1. 按 `SKILL.md` 探测五个根，并读现有规则（`node mindmate.mjs search --rules`，缺省 `--space` 即列 `rules/global/` 加所有 Space 的规则）检查是否重复或冲突。
2. **路径优先选目录**：全 Space / 跨 Space 生效 → `rules/global/`；仅某 Space 生效 → `spaces/<name>/rules/`（内聚在该 Space 内）。**默认不写 `scope`**。
3. **复述拟落盘的规则全文并等确认**（安全模型），冲突时列出冲突让用户裁决，不自行挑一条。
4. 写 `rules/global/<slug>.md` 或 `spaces/<name>/rules/<slug>.md`，`type: Rule`：
   ```
   ---
   type: Rule
   title: <短名>
   description: <一句话>
   status: stable           # draft | stable | deprecated
   generated: { by: human:<id>, at: <ISO 8601 带 UTC 偏移> }
   ---
   <规则正文，自然语言；可含 ## 关联 链接到相关 Concept>
   ```
   - 作废既有规则 = 把它的 `status` 改成 `deprecated`，**不删文件、不静默覆盖**。
   - 仅当目录无法表达（如一条规则只作用于多个指定 Space）才在 frontmatter 写 `scope` 补充，白名单 `global` 或 `space:<name>[,space:<name>...]`；**禁 `topic:` / `role:`**。
5. `node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`（含四个 bundle 根 index：`spaces` / `shelf` / `rules` / `roles`）；`log.md` 追加 `**Creation**` / `**Update**` 条目。
6. 报告新规则的目录（即作用域）与状态；说明它会在后续操作中作为行为约束生效（优先级低于 `SKILL.md` 硬约束）。

## Idea 分支（待探索、未定论）

输入是想法 / 问句 / 假设 / 缩写 / 随手记要点，**尚无结论、需要探索**时走本分支。**不提炼、不推断、不写断言**；Idea 不是可引用的事实。

1. 按「混合输入」分好片（整表一次确认）后，每片一个 `concepts/<slug>.md`，`type: Idea`。
2. frontmatter：`type: Idea`、`title`、`description`（含检索关键词的一句话，**不写结论**）、`status: draft`、`tags`（检索用的自由扩展维度，无强制标准）、`sources[]`。
3. 正文骨架：
   ```
   用户于 <ISO 日期> 记下以下关于 <主题> 的 N 条待探索点，均未展开、尚无结论；原文条目原样列于「待确认」，不做提炼。

   事实：原始输入包含以下 N 条条目。
   推断：无。

   ## 待确认
   - <原文条目 1，原样>
   - <原文条目 2，原样>

   ## 出处
   [^s1]

   [^s1]: 原始输入见 shelf/sources/<file>.md。

   ## 关联
   本片与同批其它片同为一次随手记的不同主题（标「推断：」）；Idea 不强制「至少连接两个」，凑不足就如实写「同主题文档暂无其它，待后续摄入补充」。
   ```
   - 原文条目**逐条原样**，不改写、不补全、不合并、不解释含义；含义不明的缩写原样保留。
   - 用户在会话里补充的术语说明（不在原始输入里）**不写进 Idea 正文**：按「摄入补充说明」节独立落盘为 Concept / Rule，本片只在 `## 关联` 链接过去，避免确定知识寄生在不可作事实引用的 Idea 里。
   - `## 出处` 的 `[^s1]` 必须对应 `sources[].id`；`sources[].resource` 必须指向真实文件（`lint` 会校验）。多片共一条 Source 时都用同一个 `s1`。
4. 派生文件按「混合输入」第 4 步：`node mindmate.mjs index --space <name> --root <write_root>` 重建 `index.md`；`log.md` 逐片记 `**Creation**`（注明 `type: Idea`、同出一条 Source）。
5. 报告时说明：这些是**待探索、非事实**，后续用 `mmt:ask` 的 `Ideas` 分区或 `search --where type=Idea` 找回，探索出结论后用 `mmt:organize` **就地**转为 `type: Concept`（不新建文档、不另建 Source）。

> Idea 只走本分支，**不走下面「步骤（知识摄入）」的提炼流程**；后者只适用于已定论的知识。

## 步骤（知识摄入）

1. **探测**：按 `SKILL.md` 解析 `spaces/` 与 `--space`（默认 `inbox`）。`spaces/` 不存在 → 走 `node mindmate.mjs init` 的 dry-run 展示，**确认后** `--apply`。
2. **判断是否需要新 Space**（本步在落点规划之前）：
   - 先跑 `node mindmate.mjs space --list --root <write_root>` 拿到现有 Space 列表。
   - 若用户已给 `--space <name>`：该 Space 存在 → 直接用；不存在 → **不要自动创建**，向用户说明「Space '<name>' 不存在」，给出创建建议并等确认，确认后 `node mindmate.mjs space --create <name> --root <write_root>`。
   - 若未给 `--space`：**优先复用已有 Space**（含 `inbox`）。只有当内容明显属于一个现有 Space 都无法容纳的新领域时，才提议新建。判断依据是「互无关联」的隔离语义，不是话题关键词——不要因为出现「项目 A」就造 `project-a`。
   - 需要新建时，**先向用户说明现状并只给一个起名建议**：列出「现有 Space = …」「为什么现有 Space 不合适」「建议名 = `<可读小写 slug>`」「该内容将落在此 Space」。等用户确认（可改名、可拒绝并指定现有 Space）后才执行 `--create`。**一次只提议一个，不批量建、不静默建、不静默归类**。
   - 用户拒绝或无法判断 → 落 `inbox`，不创建。
   - 防碎片：Space 是少而稳定的**知识唯一归属维度**（读可跨、写不分散），不是标签；宁可先落 `inbox` 以后再 `organize`，也不要造一堆空壳 Space。
3. **规划落点，不要直接写**。先跑**全库** `node mindmate.mjs search --query "<输入摘要>"`（不带 `--space`，读可跨 Space）拿同名 / 同 tag 候选，并按候选的 `space=` 归属读对应 `index.md`；在**写盘确认环节由 LLM 判定**「是否同一知识」（脚本只给候选、不做语义裁决）：
   - 是否已有 **canonical home**（一条内容只应有一个权威 Concept）？
   - 有 → 就地**更新已有 Concept**，或走 `mmt:organize` 跨 Space 迁移把归属理顺，**不新建副本**（写单归属）。
   - 无 → 才新建。
   - 判不出归属 → 落 `inbox`，不硬猜、不造碎片 Space。
4. **写 Source**：`shelf/sources/<ISO日期>-<slug>.md`（待处置区，不进任何 Space），`type: Source`，`title`、`description`，正文是**原样输入**，不加改写、不加 TODO。`generated` 用 `human:<id>` 或 `process:<id>`，时间 ISO 8601 带 UTC 偏移。出处引用统一写 `/shelf/sources/<file>.md`。
5. **提炼为 Concept**：`concepts/<slug>.md`，`type: Concept`。骨架固定：
   - `description`：一句话摘要
   - 正文：**事实与推断分标**（推断显式写「推断：」）
   - `## 关联`：链接**写在解释关系的那句话里**，每个实质 Concept 至少连接两个其他 Concept；关系种类由句子说明，不靠链接本身
   - `## 出处`：`[^id]` 脚注，对应 frontmatter 的 `sources[].id`，指向该 Source（`lint` 会校验 `sources[].resource` 与脚注↔id 对应）。**项目源码证据**可用 `repo://<相对路径>#L<n>-L<m>` 作为 `sources[].resource`（版本化引用、非快照）：格式见 `SKILL.md` 存储约定，frontmatter 里含 `#` 必须整值加引号；`lint` 只校验格式、不查文件存在。**证据复核提示（C3，只提示不自动做）**：摄入含 `repo://` 引用的文档后，可顺带跑 `node mindmate.mjs repo-check --space <name> --root <write_root>`（只读）；若该引用报 `missing` / `range` / `invalid-format`，在报告里附一句「此源码证据疑似失效，建议用 `mmt:review` 复核」，**不自动改、是否复核由用户决定**。证据漂移只查文件存在 + 行号范围、不判内容变化（无版本基线）；**晋升不搬 Source**（Source 全在 `shelf/`、与 Space 无关）。
   - `## 待确认`：争议事实、未决问题
   - `status: draft` 或 `stable`；需要复核时给 `stale_after`（ISO 8601 带 UTC 偏移）
6. **写单归属（Q15 已收敛）**：**同一知识只写一个 Space、不跨域双写**。缺省 `--space` 全库检索（读可跨 Space）已能发现任意 Space 的内容，故**不再新建 Master / Reference 存根做跨域可见**；全库检索也排除 `Reference` 存根（避免与 Master 重复 HIT）。用户给 `--space` 时用其值，未给则落 `inbox` 或按写前查重命中的已有归属。存量的 Reference / Master 仍按 `organize` 角色工作流与 `SKILL.md` 维护，但新摄入不再产生。
7. **更新派生文件**：
   - `node mindmate.mjs index --space <name> --root <write_root>`（确定性生成 `index.md`，**LLM 不得手写 index.md**）
   - 在 `log.md` 追加 `## YYYY-MM-DD` 条目（`**Creation**` / `**Update**` / 跨域决策 / 新建 Space），倒序；纯 prose，不写脚本
8. **确认与报告**：按 `SKILL.md` 安全模型，写盘前列出将创建/修改的文件与摘要等确认。报告写入了哪些文件、落在哪个 Space、是否新建了 Space、是否有跨域提议被采纳。

## 硬约束

- **NEVER 生成占位内容、空标题、TODO 章节**；输入不足就追问，不要编造。
- **明文绝不进上下文**：不得读取/打印明文 Secret 文件（定义见 `SKILL.md`「Secret 与明文」节）；不得把敏感明文写进 Card、Source、`log.md` 或任何回复；不得代执行 `secret <id>`。用户贴了明文就提醒其已暴露并引导会话外重填。
- **Never fabricate missing information**：出处只写真实存在的 Source；没有就明说「无来源」。`sources[].resource` 必须指向真实文件，`## 出处` 脚注 `[^id]` 必须与 `sources[].id` 对应（脚本 `lint` 会报错）。Source 原文不进检索，只作出处。
- 更新时**只改受影响的页**，允许 no-op（「无需改动」是合法结论），**不做纯格式改动**。
- 争议事实**不靠时间新近度裁决**，放进 `## 待确认`，保留各方说法。
- `type` 必须已在 `~/.mindmate/types.yaml` 注册表声明（默认五个：`Source` / `Idea` / `Concept` / `Reference` / `Rule`），不要凭空造新 `type`；新增类型先改注册表并声明封闭槽位。**Role 仍是 `Concept` + `tags: [role]`，不是独立 type**；`index.md`/`log.md` 是保留名，不得用作 Concept / Idea。
- **按 `owner` 消费**：注册表的 `owner` 槽位声明「哪个角色创建 / 消费该 type」。分流某片落成某 `type` 前，读该 type 的 `owner`；默认均为 `capture`（本角色创建）。若某 `type` 的 `owner` 指向其它角色，本角色**不自行落盘该类型**，说明归属并交 `dispatcher` 非确定路径派给对应角色。新增类型时也要声明 `owner`。
- **Rule 路径优先**：Space 绑定的 Domain Rule 放 `spaces/<name>/rules/`、全局/跨 Space 的放 `rules/global/`；Role Rule 放 `roles/<slug>/rules/`，靠目录区分两类；默认**不写 `scope`**，仅目录无法表达时才用 `scope` 补充（白名单 `global` / `space:<name>[,...]`，禁 `topic:` / `role:`）。角色文档**不列 rule 清单**。
- 不写 `okf_version`（只有各 bundle 根 `index.md` 能带）。
- **Space 不自动创建**：必须先说明现状 + 给一个起名建议 + 等用户确认；不静默建、不批量建、不因话题关键词造碎片 Space。Space 名用可读小写 slug。
- **混合输入先分片**：一次输入多个互不相干主题时按「混合输入」分支切成多片、整表一次确认；禁止整批塞进单个 Concept / Idea、禁止按片段各建 Space、禁止静默拆分。所有知识 / 想法类片共一条原样 Source，`## 出处` 指向它；规则 / 卡片 / 角色类片各走各自分支。
- **Idea 不是事实**：`type: Idea` 的条目原样放 `## 待确认`，不提炼、不推断、不写结论、不当事实引用；判断不准按 Idea 处理。探索完成后用 `mmt:organize` **就地**转为 Concept（同一文件、沿用原 `sources[]`），**不新建文档、不另建 Source、不双写**。
- 规则不得关闭确认、跳过破坏性确认、或启用「明确不做」里的项；这类要求一律拒绝并说明原因。
