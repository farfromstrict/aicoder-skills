# mindmate 设计讨论（开发者向）

> **修订（2026-11-13，Space 语义：读跨 / 写单归属 + 全库检索）**：本文 §3 / §7 /「落地批次」及 §「ask」等处关于「不同 Space 默认互不可见 / 检索默认只在本 Space 内进行」「不做跨 Space 全库搜索」「ask 四段分区含相关约定」「角色一律带 `target_space`」「`init-project` 写项目专家门面角色」的描述**已被后续修订取代**，一律以 `SKILL.md` / `prompts/` / `scripts/` 为准：Space 改为**知识唯一归属维度（读可跨 Space、写不可跨 Space，同一知识不分散）**；`search` 缺省 `--space` 即全库检索（二维标源 `root=` × `space=`，排除 Reference 存根 / private 私人卡片，空 query 护栏）；**去掉 Applicable rules 分区**，ask 改三段输出；`target_space` 仅写类 / 读兜底角色按需带、控制面角色不带；`research` 改为一步到位直接落目标 Space；写盘确认前用全库 `search` 拿候选、由 LLM 判定「同一知识」。本文保留原文作为演进记录，不作运行时依据。
>
> **修订（2026-11-12，建库流程精简）**：本文 §3 / §7 及「落地批次 ①」中关于「`init-project` 写入项目专家门面角色」「项目级与用户级同构骨架」「`bootstrap` 走 `dispatcher` 非确定路径」的描述**已被后续修订取代**，一律以 `SKILL.md` 为准：项目根改为最小骨架（不写 `config.yaml` / `types.yaml` / 角色定义 / `rules/global/` / 门面角色）、`init-project --roots shared|local|both` 支持只建 local 根、建库类输入按 `trigger` 直达 `bootstrap` 并合并为一次写盘确认。本文保留原文作为演进记录，不作运行时依据。
>
> **定位**：给开发者看的架构演进记录。`SKILL.md` / `prompts/` / `commands/mmt/` / `scripts/` **均不引用本文**，skill 运行时不加载它。
>
> **状态**：本文描述**目标架构**，也记录落地进度。**落地批次**（2026-11-11）：
> - **①** 脚本 + 数据骨架：11 预置角色模板、`roles/builtin/` + `custom/` 两层、`init-project`、`types.yaml` 注册表、`init` 从 `prompts/<slug>.md` 下发完整流程到 `role.md`。
> - **②** 运行时接线：`SKILL.md` 收敛为顶层契约 + 调度表、6 个 `commands/mmt/*.md` 变薄为「读 SKILL.md + 加载对应 `role.md`」、删 `prompts/roles/`、真实 vault 迁移到 builtin/custom。
> - **③-A** 架构主干：5 个架构角色补完整流程、非确定路径实装（dispatcher 派活确认 / evolution.md / optimizer / bootstrap / role-creator）、角色创建移出 capture、types 流程层按 `transitions`/`owner` 消费。
> - **③-D** `repo://` Source lint scheme：`lint` 识别 `repo://<相对路径>[#L<n>[-L<m>]]`、只校验格式不查文件存在；SKILL.md 存储约定 + capture/lint 模板源登记写法与「含 `#` 必须加引号」。
> - **③-C1** 项目根判定 + 读多根合并标源（只读）：`findProjectRoot()` 就近找 `.mindmate/`/`.mindmate.local/`、`resolveSearchRoots()` 三根、`search` 按条目合并标 `root=`、同名全列出不覆盖、单根零回归。
> - **③-C2** 写目标根 + 晋升（写）：`roots` 只读子命令（三根 + `write_root`）、`promote <file>`（单文档 local→shared 移动、移动非复制、dry-run 默认）、`globalControlRoot()` 拆分修正 `--root` 误判、6 个写类角色 + `organize` 晋升动作 + `dispatcher`/`role-creator`/SKILL.md/commands 全部按写根接线、clone 补建 local 根。
> - **③-C3** `repo://` 证据复核（只读）：`repo-check` 子命令（文件存在 + 行号范围，轻量判定、不判内容变化）、`review` 用户主动触发复核动作、`ask`/`capture` 处理中只提示建议复核、SKILL.md/capture/lint/review 模板源 + commands 登记。**③-C 项目级三根闭环完成**。
> - **R（规则内聚，架构调整）**：Space 绑定的 Domain Rule 从 `rules/spaces/<name>/`（镜像目录）移入 `spaces/<name>/rules/`，与 Role Rule 内聚在 `roles/<slug>/rules/` 的做法对称；顶层 `rules/` **降级保留**为「全 Space / 跨 Space 规则容器」（删 `rules/spaces/`），不再是「与 spaces/roles 对等的三 bundle」。理由：消除镜像目录漂移源、规则随 Space 生命周期（改名/删除/promote/三根读合并）走、靠目录归属不必写 `scope`。配套：`dataDocs` 排除 `<space>/rules/` 避免与 `effectiveDomainRules` 重复计入、`lint` scope 校验同时认新位置、`runIndex` 把 Space 的 `rules/` 列入该 Space index 导航、真实 vault 迁走空目录并建 `spaces/inbox/rules/`。
> - **M（跨 Space 迁移，补职责缺口）**：新增 `move` 脚本子命令（mv 非复制、逐条改写 `sources[].resource` 前缀、共享 Source 留原 Space 不改写、两边 index 重建、默认 dry-run）；`organize` 角色新增「跨 Space 迁移」动作，补上 `space` 角色那句「以后用 organize 迁移」的悬空引用；`SKILL.md` 登记 Space 边界契约与共享 Source 归属。触发：用户显式整理存量、逐组确认。按用户定的边界建 5 个 Space：`dev-tech` / `agent-skill` / `deprecated` / `work` / `side-dev`。`custom/research` 角色固化调研编排。**注：M 的「Source 随搬 / 共享 Source 归属」整块已被 S 推翻，见下。**
> - **S（shelf 待处置区，存储架构重写）**：调试期按「用户 / 逻辑层级、值不值得」推翻 M 与更早结论。核心修正：**Source 与 deprecated 都「待删」，是同一清理流程的两种筛选条件，不是两类东西**——早先把 Source 定性为「永久证据、与 deprecated 性质相反」是错的（默认保留只是策略，不是属性）。落地：
>   - 新增第四个 bundle `shelf/`，内部 `sources/`（原始输入）+ `deprecated/`（废弃结论）两个文件夹**不混合**；各根同构（用户级 / 项目共享 / 项目个人各一份）。
>   - **各 Space 不再有 `sources/` 子目录**；`spaces/deprecated/` 这个 Space 取消（废弃是 `status`，不是领域）；`inbox` 回归纯入口。
>   - 全库 `sources[].resource` 前缀统一 `/shelf/sources/<file>.md`（在 `shelf/` bundle 内解析），**跨 Space 不变、迁移 / 晋升都不再搬 Source、不改写引用**；「共享 Source 留原 Space / 专属 Source 随搬」判定整套删除（`move` 相应简化）。
>   - 命名选定 `shelf`（中文「待处置」）：不暗示永久（否掉 `archived`）、不暗示待消化（否掉 `inbox`）、不暗示只覆盖一类（否掉 `deprecated`）。用户否掉 `attic`（太绕）、`pending` / `triage` 后定 `shelf`。
>   - 新增 `shelf` 脚本子命令：无 `--drop` 只读输出清理清单（「仍被引用 / 建议保留」与「无引用或已废弃 / 可删」两组，附孤儿判定与断链告警）；`shelf --drop <file>` 单条删除、默认 dry-run、`--apply` 才执行、拒绝删除仍被引用的 Source。
>   - 契约条目：触发唯一 = 用户主动提出（不定时 / 不自动批量）；「链」只认活跃文档 `sources[].resource`（日志 / 导航 / 脚注文字 / Rule 来源句都不算，Rule 保持现状不带 `sources[]`）；孤儿判定在合并三根视图上按 `sources[].resource` 严格判；断链禁止抹字段伪造、找不回显式标「出处已丢失」；删除顺序「先删引用方 → 确认无断链 → 再删被引用方」；活跃文档不链向待删目标，已有链降级为纯文字。
>   - **推翻记录**：①「Source 永久保留、与 deprecated 性质相反」→ 都待删、同区；②「sources 独立成第四个 bundle」vs「archived 下两子区」二选一 → 合并为一个 `shelf/`；③「inbox = 共享锚点区」→ inbox 纯入口；④「deprecated 分散更好」→ 集中（待删不需要领域上下文，路径稳定 / 第二维归属这些代价对它不成立）；⑤「deprecated 连专区都不需要」→ 需要，与 Source 共用；⑥「三根架构下专区放哪根是真约束」→ 撤回（用户指出「用户级和项目级都叫 `.mindmate`，本来就该 bundle 一致」，per-root 同构无此约束）；⑦ 上一轮我拿「lint 只扫 Space、集中会脱管」当反对理由 → 判定为调试期实现细节，不该作为架构决策依据（`shelf` 纳入 lint 扫描即可）。
> - **T（Secret 明文架构重写）**：调试期按用户 / 逻辑层级推翻旧方案。讨论收敛过程与结论：
>   - 旧方案：全局唯一 `~/.mindmate-secrets.json`（同步单元之外、config `secrets:` 引用、JSON）。问题：无项目级、与「三根同构」不一致。
>   - 中间被否决的路径：①「一个文件 + `<scope>/<id>` 命名空间」→ 臃肿 + 命名心智负担；②「直接用 `.env` / 纯文本提示」→ 用户否决（要 mindmate 专属文件，且 `.env` 被程序自动加载、明文进运行时）；③「主目录单一目录 + 每项目一个 json」→ 用户否决，要分散、和项目放一起；④「一 secret 一文件」→ 太碎；⑤「自定义定界分块纯文本」→ 还要教用户语法；⑥「dotenv 格式」→ 实测 `util.parseEnv` 对引号 / 反斜杠 / 裸值 `#` 有转义陷阱，会静默破坏随机明文。
>   - **定案**：每根一份 `mindmate-secrets.toml`，路径由根固定、**不可配置**——用户级 `~/.mindmate/`、项目级 `<repo>/.mindmate.local/`（gitignored）、共享根 `<repo>/.mindmate/`（进 git）**绝不放**。格式 TOML（扁平键值、字面串零转义、可注释、Node 内置极小子集解析器）；文件名 `mindmate-secrets.toml`（复数 + 连字符，单一扩展名）。`init` / `init-project` 只生成注释模板、不覆盖已存在文件、绝不写明文。
>   - 关键取舍：明文放进同步单元 / 仓库工作树是**用户显式接受**的风险（「secret 是用户显式维护的，应明确知道其存在及风险」），靠「文件名显式 + 同步排除规则 + `.gitignore` + ACL」管理，不靠隐藏或自动加密。`~/.mindmate/` 因此不再是纯同步单元。
>   - 解析：`secret <id>` 按 `--root` / 项目三根判定读当前根那一份，不跨根翻；带 TTY 检查、会话外执行。元数据归 Card、明文归 secrets 文件，两者分离。
> - **未落地**：③-B 写盘回滚 staging（本会话明确搁置）、内容漂移检测（需版本锚点：`@commit` / 内容哈希，后续演进）、`--rules`/`--roles` 多根分支、主角色门面命令 `/mindmate` 独立触发、sub-agent（已判定不用）。
>
> **③-D 与 ③-C 的边界**：D 只让 `lint` 不误报 `repo://` 引用（格式合法即放行）；真正指向哪个 repo、证据漂移检测（源码变了 → 标记事实需重写 / 退役）、晋升免搬 Source 都依赖 C 的项目根判定，未落地。
>
> 当前实现已是「`SKILL.md` 顶层契约 + `prompts/` 只读模板源 + `commands/mmt/` 薄调度 + `roles/builtin|custom/<slug>/role.md` 可迭代流程 + `scripts/mindmate.mjs` 确定性操作」。结论按确认程度标注，见文末「决策状态」。
>
> **来源**：2026-11-10 关于想法 1（mindmate 架构）的讨论。

