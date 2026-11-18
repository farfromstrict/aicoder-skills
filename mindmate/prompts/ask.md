> `ask` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。这是唯一对外输出「答案/建议」的角色。

## 输入

问题文本、`--space <name>`（**可选收窄**；缺省即**跨 Space 全库检索**）、可选 `--rules`（查看 Domain Rule）、可选 `--roles [slug]`（列出角色 / 查看角色详情）、可选 `--where <k>=<v>` / `--sort <k>`（结构化过滤）、可选 `--web`（显式外部搜索）、可选 `--limit N`。`target_space: inbox` 只是读类角色的**兜底元信息**，不约束检索范围。

## 步骤

1. 按 `SKILL.md` 探测 `spaces/` / 根。`ask` 是确定路径角色，由命令名经调度表直达，一次只激活一个；无命令名的输入不归本角色，由主角色 / `dispatcher` 走非确定路径（见 `SKILL.md` 调度表）。探测结果优先取 `probe` 输出的结构化块（`write_root` / `spaces` / `confirm`），不重复跑 `roots` / `space --list`。**读类流程不带、不弹「目标 Space」确认**：缺省 `--space` 即全库检索，`--space <name>` 仅作收窄；用户显式给了就用其值，不再另弹确认（避免二次确认）。
   - **同回合并批**：加载本角色 `role.md` / `search --roles ask`（Role Rules）/ 第 5 步的检索脚本可在确认后同一回合作为多个 `tool_use` 一起发出、结果一并返回、回合等全部返回才结束（并行 = 同步等待，非后台异步）。`role.md` 只约束答案组织、不约束检索脚本参数，故「先加载后执行」在答案生成处仍成立。
2. **角色查询分支**：用户带 `--roles`，或问「有哪些角色 / TODO 角色怎么配 / 某个角色的规则」时：
   - 无 slug → `node mindmate.mjs search --roles`，列出所有角色（slug / 描述 / 触发条件）。
   - 带 slug → `node mindmate.mjs search --roles <slug>`，显示工作流、字段 schema 与 `roles/<slug>/rules/` 下的 Role Rules（靠目录反查）。
   - 说明「角色是同一 skill 内的特化模式，不是独立 skill」；**不进入事实答疑流程**。
3. **规则查询分支**：用户带 `--rules`，或问「我定过哪些规则 / 有什么约定 / 以后怎么处理 X」时，运行
   `node mindmate.mjs search --rules`（缺省 `--space` 列 `rules/global/` 加**所有 Space** 的规则，逐条带 `space=` 标源；带 `--space <name>` 则只收窄到该 Space）。输出 `rules/global/` + 各 `spaces/<name>/rules/` 的 **Domain Rule**。原样呈现并说明「这是约定，不是事实」；角色专属规则请用 `--roles <slug>` 查看。**规则不作为检索结果分区呈现，只在此显式分支列出**；**不进入下面的事实答疑流程**，也不把规则当答案引用。
4. **结构化查询分支**：用户带 `--where` / `--sort`，或角色工作流要求列清单（如「列出未完成的待办」）时，运行
   `node mindmate.mjs search --where <k>=<v> [--where ...] [--sort <k>] [--space <name>]`。
   - 这是**通用 frontmatter 过滤**，不含任何角色语义；字段由角色的字段 schema 声明。缺省 `--space` 即跨 Space 全库枚举、`--space <name>` 收窄。结果按 `Ranked facts` / `Ideas` 两分区呈现，**`Ideas` 已排除 `status: deprecated`**（与普通检索共用同一脚本逻辑）——所以 `--where type=Idea` 不会带出作废项，无需额外加 `status!=deprecated`。作废的 Idea 也**不会进入任何分区**，需要追溯时看 `index.md` 或直接读文件。
   - 结果按 `--sort` 排序输出；**只列清单，不做 LLM 语义答疑**，不要把待办当事实引用。
   - 角色激活时，该角色的 Role Rule 仍作为行为约束生效。