---

## 1. 目标

把**可迭代改进的内容全部下沉到用户数据空间**（`~/.mindmate/`，同步单元），skill 本身只保留：

- 顶层架构定义
- 初始调度

动机：本会话为调整流程反复修改 skill 文件十余次。下沉后，改流程只动用户数据，不动 skill / 命令；且随同步单元跨端生效、可按人定制。

**对外的用户体验不变**：六个命令、命令名、参数全部保留。

---

## 2. 顶层 SKILL.md 保留什么

只留「改了会破坏安全或无法自举」的部分，六块：

1. **领域语言**：规范词定义（Space / Source / Idea / Concept / Rule / Role 等）与 `_Avoid_` 边界
2. **四根解析**：`spaces/` `rules/` `roles/` `config.yaml` 的优先级与环境变量；`secrets` 禁区声明
3. **调度表**：六个命令 → 对应角色的映射；「命令 md 只负责加载角色，一次一个」
4. **安全模型**：默认先确认 / 破坏性永远确认 / `--yolo` 边界、明文三条铁律、`config.yaml` 里关确认的显式开关
5. **存储约定**：`type` 白名单、`index.md`/`log.md` 保留名、`okf_version`、时间戳格式 —— 只留脚本与角色共同依赖的最小契约
6. **脚本入口**：`mindmate.mjs` 各子命令调用格式；`secret <id>` 只允许会话外执行
7. **初始化脚本**（主 skill 提供的能力，确定性、零判断）：
   - `init`：建用户级知识库（四根 + `types.yaml`）并写入全局预置角色
   - `init-project`：建项目级知识库（`<repo>/.mindmate/` + `.mindmate.local/`）并写入**项目专家门面角色**
   - 二者是脚本能力，由 `bootstrap` 角色调用；脚本本身不判断、不参与激活链（见 §3、§7A）

另加一节**回答风格**（管所有命令的输出详略，见 §5）。

流程规则、分片逻辑、四段分区、字段 schema、专属 Role Rules 全部下沉。

> `type` 白名单 = 允许写入 frontmatter 的 `type` 取值集合（当前五个：`Source` / `Idea` / `Concept` / `Reference` / `Rule`），脚本 `TYPES` 用它做 `lint` 校验。留顶层是因为脚本与角色共用这份契约，下沉会漂移。

---

## 3. 角色模型

**统一使用 `Role` 概念，不引入 `capabilities` 等新维度。** 理由：命令 md「调派到对应角色」与现有 Role 的调用形态一致；统一后只有一套概念。

**角色是一等公民：出现一类新工作，就考虑新建一个角色，而不是塞进既有角色。** 角色定义放用户数据。

预置角色共 **11 个**（都在 `roles/builtin/`，`init` 脚本生成）：

| 角色 | 职责 | 入口 |
|---|---|---|
| `mindmate` | **主角色 / 纯门面**：接住输入、自我介绍、能力说明。不做调度 | `/mindmate` 门面、无命令兜底 |
| `dispatcher` | **调度器**：非确定路径的「LLM 提议派给 X → 派活确认 → 移交」 | 非确定路径（无命令名 / 意图模糊） |
| `optimizer` | **优化器**：流程/调度的迭代（见 §3 末） | 显式 `/mindmate 优化下路由` 或调度器提议 |
| `bootstrap` | **创建知识库**：接住「帮我建个知识库」→ 确认范围（用户级 / 项目级）→ 调 `init` / `init-project` → 报告 | 非确定路径（`dispatcher` 提议） |
| `role-creator` | **创建自定义角色**：建用户级 / 项目级 custom 角色（含 `extends` 差分、路径绑定、写盘确认） | 非确定路径（`dispatcher` 提议） |
| `capture` | 摄入、分流、分片、落盘 | `/mmt:capture` |
| `ask` | 检索答疑、四段分区输出 | `/mmt:ask` |
| `organize` | 重整理、Idea→Concept 就地转变 | `/mmt:organize` |
| `review` | **纯知识回顾**：建议更新清单（只管 `spaces/` 内容时效，不管 skill 自身优化） | `/mmt:review` |
| `lint` | 脚本检查，只报告不修复 | `/mmt:lint` |
| `space` | Space 列/建/改名/删 | `/mmt:space` |

**不无限回归**：`bootstrap` / `role-creator` 本身由 `init` 脚本写入（预置），不需要被「创建」，链条终止在脚本层。

> 主角色、调度器、优化器是**工作类型维度**；项目专家是**项目级门面角色**（§3 后面，由 `init-project` 生成、每个项目一份，`extends: mindmate` 差分；**不列入全局 11 个清单**）。共享/个人是作用域差异，由路径优先决定。仍不新增命令（`/mindmate` 门面 + 六命令）。

### 预置与自定义：物理分层

用户数据里用两个子目录区分，**不进文件就能看出哪些是预置**：

```
roles/
├── builtin/    ← 预置角色（11 个：主角色 / 调度器 / 优化器 / bootstrap / role-creator / 六命令角色，init 生成）
│   └── <slug>/role.md  (+ rules/)
└── custom/     ← 用户自定义角色（如 todo）
    └── <slug>/role.md  (+ rules/)
```

| | `builtin/` | `custom/` |
|---|---|---|
| 入口 | 命令名显式 | `trigger` 内容匹配 |
| 参与 trigger 匹配 | 否 | 是 |
| 删除后果 | 对应命令失效（严重） | 只是少一个特化 |

- **两个目录里装的都是 Role**，没有新增类型或维度，只是存放位置分层；与「统一用 Role」不冲突。
- **不用 yaml 清单标注**：yaml 本身就是文件，不满足「不进去就能看到」，且与调度表构成双写漂移。
- **可枚举**：`search --roles` 读调度表，输出时标注来源（如 `capture | builtin | entry=command`），用户能明确知道哪些是预置。
- **保留 frontmatter 轻标记**：预置角色带 `entry: command` + 一行「删除会使 `/mmt:xxx` 失效」。理由：可作 `lint` 与调度表的一致性校验，且不替代物理分层（分层解决不进文件就能看到，字段解决机器可校验）。
- **兜底**：调度表指向的角色缺失/损坏时明确报错，不静默降级；但脚本没有删除角色的命令，用户直接在文件系统误删只能事后发现，所以物理分层是唯一的事前防线。

> 演进说明：前面曾有「完全隐式、不加任何标记」「只加 frontmatter 字段」两步结论，均因**要求打开文件才能看到**而被替换。

### 角色 = 门面即角色（不引入 Profile）

**门面就是 Role，不另设 `Profile` 概念。** 每个 Role **绑定一份固定流程**（正是 §1「流程下沉到用户数据」的落点）—— 不是「不含工作流的薄门面」，也不是独立的调度者。

**一次调用必然激活有且仅有一个 Role，没有「不激活」状态。** 入口决定激活谁：

| 入口 | 激活 | 确定性 |
|---|---|---|
| 命令名显式 | `/mmt:capture` → `capture` 角色 | 确定 |
| 无命令、项目上下文 | 由激活优先顺序选中的角色 | 确定（见下） |
| 无命令、无其它命中 | **主角色 mindmate 兜底**（自我介绍 / 能力说明 / 帮助 / 不确定时问用户） | 确定 |

由此 §9 早先的待定解决：不是「不激活角色、只走通用只读检索」，而是「无命令时激活主角色」。现有 `SKILL.md` 探测第 5 步「无匹配走通用流程」需改成「无匹配激活主角色」。

**激活优先顺序**（同一时间只激活一个）：

1. 命令名显式（最高，不可被覆盖）
2. 项目上下文的作用域绑定（见下）
3. `trigger` 内容匹配（`roles/custom/`，LLM 判断）
4. 主角色 mindmate（兜底）

**命中即停只约束确定路径**（命令名命中后不再比对后续级）。**非确定路径（无命令名 / 意图模糊）由 `dispatcher` 角色承担**：它按该顺序提议一个角色 → 派活确认 → 移交，用户拒绝后可改派或走主角色兜底；不做自动「没解决再换角色」的回退重试。所以上表「无命令、无其它命中 → 主角色兜底」指纯门面场景（如问候、问能力），而「无命令但有意义务」走 `dispatcher`。

### 项目专家 = 项目级预置门面角色（由 `init-project` 生成）

**修正**：项目专家不再是「作用域参数绑定到预置角色」，而是一个**门面角色本身**——由 `init-project` 脚本写入项目根，每个项目一份，**不列入全局 11 个预置角色清单**。它是门面（类比主角色 `mindmate`）：接住项目上下文里的输入、自我介绍、能力说明，不做调度。

- 「共享 / 个人」是**作用域维度**（读共享根 `.mindmate/` 还是 local 根 `.mindmate.local/`），由路径优先决定，不是两个不同角色。
- 无命令时，项目上下文按 §7A 的零参数判定选中对应项目专家（作用域绑定决定读/写哪个根），激活的仍是那一个门面角色。
- 一次调用里它与 `capture`/`ask` 互斥：有命令名时走命令名，没有才走项目专家。
- 门面角色与全局预置角色的**差分特化**：项目专家声明 `extends: mindmate`（§3 差分继承），只写项目术语、字段 schema、Role Rules 差异。
- 仍不做嵌套调度 / 同时激活（§3/§6）。

现有 `roles/todo/role.md`（目标架构下为 `roles/custom/todo/role.md`）的 `trigger: 待办 / TODO / 任务 / 加个任务 / 记一下要做` 是优先顺序第 3 级：探测阶段按输入内容匹配，命中后自动切换、明确告知、一次一个。

**「一次一个」的「一次」= 一次命令调用，不是一次会话。** 约束的是同一时刻多个角色的工作流 / Role Rule 叠加冲突；同一会话内可先后激活不同角色，每个命令重新探测。

### 两种路径并存（撤回「不做主控调度」）

**撤回**：早先「顶层不做主控调度、不引入 LLM 判断该派给谁」是过度保守——用确定性当理由设了天花板，而**确认本身就是闸门**。mindmate 的自进化不该从一开始就限死在较低上限。