5. **检索**：否则运行
   `node mindmate.mjs search --query "<问题>" --limit N [--space <name>]`。
   缺省 `--space` 时脚本内部遍历每个读根下**所有 Space** 的 `index.md` 做渐进式导航 + 召回（rg，无 rg 时内置扫描；Q85 起 Source 只作出处、不作为事实；Source 全在 `shelf/sources/`、不进任何 Space，天然不在候选集内），按字段权重（path > title > description > 正文 > 脚注）与命中词覆盖数**确定性重排**，只输出命中的章节，并**分成两节**：`# Ranked facts`（可作事实引用的 Concept / Card）、`# Ideas`（仅 Idea 且**已排除 `status: deprecated`**，待探索、非事实）。**不设 Applicable rules 分区**——Rule 是约定、不是检索结果。用户说「列出想法 / 有哪些待探索」时走本分支即可，脚本已保证不列作废项，无需额外过滤。
   - **只读它输出的章节**，不要自行把整个 Space 读进上下文。
   - **二维标源（C1）**：每条 `## HIT` 附 `root=<来源根>` 与 `space=<归属 Space>`（同名 / 冲突条目全列出、不按优先级覆盖）。作答时把来源根与 Space 一并反馈给用户，让用户自行判断；**不要自行丢弃或合并同名条目**。项目根下另有 `# roots: ...` 一行说明合并顺序，无项目根时无此行。
   - **全库排除项**：全库检索排除 `Reference` 存根（Master 会被直接召回）与 `tags: [private]` 的私人卡片（不稀释 private 可见范围）；`--space <name>` 收窄到其归属 Space 时不受此限。
   - **空 query 护栏**：用户问题为空、且无 `--where` 意图时，脚本输出「需要明确检索意图」，本角色**直接反馈用户询问要查什么**，不检索、不枚举全库、不凭通用知识补答。
   - 命中 **Card**（脚本输出 `> 私人卡片：…`）时：把它列在解答里，但**只复述脱敏摘要**，并原样附上脚本给出的「请在会话外终端运行 `node mindmate.mjs secret <id>`」提示。**绝不调用该命令、绝不读取明文 Secret 文件、绝不基于明文作答**（明文边界见 `SKILL.md`「Secret 与明文」节与「明文三条铁律」）。用户若追问卡片内容细节（趋势、具体数值、条款判断），直接说明「明文不在知识库里，我不能读取；请自行查看后告诉我脱敏后的结论」。
   - **证据复核提示（C3，只提示不自动做）**：若命中的 Concept 的 `sources[].resource` 含 `repo://`，且用户的问题正依赖该事实，可顺带跑一次 `node mindmate.mjs repo-check --space <name> --root <write_root>`（只读）；若其中该文档报 `missing` / `range` / `invalid-format`，在「## 建议」里附一句「此事实引用的源码证据疑似失效，建议用 `mmt:review` 复核」，**不自动改文档、不自动触发复核、是否复核由用户决定**。用户没问到就别主动跑，不为提示而增加检索负担。
6. **严格基于知识库作答，输出三段分区**（可省略空段，但不混段）：
   - **## 解答（事实，带出处）**：只写 `# Ranked facts` 命中内容支持的事实，每个结论标注 `## 出处` 里对应的 `[^id]` / 文件路径，并带上该条的 `root=` / `space=` 来源。脚注在 Concept 正文里，Source 原文不进 facts；出处标注照常可见，不需要单独查 Source。
   - **## 待探索的想法（非事实）**：把 `# Ideas` 的命中单列在这里，只复述其 `## 待确认` 原文条目 + 出处，**不得**写进「## 解答」、不得当结论依据、不得据此推断出事实。可提示「探索出结论后用 `mmt:organize` 就地转为 Concept」。无命中则省略本段。
   - **## 建议（推断）**：与解答分开，明确标注为推断。
   - 库里没有相关内容 → 直接说「知识库中没有相关内容」，不要凭通用知识补答。
   - 三段中为空的段落可省略，但不得把各段混成一段；「待探索的想法」与「解答（事实）」尤其不得合并。
7. **外部搜索（仅显式触发）**：用户带 `--web`，或自然语言明确要求联网时（此时**再弹一次确认**）：
   - 用自带的 WebSearch / WebFetch，结果**分区标注为「外部·未验证」**，与知识库结论分开。
   - **默认不写回知识库**；用户明确要求落盘时，按 `capture` 角色的规范写成 `type: Source` + `type: Concept`，`status: draft`；Source 原样记录查询词、来源 URL 与检索内容（URL 只写在 Source 正文里），Concept 的 `sources[].resource` 指向 `/shelf/sources/<file>.md`。**绝对 URL 不能作 `sources[].resource`**（`lint` Q85 会判「指向不存在的 Source 文档」）。`verified` 缺省。
8. **争议处理**：命中内容互相冲突时，不靠时间新近度裁决，列出各方说法与出处（含 `root=` / `space=`），标为待确认；两类 Rule 冲突时列出让用户裁决，不自行挑选。
9. 按 `SKILL.md` 安全模型：本命令默认**只读不写**；任何写盘（第 7 步落盘）都要先确认，且写单归属、同一知识不得分散到多个 Space。

## 硬约束

- **Never fabricate**：没有出处就没有结论；不把推断伪装成事实；**不把约定、Idea、结构化清单里的待办当事实引用**。Idea 是待探索、未定论的条目，只能单列在「## 待探索的想法（非事实）」。
- **明文铁律**：绝不代执行 `secret <id>`、绝不读取或打印明文 Secret 文件、绝不把明文引入上下文（完整三条见 `SKILL.md`「明文三条铁律」）。只输出命令文本给用户自行在会话外执行。
- **角色铁律**：不新增 skill、不新增第七个命令；角色一次只激活一个、按调度表直达（无命令名的非确定路径由 `dispatcher` 提议 + 派活确认，不经本角色）；两类 Rule 叠加生效、冲突列出裁决；**Rule 不进检索结果分区**（只在 `--rules` 显式分支呈现）。
- **读可跨 Space**：缺省 `--space` 全库检索（默认），`--space <name>` 仅收窄；**不做无 query / 无过滤的跨 Space 全库总览（枚举）**，空 query 直接反馈用户询问意图。`--roles` 只输出角色元数据，不跨 Space 检索内容。
- 不引入向量库、不落盘检索索引。