| 路径 | 触发 | 流程 | 确认 |
|---|---|---|---|
| **确定** | 有命令名 | 直接激活对应角色（不经调度器），零额外负担 | 仅写盘确认 |
| **非确定** | 无命令名 / 意图模糊 | `dispatcher` 提议「派给 X」→ **派活确认** → 移交；拒绝则追问或主角色兜底 | 派活确认 + 写盘确认 |

- **两道闸门分开**：派活确认拦**路由**，写盘确认拦**内容**。只在非确定路径弹派活确认，确定路径不弹。非确定路径的提议由 `dispatcher` 角色承担，主角色只做门面。
- **确认信息必须含路由信息**：激活了哪个角色、将写入哪个根、走哪个流程。否则用户看到的是「将创建 xxx.md」这类结果，拦不住「本来不该写盘」。
- **自进化依托**：`trigger` / 角色描述可改；派活确认里**用户的选择记录下来**写 `~/.mindmate/roles/builtin/dispatcher/evolution.md`（随 dispatcher 角色目录内聚），由 `optimizer` 汇总（见 §3 末）。推荐先给最小非确定路径 + 记录选择，不做「一开始就完美」的调度器。
- **仍不做的**：「没解决再换角色」这类回退重试（会让一次输入产生多次写盘尝试，即使可回滚也是噪音）；共享根里的运行时编排。

> 与「明确不做」里 *Deep Agents 运行时* 的边界：不引入独立进程 / 子代理 / 嵌套编排；非确定路径只是**一次选择 + 用户确认**，仍在单上下文内。

### 主角色 = 纯门面；调度与优化各立角色

**撤回**：早先把「派活流程」放在主角色 `role.md`、把「流程迭代」挂到 `mmt:review` / `log.md` 上，两者都不合理——主角色只是顶层调度之外的门面，而 skill 自身的优化与知识 review 完全是两回事（不同根、不同对象、不同层级）。

按「角色一等公民」拆成三个角色：

| 角色 | 放哪 | 职责 | 不做什么 |
|---|---|---|---|
| 主角色 `mindmate` | `roles/builtin/mindmate/role.md` | 纯门面：接住输入、自我介绍、能力说明 | **不做调度** |
| `dispatcher` 调度器 | `roles/builtin/dispatcher/role.md` | 非确定路径的「LLM 提议派给 X → 派活确认 → 移交」 | 不碰确定路径、不改自身流程定义 |
| `optimizer` 优化器 | `roles/builtin/optimizer/role.md` | 流程/调度的迭代进化 | 不改自己、不改顶层契约 |

**（1）调度分层**：顶层 `SKILL.md` 只留「入口 → 角色」映射 + 激活优先顺序（契约，改了无法自举）；可迭代的提议/派活确认流程下沉到 `dispatcher/role.md`。确定路径**不经调度器**——命令名直达对应角色，调度器只管非确定路径。理由：保住命令名的零误判、少一跳。

**（2）激活链**：无命令时是「主角色 → 调度器 → 目标角色」串行 3 次，任一时刻只有一个（串行接力，§6）。据此把 §3「一次调用有且仅有一个」理解为**任一时刻有且仅有一个、入口只选一次**；提议阶段是调度器的激活态，确认后移交目标角色，不算并发激活。

**（3）进化与知识 review 彻底分离**：

| | 知识 review | 自身优化（`optimizer`） |
|---|---|---|
| 对象 | `spaces/<name>/` 知识文档 | `roles/` 角色定义 + 调度 + 派活策略 |
| 输入 | `stale_after` / draft / 待确认 / 孤立 Concept | 派活确认的选择记录 |
| 产出 | 改知识文档 | 改角色定义 / 调度内容 |
| 层级 | 数据层 | **元层**（改的是后续所有调用的行为） |
| 范围 | 一个 Space | 全局（随 dispatcher 角色目录内聚，不属任何 Space / bundle） |

- **证据分离**：派活选择记录写 `~/.mindmate/roles/builtin/dispatcher/evolution.md`（随 dispatcher 角色目录内聚），**不进** `spaces/*/log.md` —— 否则元层数据混进数据层，且 `mmt:review` 一次只扫一个 Space、读不到 `roles/`（不同 bundle，明确不做跨 bundle 全库搜索），让它汇总角色建议技术上不成立。
- **触发**：显式 `/mindmate 优化下路由`；或派活确认连续被拒时由 `dispatcher` **提议**做一次（要用户确认，不自动）。不做定时 / git-diff 自动回顾。
- **优化器边界**：不改自己的流程定义、不改顶层契约（`SKILL.md` 调度表结构 / 优先顺序），只改 `roles/` 下其它角色与调度内容；改动走 diff 确认 + §5 staging 回滚。理由：自改会失控，顶层改了无法自举。
- `mmt:review` 回归纯知识回顾，两者互不引用。

---

## 4. 场景流程

**统一骨架**（确定路径，所有命令共用）：

```
/mmt:xxx
 → commands/mmt/xxx.md：只读 SKILL.md → 加载 roles/builtin/<xxx>/role.md
 → SKILL.md 顶层（不下沉）：四根解析、安全模型、type 注册表、脚本入口
 → roles/builtin/<xxx>/role.md（用户数据、可迭代）：该场景全部流程 + 专属 Role Rules + 字段 schema
```

**非确定路径骨架**（无命令名 / 意图模糊）：

```
用户输入（无命令名）
 → 主角色 mindmate 接住 → 交 dispatcher 提议 → 派活确认 → 移交目标角色
 → 之后走该角色的（确定路径）骨架
```

### capture

1. 调度到 `capture` 角色；顶层完成探测、读 `confirm`、明文守卫
2. 角色内：分流（知识/想法/规则/卡片）→ 混合输入分片（整表一次确认）→ 补充说明独立成组 → 落点规划（canonical home / Space 不自动建）→ 列写盘清单
3. **确认**（顶层硬约束在此触发，角色规则只能定义「列什么」，不能决定「要不要」）
4. 写 Source / Concept / Idea / Rule → `node mindmate.mjs index` → 追加 `log.md`

### ask

1. 调度到 `ask` 角色；顶层完成探测与硬约束
2. 角色内四分支：角色查询 / 规则查询 / 结构化查询 / 检索
3. 输出四段分区：解答（事实）/ 待探索的想法（非事实）/ 建议（推断）/ 相关约定
4. 默认只读不写盘；`--web` 且用户明确要求落盘时才走 capture 骨架

### 其余（同一骨架，流程更短）

| 命令 / 角色 | 主要动作 |
|---|---|
| organize | 重整理 / Idea→Concept 就地转变；覆盖前 diff 确认（顶层）→ index + log |
| review | 产出建议更新清单 → 用户逐项确认 → 采纳项走 capture 骨架 |
| lint | 调 `lint` 脚本，只报告不修复 |
| space | 列/建/改名/删；建与删需确认 |
| `bootstrap`（非确定路径） | 创建知识库：确认范围 → 调 `init` / `init-project` → 报告；骨架由脚本生成，角色只走流程 |
| `role-creator`（非确定路径） | 创建用户级/项目级自定义角色：确认根 / slug / trigger / extends → 列清单 → 写盘确认 → `role.md` → index + log |

> 角色创建不再由 `capture` 分流承担（旧设计），改由 `role-creator`。

---

## 5. 边界：什么不下沉

| 项 | 结论 | 理由 |
|---|---|---|
| 确认**必须发生**、破坏性永远确认、`--yolo` 不豁免 | 留顶层 | 放进用户数据的规则就能被改写成「不用确认」，安全边界失效 |
| 确认时列哪些字段、清单格式、复述措辞 | 可作 `capture` 的 Role Rule | 纯流程细节 |
| 用户想关确认 | `config.yaml` 显式开关，非角色规则 | 意图明确、可审计、不会被 skill 自己的写盘流程改写；若连破坏性确认也放开，至少保留一句提示 + 写 `log.md` |
| 明文 | **不落盘**（现有铁律不变） | 明文在 `~/.mindmate-secrets.json`，同步单元之外；mindmate 只读脱敏 Card |
| 敏感信息检测、脱敏模板、会话外填充指引、审计建议 | 可下沉 | 流程 |
| 判定权与硬拦截（什么算敏感、是否放行、绝不读 secrets） | 留顶层 | 判定权若在数据里，误写的数据可判「不敏感，直接落盘」 |
| 合规审计 | **不做平级角色**，做成 `capture` 内部必经守卫步骤 | 不改「一次一个」、不把判定权交给可改写的数据；硬拦截留顶层（类似 `terminal-assistant` 的「提示层 + hook 强制层」双层） |
| 回答风格 | **留顶层**（不放 `ask` 角色） | 约束所有命令的输出，不只是 `ask`；是「怎么答」不是「答什么」。另在全局 rules 有一份，两处是有意并存 |
| 统一输出的「回答问题角色」 | **不设** | 输出内容由各角色产生，再过一道转述会多一次加载、多一处失真；顶层一节已够 |

### 写盘可回滚

确认能拦路由与内容，回滚兜底误写后的恢复。**待详细讨论**，当前维度与推荐：

| 维度 | 推荐 |
|---|---|
| 粒度 | 一次写盘动作（对齐确认粒度） |
| 范围 | 被覆盖文件 + 派生的 `index.md` / `log.md`；Source 只追加，不需回滚 |
| 存放 | `~/.mindmate/.staging/<ts>/`，本地不同步；共享根的 staging 不进 git |
| 触发 | 写盘前自动备份；失败 / 拒绝自动恢复，另提供显式撤销 |
| 命令数 | 做成 `mmt:organize` 的一个动作，**不新增第七个命令** |

**硬限制**：共享根 `<repo>/.mindmate/` 一旦 push，别人已 clone，本地回滚撤不回外发。所以回滚**不能覆盖共享根的外发风险** —— 默认写 `.mindmate.local/` 仍然必要，晋升仍需显式确认。

---

## 6. 角色协同

**允许串行接力，禁止同时激活。** 串行接力不违反「一次一个」，且显式链接比 `trigger` 内容自动匹配更确定。例：`capture` → `todo` 分析处理。

三条边界：

1. **链由角色定义声明**（如 `capture` 的 `role.md` 写「后续可接 `todo`」），编排权下沉到用户数据；顶层只留硬边界：最大深度、禁止自环、终止条件
2. **每步写盘各自确认**，不合并成一次 —— 否则一次误判连带多次写盘
3. 中间结果显式传递，不隐式共享上下文

**不使用 sub-agent。** 理由：

1. 角色接力只是「换一套规则」，同一上下文里顺序加载 `role.md` + Role Rules 即可，无需独立进程
2. sub-agent 切断共享上下文，中间结果 / 出处脚注 / 确认状态都要序列化传递，写盘安全模型难以统一
3. 派发/回收 sub-agent 需要运行时调度，即前面否掉的「主控调度」

何时才值得 sub-agent：角色需要独立长上下文、并行执行，或隔离不可信输入（如 pane 采集内容）。mindmate 的角色链是串行、确定性、共享同一批文件，三条都不满足。

---

## 7. types 动态扩展

**应该支持，但支持「声明式扩展」，不是「任意 type」。**

依据：今天加 `Idea` 改了 SKILL.md、capture.md、ask.md、lint.md、review.md、脚本 `TYPES`、命令描述等 5+ 处，是痛点；但允许任意字符串当 type，脚本就不知道它该进哪个检索分区、能不能当事实引用、要不要校验出处，行为依据全丢。

**动态的是「类型集合」，不是「行为原语」。** 注册表放用户数据（`config.yaml` 的 `types:` 段或独立 `types.yaml`），每个 type 声明一组**封闭槽位**；脚本按槽位驱动，不再硬编码 `TYPES`。

| 槽位 | 取值 | 作用 |
|---|---|---|
| `partition` | `facts` / `ideas` / `rules` / `none` | 决定 search 进哪个分区 |
| `citable` | true / false | 能否进「解答（事实）」 |
| `provenance` | `required` / `none` | 是否强制出处脚注校验 |
| `index_marker` | 字符串或空 | `index.md` 导航标记 |
| `transitions` | type 列表 | 允许就地转变成什么 |
| `owner` | 角色名 | 哪个角色创建 / 消费它 |

```yaml
types:
  Idea:
    partition: ideas
    citable: false
    provenance: required
    index_marker: " · Idea"
    transitions: [Concept]
    owner: capture
  Concept:
    partition: facts
    citable: true
    provenance: required
    index_marker: ""
    transitions: []
    owner: capture
```

**脚本侧**：`TYPES` 与 `lint` 类型校验改为读注册表；`search` 按 `partition` 分派；`runIndex` 按 `index_marker` 加标记；`organize` 按 `transitions` 校验转变。新增类型 = 加一条声明 + 写对应角色规则，不动 skill / 脚本 / 命令。

> **落地注记（③-A）**：前四项已由 ① 在脚本实现；`transitions` / `owner` 的消费**落在流程层**（`organize` / `capture` 的 `role.md` 读注册表判断），未改脚本——脚本只解析与校验槽位、不消费。理由：消费属可迭代流程，下沉到用户数据更贴合 §1。

**三条边界**：

1. **不放运行时兜底副本**：skill 里可以有一份 `init` 用的一次性模板，但**运行时绝不读它** —— 运行时唯一真源是用户数据的注册表。这样不会出现「改了用户数据、脚本却用内置副本」的双写漂移。内置的是三样：
   - **槽位枚举**（`partition` 只能取 `facts`/`ideas`/`rules`/`none` 等）—— 属顶层「格式约定」，封闭
   - **保守降级**：注册表缺失或损坏时，未知 type 一律按 `citable=false, partition=none, provenance=required` 处理，并**明确报错提示修复**，不静默放行、不回退到「五个内置 type 合法」
   - **`init` 生成默认注册表**到用户数据（一次性模板写盘），用户首次使用零配置；已有注册表**不覆盖**
2. **槽位封闭**：只能组合已有槽位，不能新增槽位 —— 加槽位等于改「顶层架构定义」，仍要走 skill
3. **正交与留顶**：`status`（draft/deprecated）是独立维度，不进注册表；安全模型、明文铁律、type 的**格式约定**仍留顶层

**缺失 vs 损坏要分开**：从未配置（文件不存在）→ `init` 生成即可，属正常路径；配了但解析失败 → 保守降级 + 报错，防止用户以为配置已生效。前者平滑，后者不放行。

这里「内置 vs 下沉」的切分是：类型集合与槽位值下沉到用户数据，槽位枚举与格式约定内置在 skill。（注意：这不回答主角色的归属，主角色的落点见 §3。）

---

## 7A. 项目级特化（repo 模式）

对应想法 1 的「项目级特化，项目级 config 判断？」。参考 CodeBuddy 的项目级/用户级扩展机制与 `langchain-ai/openwiki` 的 code/personal 双模式。

### 同构性判断

**结构层同构，调度层不同构。**

- 创建成本低：agent 的 skill = 一个目录 + `SKILL.md`；sub-agent = 单个 `.md`；mindmate 的 role = 一个目录 + `role.md` + 可选 `rules/`，同一量级。所以「项目专家角色」不需要造新概念，一个目录即可 —— 真正的成本在**作用域判定与冲突规则**，不在建文件。
- agent 的调度靠 `description` **语义匹配**（LLM 判断该不该加载）；mindmate 靠**命令名显式**（确定性）。可以类比创建成本，**不要把语义触发搬过来**（与 §3 否掉主控调度同理）。

### openwiki 双模式对照（事实，来自本地仓库 README）

| 模式 | 文档来源 | 写到 | 安全姿态 |
|---|---|---|---|
| **Code**（默认） | 当前仓库 | `openwiki/`（repo 内，随 git 共享团队） | 写入限制在 docs 树 |
| **Personal** | 连接器 / 个人来源 | `~/.openwiki/wiki` | 禁 shell |

关键点：**不合并** —— 两个独立根、同一套 OKF v0.2 格式（与 mindmate 同规范）、显式选模式。个人侧 skills / 连接器 / 会话历史都在 `~/.openwiki/`。

### 对 mindmate 的方案（含后续修正）

**三个根，共享同一 `types.yaml` 与 OKF 格式**：

| 根 | 位置 | 归属 | git |
|---|---|---|---|
| 个人全局 | `~/.mindmate/` | 个人，跨端同步 | 否 |
| 项目共享 | `<repo>/.mindmate/` | 团队共享 | 是 |
| 项目个人 | `<repo>/.mindmate.local/` | 个人本地 | **否**（`.gitignore`） |

- **两个并列目录而非单文件**：单个 `LOCAL.md` 不够——它没有四根、没有 Source/Concept/Idea、没有出处校验与 `index.md` 生成，无法复用 mindmate 流程。完整目录树可用同一套脚本跑（control root 已参数化：`--root` / `MMATE_ROOT`），流程完全复用，不用改架构。
- **写入默认走 `.mindmate.local/`**；只有用户明确「晋升到 `.mindmate/`」时才写共享根。**显式动作，不是默认**——个人随手记不会误进 git，不可撤销风险归零。
- **晋升 = 移动**（local 删除 + 共享新建），不是复制。理由：不产生双份、不触发读取优先级冲突。删除属破坏性，由写盘确认兜住。
- **读取优先级**：项目共享 > 项目 local > 个人全局。理由：与「晋升」语义一致——晋升后共享版本应成为权威；若 local 覆盖共享，晋升后读到的仍是个人版，晋升就失去意义。三个根并存，但写侧只有一个默认目标，复杂度可控。
- **零额外参数**：项目根用 `CODEBUDDY_PROJECT_DIR` / cwd 向上找判定，确定性；**指令分析否**（LLM 判断，与 §3 否掉主控调度同理）。
- **读写分离**：读可按优先级确定性合并；写**不能只靠优先级**（优先级解决「从哪读」，不解决「写到哪」）。写盘前确认里明确列出将写入哪个根。

> 撤回记录：①「repo 内不再区分共享/个人、个人笔记全放 `~/.mindmate/`」→ 改为三根；②「repo 内用单个 `local/` 子目录 + `.gitignore`」→ 改为完整并列目录；③「默认写入项目根」→ 改为默认 `.mindmate.local/`。

> **④ 读取改为「按条目合并 + 标源」，撤回「优先级覆盖」（C1 落地时定案）**：三根顺序 shared > local > global 只作**展示顺序**，同名条目**全部列出、各自标注来源根、不按优先级挑一份**，由用户判断。理由：符合「冲突交用户裁决」的一贯原则。这与「晋升后共享版本应成为权威」并不矛盾——晋升是**单文档移动、local 里该文档删除**，晋升后同名冲突自然消失，共享成为该文档唯一权威，无需优先级覆盖来达成。
>
> **C1 落地范围（只读）**：`findProjectRoot()`（cwd / `CODEBUDDY_PROJECT_DIR` 就近找 `.mindmate/` 或 `.mindmate.local/`，排除 `~/.mindmate` 本身）+ `resolveSearchRoots()`（有显式 override 退化为单根、无项目根单根、缺根跳过不补建）+ `search`（query / `--where` / `--sort` 跨根按条目合并、每分区标 `root=`、顶部 roots 横幅、Navigation 分段标根）。`--rules` / `--roles` 早返回分支仍单根（列清单 / 看详情，非检索合并）。**单根输出字节不变**（C1 验证过零回归）。
>
> **C2 落地范围（写）**：`roots` 只读子命令（打印 `scope` / 三根 / `write_root`=有项目→local、无→全局 / `*_exists`）+ `promote <file>` 子命令（单文档 local→shared **移动**：shared 新建 + local 删除 + 重建两边 index；dry-run 默认、`--apply` 才执行；目标已存在 / 无项目根 / reserved 文件 / 文件不在 local 下均明确报错）。脚本 `index`/`space` 已支持 `--root`，**写命令本身无需改**。`--root` 是「让确定性命令作用于指定根」，不改变「全局根」判定——为此拆出 `globalControlRoot()`（只认 `MMATE_ROOT`，不含临时 `--root`），否则显式 `--root` 会把 `~/.mindmate` 误判成项目根。
>
> 流程层：6 个写类角色统一加「写目标根（C2）」段（写前跑 `roots`、所有 `index`/`space` 命令带 `--root <write_root>`、写盘确认列明目标根、默认不写共享根）、`organize` 加「晋升」动作（调 `promote`）、`dispatcher` 派活确认目标根改由 `roots` 给出、`role-creator` 目标根改 `write_root`；`SKILL.md` 安全模型加「写盘确认列根 / 晋升破坏性 / 共享根外发不可回滚」、脚本入口登记 `roots`/`promote` 与 `--root <write_root>` 用法、commands 速查同步。clone 只有共享根时（`local_exists=false`）用 `init-project --project <repo> --apply` 幂等补建 local 根。
>
> **C3 落地范围（证据复核，只读）**：`repo-check --space <name> [--root <write_root>]` 只读子命令——扫该 Space 所有文档的 `sources[].resource` 与正文链接里的 `repo://`，用项目根逐条判定 `ok` / `missing`（文件不存在）/ `range`（`#L` 行号超出当前文件行数）/ `no-project`（无项目根，如实说明无法核对）/ `invalid-format`（含原因），带 `doc` 与 `root=` 标源、末尾 summary。**判定口径轻量**：只查「文件存在 + 行号范围」，**不判源码内容是否变化**（`repo://` 引用不带版本基线 / commit / 内容哈希，无法比对；不依赖 git、不存哈希、不改格式）。触发纪律：`mmt:review` 用户主动要求才跑（并入建议更新清单、逐项确认才改、默认只报告），`ask`/`capture` 处理中遇到问题只附「建议复核」提示、不自动改、不自动触发、由用户决定；不定时、不自动、不全库，不撤回 §9「不做 git-diff 自动回顾」。内容漂移检测（需版本锚点）属后续演进。
>
> 至此 ③-C1（读）+ ③-C2（写）+ ③-C3（复核）全部落地，项目级三根闭环。

### 知识库与角色的创建链（三层，不无限回归）

**创建知识库 / 创建角色都是「工作」，各由一个预置角色负责；骨架由脚本生成。** 三层分工：

| 层 | 内容 | 由谁生成 |
|---|---|---|
| 脚本能力（主 skill） | `init`：建用户级知识库（四根 + `types.yaml`）并写入全局 11 个预置角色；`init-project`：建项目级三根并写入项目专家门面角色 | 主 skill 提供，确定性、零判断 |
| 预置角色（全局） | `bootstrap`（创建知识库流程）、`role-creator`（创建用户级/项目级自定义角色） | `init` 写入 `roles/builtin/` |
| 门面角色（项目级） | 项目专家：一份定义 + 作用域绑定，决定读共享根还是 local 根 | `init-project` 写入项目根 |

- **不无限回归**：两个创建角色本身由 `init` 脚本写入（预置），不需要被「创建」，链条终止在脚本层。修正早先「创建角色的角色会无限回归」的论证。
- **脚本 ≠ 角色**：脚本是可调用能力（确定性、无判断、模板一次性生成）；角色是流程（接住意图、规划、派活确认、调脚本/写定义）。两者不重叠，所以「创建项目级知识库的角色」与「创建项目级角色的角色」不需要各立一个——建骨架是 `init-project` 脚本，建自定义角色是 `role-creator` 一个角色覆盖所有根。
- **触发**：`bootstrap` / `role-creator` 走 `dispatcher` 非确定路径（「帮我建个知识库 / 建个 XX 角色」→ 提议 → 派活确认 → 激活）。不新增命令。
- **建自定义角色流程**：确认目标根（个人全局 / 项目共享 / 项目个人）、slug、`trigger`、是否 `extends` 差分继承普适角色、字段 schema / Role Rules → 列写盘清单（含目标根与路径）→ 写盘确认 → 写 `role.md`(+ `rules/`) → `index` + `log`。已有同名角色走更新或拒绝，不静默覆盖。

### repo 模式的 Source 特殊性

**引用而非快照**（openwiki 的 Grounded Claims 事实）：指向 `repo://src/server.ts#L40-L82` 这类**版本化源码证据**，带 evidence version；更新时复核，证据变了/消失就标记对应事实需重写或退役。原因：项目文件持续演进，快照会立刻过期，只有引用 + 版本才能做漂移检测。

| 类型 | 例子 | 形态 |
|---|---|---|
| 源码证据 | `src/*.ts#Lx-Ly`、测试 | 引用 + 版本 |
| git 证据 | commit、blame、diff | 引用 + commit |
| 团队文档/决策 | repo 内 docs、PR、issue、`INSTRUCTIONS.md` | 文件或引用 |
| 运行时证据 | CI 日志、测试输出、LangSmith traces | 引用（openwiki 里这类不被 claim） |
| 用户键入 | 粘贴/口述 | 快照，同 personal |

- **与现有 `lint` 的冲突**：Q85 把 `sources[].resource` 当**文件路径**解析（`linkExists`），`repo://...#L40-L82` 会被判不存在 → ERROR。**推荐**：扩展一种 resource scheme（识别 `repo://` 协议、行号、版本），不改现有文件路径语义。理由：防幻觉意图不变，只是多一种合法出处形态。
- **晋升时的简化**：若 Source 是项目文件引用（本来就在 git 里），晋升文档时**无需搬 Source**；只有「用户键入的快照型 Source」才需随文档一起移动。

---

## 8. 与想法 1 的对应

想法 1 六条待确认中，本次讨论涉及：

| 条目 | 状态 |
|---|---|
| 架构抽象，多角色分工 | 已讨论 → §1–§4 |
| 主角色内置 or 知识库中？ | 结论：**用户数据**（`roles/builtin/mindmate/role.md`），与其它预置角色同处、可迭代；顶层只留调度契约。早期「内置 SKILL.md」结论作废（§3） |
| 是否使用子agent | 结论：**否**（§6） |
| 项目级特化，项目级 config 判断？ | 已讨论并定案（§7A）；三根、零参数判定、读写分离、默认写 `.mindmate.local/`、显式晋升 |
| 天机角色 | **未讨论** |
| mmt types 动态扩展 | 已讨论并定案（§7），**① 脚本层 + ③-A 流程层均已落地** |

---

## 9. 决策状态

| 结论 | 状态 |
|---|---|
| 可迭代内容下沉用户数据、skill 只留顶层架构 + 初始调度 | 已确认（方向） |
| 显式命令入口保留、对用户体验不变 | 已确认 |
| 统一用 `Role`，不引入 `capabilities` | 已确认（撤回早先「别复用 roles/」的保守意见） |
| 预置/自定义用 `roles/builtin/` + `roles/custom/` 物理分层 | **已确认**（撤回「完全隐式」「只加 frontmatter 字段」两步结论） |
| 预置角色可枚举（`search --roles` 标注来源） | **已确认**（§3） |
| 顶层 SKILL.md 六块内容 | 已确认 |
| 回答风格留顶层 + 全局 rules 两处并存 | 已确认并已落地（两个文件已改） |
| 不设统一输出角色、各角色自定义输出格式 | 已确认 |
| 「一次一个」= 一次命令调用 | 已澄清（现有规则） |
| 允许串行接力、禁止同时激活 | **③-A 按推荐采用并落地**（`SKILL.md` 调度表 + `dispatcher` / `mindmate` role.md） |
| 不使用 sub-agent | **③-A 按推荐采用并落地**（`dispatcher` role.md 硬约束） |
| 写盘确认 / 明文 / 合规审计的边界（§5） | 讨论结论；写盘确认 / 明文已落地，合规审计细节仍待拍板（③-B 关联） |
| **两种路径并存**（确定：命令名直达；非确定：LLM 提议 + 派活确认） | **已确认**（本轮，撤回「不做主控调度」） |
| 两道闸门分开：派活确认拦路由、写盘确认拦内容 | **已确认**（本轮） |
| 确认信息必须含路由信息（角色 / 目标根 / 流程） | **已确认**（本轮） |
| 自进化依托：记录派活确认的用户选择，沉淀进用户数据 | **已确认**（本轮） |
| 不做「没解决再换角色」回退重试；不引入独立进程 / 子代理 / 嵌套编排 | **已确认**（本轮） |
| 写盘可回滚（§5）：维度与推荐已列，**方案待详细讨论** | 方向已确认，细节待定 |
| 主角色定义在 `roles/builtin/mindmate/role.md`（撤回 §8「内置 SKILL.md」） | **已确认** |
| 角色一等公民：新工作立新角色；预置角色扩为 11 个（主角色 / `dispatcher` / `optimizer` / `bootstrap` / `role-creator` / 六命令角色） | **已确认**（本轮） |
| 主 skill 新增 `init` / `init-project` 两个脚本能力：建骨架 + 写入预置角色 / 项目专家 | **已确认**（本轮） |
| 创建链三层（脚本 / 全局预置创建角色 / 项目级门面角色），不无限回归 | **已确认**（本轮，撤回「无限回归」论证） |
| `bootstrap` 管建库、`role-creator` 管建自定义角色，均走 `dispatcher` 非确定路径、不新增命令 | **已确认**（本轮） |
| 角色创建从 `capture` 分流移出，归 `role-creator` | **已确认**（本轮） |
| 主角色 = 纯门面，不做调度；调度归 `dispatcher`、优化归 `optimizer` | **已确认**（本轮，撤回「提议流程放主角色」） |
| 调度分层：顶层留映射/优先顺序契约；提议+派活确认流程下沉 `dispatcher/role.md` | **已确认**（本轮） |
| 确定路径不经调度器（命令名直达）；非确定路径才由 `dispatcher` 提议 | **已确认**（本轮） |
| 激活链 = 主角色 → 调度器 → 目标角色串行，任一时刻一个；「一次调用有且仅有一个」按此理解 | **已确认**（本轮） |
| 进化与知识 review 分离：证据写 dispatcher 角色目录下 `evolution.md`，`optimizer` 汇总，`mmt:review` 回归纯知识回顾 | **已确认**（本轮，撤回「log.md → review 汇总」） |
| 优化器边界：不改自己、不改顶层契约；diff 确认 + staging 回滚 | **已确认**（本轮） |
| 角色 = 门面即角色，绑定固定流程，不另设 `Profile` | **已确认**（本轮，撤回「薄门面不含工作流」） |
| 一次调用必然激活有且仅有一个 Role，无「不激活」状态 | **已确认**（本轮） |
| 无命令时激活主角色 mindmate 兜底（改为「不激活、通用只读」的待定结论） | **已确认**，§9 待定已解决 |
| 激活优先顺序：命令名 > 作用域绑定 > trigger > 主角色；命中即停 | **已确认**（本轮） |
| 项目专家 = 项目级预置门面角色（由 `init-project` 生成，每项目一份、`extends: mindmate` 差分；不列入全局 11 个清单） | **已确认**（本轮，撤回「非独立角色 / 作用域绑定」） |
| types 动态扩展注册表方案（§7） | **已定案并全部落地**：① 脚本层（注册表读取、槽位驱动、保守降级、init 生成）；③-A 流程层（`organize` 按 `transitions` 校验就地转变、`capture` 按 `owner` 消费） |
| 项目级特化：三根 + 共享注册表（§7A） | 已确认（撤回「两模式、repo 内不区分」） |
| 项目根判定用 cwd / 环境变量，零参数；指令分析否 | **③-C1 已落地**（`findProjectRoot()` 就近找 `.mindmate/`/`.mindmate.local/`，排除 `~/.mindmate` 本身；显式 override 退化为单根） |
| 读按三根按条目合并、每条标源、同名全列出不覆盖 | **③-C1 已落地**（撤回「优先级覆盖」；`search` 三分区标 `root=`，单根零回归） |
| 默认写 `.mindmate.local/`，显式晋升到 `.mindmate/` | **③-C2 已落地**（`roots` 给 `write_root`，写盘确认列明目标根；6 写类角色 + commands 的 `index`/`space` 带 `--root <write_root>`；共享根外发不可回滚） |
| 晋升 = 单文档移动（local 删除，非复制） | **③-C2 已落地**（`promote <file>`：shared 新建 + local 删除 + 重建两边 index，dry-run 默认、`--apply` 显式；`organize` 晋升动作） |
| 写盘确认 / 明文 / 合规审计的边界（§5） | 讨论结论；写盘确认 / 明文已落地并加「写盘确认列根 / 晋升破坏性」；合规审计细节仍待拍板（③-B 关联） |
| repo Source = 引用 + 版本；`lint` 扩展 `repo://` scheme | **③-D 已落地**（格式校验：协议 / 相对路径 / `#L` 行号片段；不查文件存在）；**③-C3 已落地**证据复核（`repo-check` 查文件存在 + 行号范围，用户主动触发 / 处理中只提示）；内容漂移检测（需版本锚点）仍属后续演进 |
| 上述 role 架构改造 | **① + ② + ③-A + ③-D + ③-C1 + ③-C2 + ③-C3 + R + S 已落地**（顶层契约 / 调度表 / 11 角色 / builtin·custom / 非确定路径 / 派活确认 / evolution.md / 角色创建归位 / repo:// lint / 项目根判定 + 读合并标源 / 写目标根 + 晋升 / 证据复核 / 规则内聚 / shelf 待处置区）；**③-B 回滚 staging（本会话搁置）、内容漂移检测（版本锚点）未落地** |
| **S：Source 与 deprecated 都待删、同放 `shelf/`** | **已确认并落地**（撤回「Source 永久证据」「inbox 锚点区」「deprecated 分散」「专区三根真约束」等；调试期按用户 / 逻辑层级决策，不以现有实现为依据） |
| `shelf/` 为第四个 bundle，各根同构；Space 内不再有 `sources/`，取消 `deprecated` Space | **已确认并落地** |
| **T：每根一份 `mindmate-secrets.toml`（TOML、路径固定不可配、共享根不放）** | **已确认并落地**（撤回「全局单 json / 命名空间 / .env / 一 secret 一文件 / 自定义分块 / dotenv 格式」等全部中间方案；明文位置改由用户显式承担风险） |
| **不建 secret 专门角色；改为消除双写、把规则收口到契约节** | **已确认**（理由：secret 是安全边界 + 确定性读写能力，没有可迭代的多步流程；判定权不能下沉到可改写的角色数据；可迭代的填充话术本就在 `capture` 单点。曾提议立角色，判定为不值得） |
| secret 位置 / 格式 / 风险规则 = `SKILL.md`「Secret 与明文」节唯一定义；流程层只指回契约 + 模板头注释 | **已落地**（`capture` / `ask` / `lint` 去掉具体文件名、路径、TOML 写法、同步排除细则，只剩「明文铁律」与话术；含具体文件名的文件收敛到 SKILL.md / 脚本 / DESIGN.md 三处）。改格式 / 位置只动脚本模板 + 契约节（+ 文件名变时的 `.gitignore`），角色不动 |
| 清理触发唯一 = 用户主动；不定时 / 不自动；逐条确认 | **已确认并落地**（契约条目 + `shelf` dry-run / `--apply`） |
| 「链」只认 `sources[].resource`；Rule 不算引用、保持现状 | **已确认并落地** |
| 孤儿判定合并三根、按 `sources[].resource` 严格判；断链禁止抹字段 | **已确认并落地** |
| 规则就近内聚：Space 绑定 Domain Rule 放 `spaces/<name>/rules/`，顶层 `rules/` 降级为全局/跨 Space 容器 | **R 已落地**（撤回「`rules/` 与 spaces/roles 对等三 bundle + `rules/spaces/<name>/` 镜像」；与 Role Rule 内聚对称、消除漂移、规则随 Space 生命周期走；`dataDocs` 排除 + lint/index 适配 + 真实 vault 迁移） |
| 角色创建从 `capture` 分流移出，归 `role-creator` | **③-A 已落地**（capture 模板源 + role.md 删分支，建角意图交非确定路径） |
| 5 个架构角色从骨架补完整流程 | **③-A 已落地**（`prompts/<slug>.md` 模板源 + 真实 vault `role.md` 双写一致） |
| `evolution.md` 记录派活选择、`optimizer` 汇总 | **③-A 已落地**（`SKILL.md` 调度表 + `dispatcher` / `optimizer` role.md；staging 回滚仍待 ③-B） |
