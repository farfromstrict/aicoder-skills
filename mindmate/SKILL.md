---
name: mindmate
description: 个人助手 / 第二大脑。接收用户输入的内容，整理沉淀为 OKF v0.2 知识库，并基于知识库检索、答疑、给出建议。当用户要记录/整理/归档内容、问「我之前记过什么」、或要求基于自己的笔记做分析与建议时使用；也用于 /mmt:* 子命令。
---

# mindmate

把用户输入沉淀进纯文件的 OKF v0.2 知识库，再基于该知识库做检索、答疑与建议。skill 本身通用、无状态；**所有可迭代的流程都在用户数据 `~/.mindmate/roles/builtin/<slug>/role.md`**，由 `init` 从 skill 内只读模板源 `prompts/<slug>.md` 下发；改流程只动用户数据，不动 skill / 命令。skill 只保留顶层架构契约与初始调度。

## 回答风格（所有命令通用）

**本节的唯一出处在此，命令文件与角色定义不得另写一份。**

1. 答案确定 → 只给结论，精简明确，不附冗余（出处、背景、过程说明、重复复述）。例如「列出想法」就只列想法，不连带贴 Source 原文。
2. 答案不确定 → 精简明确地把问题反馈给用户；有可能就给推荐 + 一句理由。
3. 不为显得完整而同时做 1 和 2。

> 与「安全模型」的边界：安全模型管**写盘前的确认**，本节管**回答的详略**；`confirm: always` 不因本节而豁免。

## 调度表（顶层契约，改了无法自举）

**六个命令不变**（不新增第七个命令）。命令 md 只负责「读本文件 → 加载对应角色」，一次一个；流程全在角色定义里。

| 命令 | 激活角色 | 角色定义（用户数据、可迭代） | 确定性脚本 |
|---|---|---|---|
| `mmt:capture` | `capture` | `roles/builtin/capture/role.md` | `index` |
| `mmt:organize` | `organize` | `roles/builtin/organize/role.md` | `index` |
| `mmt:ask` | `ask` | `roles/builtin/ask/role.md` | `search` |
| `mmt:review` | `review` | `roles/builtin/review/role.md` | — |
| `mmt:lint` | `lint` | `roles/builtin/lint/role.md` | `lint` |
| `mmt:space` | `space` | `roles/builtin/space/role.md` | `index` |

**确定路径（有命令名）**：命令名直达对应角色，**不经调度器、不弹派活确认**。命令 md 用 Read 工具整篇加载该 `role.md`；**只加载这一个角色，不一次读多个，不回退读 skill 内 `prompts/`**。调度表指向的角色缺失 / 损坏时**明确报错，不静默降级**——`roles/builtin/` 物理分层是防误删的事前防线。

**非确定路径（无命令名 / 意图模糊）**：无命令、无其它命中的纯门面场景由**主角色 `mindmate` 兜底**（自我介绍 / 能力说明 / 帮助 / 不确定时问用户）；主角色是纯门面，**不做调度**。有实际义务的输入由主角色递给 `dispatcher`：按激活优先顺序**提议一个角色** → **派活确认** → 移交目标角色，之后走该角色的确定路径骨架。主角色 → 调度器 → 目标角色是**串行接力**，任一时刻只激活一个。

**激活优先顺序**（非确定路径用）：命令名显式 > 项目上下文作用域绑定 > `trigger` 内容匹配（`roles/custom/`，LLM 判断） > 主角色兜底。命中即停只约束确定路径。一次「一个」= 一次命令调用，不是一次会话；允许串行接力（`role.md` 声明「后续可接 X」），禁止同时激活、不做「没解决再换角色」的回退重试、不使用 sub-agent / 独立进程。

**两道闸门（分开，不可合并、不可省）**：
- **派活确认**（拦**路由**，仅非确定路径）：确认信息必须含**角色 / 目标根 / 流程**三要素，否则拦不住「本来不该写盘」。目标根由 `roots` 的 `write_root` 给出（有项目→local，无→全局，见 C2）。**「目标 Space」仅写类流程必选**（capture / organize / research 落盘，须一次选定唯一归属 Space）；读类流程（ask 等）默认全库检索，**不带、不弹目标 Space**。拒绝则改派一次或退回主角色兜底，不做自动回退重试。
- **写盘确认**（拦**内容**）：由目标角色按「安全模型」触发，确定 / 非确定路径都要走；`--yolo` 不豁免破坏性确认。

> **建库例外（控制面初始化）**：`bootstrap` 的建库动作（新建根 / 骨架，非知识内容写入）路由确定，派活确认拦不住额外风险，故**合并为一次写盘确认**——`probe → 一次确认（含目标根 + `--roots` + 骨架清单）→ --apply`，不经 `dispatcher` 派活确认。两道闸门对**知识内容写入**照旧分开。建库类输入按 `trigger` 直达 `bootstrap`，不进非确定路径提议；范围中途变化（写盘内容变了）才重新确认一次。

**自进化记录**：`dispatcher` 把每次派活确认的「提议角色 / 用户选择 / 是否改派 / 时间戳」append 到 `~/.mindmate/roles/builtin/dispatcher/evolution.md`（append-only，纯 prose，随 dispatcher 角色目录内聚，不在 `spaces/*/log.md`）。`optimizer` 读它汇总出「建议调整 trigger / 角色描述 / 调度内容」清单，用户逐项确认后改 `roles/` 下其它角色——**不改自己、不改顶层契约、不改知识文档**，与 `mmt:review`（纯知识回顾）彻底分离。optimizer 触发：显式「优化下路由」或派活确认连续被拒时由 `dispatcher` 提议（要用户确认，不自动）。

角色查看用 `mmt:ask --roles [slug]`；创建 / 编辑 / 作废自定义角色由 `role-creator` 承担（走 `dispatcher` 非确定路径），作废用 `status: deprecated`。`bootstrap` 管建库（按 `trigger` 直达，见上例外）、`role-creator` 管建角（走非确定路径），二者都不新增命令。角色不新增 skill、不新增命令、不属于任何 Space。

## 探测（每次先做，不要跳过）

**一次性探测（优先）**：在**首个 LLM 回合**发起一次 `node mindmate.mjs probe --input "<用户输入>"`，把下方 1–4 的确定性结果（五根 / `write_root` / `*_exists` / `bootstrap` / `confirm` / Space 列表 / 候选角色元数据）与 `route` 命令名标记作为结构化块返回。它把原本要分别跑的 `roots` / `space --list` / `search --roles` / 读 `config.yaml` 四个 `tool_use` 合成一个——**不使用宿主 hook，回合数不变**（仍是「探测回合 → 派活确认回合 → 确认后合批回合 → 答案回合」四回合）；合批只减少单回合内的工具数。`probe` 是只读脚本、自身 0 次 LLM 语义判断：`route=command:<slug>` 仅复刻既有「命令名 → 角色」映射、不改调度表；其余输入标 `route=dispatcher`，由 `dispatcher` 按原激活优先顺序处理（**主角色兜底保留**：问候 / 帮助 / 自我介绍转回 `mindmate`）。**probe 不替代探测本身**——首次运行 `bootstrap=need_bootstrap` 时仍走第 2 步的骨架展示与确认；语义分流（问候 / 帮助 / 有实际义务）仍由 LLM 完成。命令名显式、`--root` 等 override、secrets 禁区规则不变。

1. **解析五个根**（均为平台无关 home 展开，不硬编码绝对路径）：
   - `spaces/`：`--spaces` > 环境变量 `MMATE_SPACES` > `config.yaml` 的 `spaces` > 默认 `~/.mindmate/spaces/`。整体覆盖可用 `MMATE_ROOT` / `--root`。
   - `shelf/`：`--shelf-root` > 环境变量 `MMATE_SHELF` > `config.yaml` 的 `shelf` > 默认 `~/.mindmate/shelf/`。待处置区 bundle，见「shelf 待处置区与清理」。
   - `rules/`：`MMATE_RULES` > config 的 `rules` > 默认 `~/.mindmate/rules/`。
   - `roles/`：`MMATE_ROLES` > config 的 `roles` > 默认 `~/.mindmate/roles/`。
   - **secrets 不由环境变量 / config 解析**：路径由「根」固定推导——每个根内固定文件名 `mindmate-secrets.toml`（用户级 `~/.mindmate/mindmate-secrets.toml`；项目级 `<repo>/.mindmate.local/mindmate-secrets.toml`）。**不可配置**（无 `MMATE_SECRETS`、无 config `secrets:` 键）。共享根 `<repo>/.mindmate/`（进 git）**绝不放明文**。
   - **`secrets` 是禁区**：任何命令都不得读取、glob、打印或把它注入上下文；只有用户自己在会话外终端执行 `secret <id>` 才能取明文（读当前根的那一份，不跨根翻）。详见「安全模型」。
   - **项目根判定（C1/C2）**：从 cwd / `CODEBUDDY_PROJECT_DIR` 向上找**就近**的、含 `.mindmate/` 或 `.mindmate.local/` 的目录作为项目根，得到三根——项目共享 `<repo>/.mindmate/` > 项目个人 `<repo>/.mindmate.local/` > 个人全局 `~/.mindmate/`。`~/.mindmate` 本身不算项目根。**有显式 override（`--root` / `--spaces` / `MMATE_ROOT` 等）时退化为单根**；找不到项目根也是单根。**读（C1）**：`search` 按条目合并三根、同名全列出、每条标注 `root=` 与 `space=`（二维标源）、不按优先级覆盖，缺失根跳过；且**读可跨 Space**——缺省 `--space` 时遍历所有 Space 全库检索，`--space <name>` 仅用于收窄。**写（C2）**：先跑 `roots` 拿 `write_root`（有项目→local，无→全局，见「脚本入口」与「安全模型」），写类流程落该根并 `index --root <write_root>`；默认不写共享根，晋升是显式 `promote`。证据漂移复核属后续阶段（§7A）。
2. **首次运行**：若 `spaces/` 不存在，先向用户展示将创建的骨架（见下），**确认后才落盘**，不静默建目录。用 `scripts/mindmate.mjs init` 生成；默认只做 dry-run 打印。
3. **解析目标 Space**：**读类流程缺省 `--space` 即全库检索**（读可跨 Space），`--space <name>` 仅作收窄；**写类流程必须一次给定唯一目标 Space**（默认 `inbox`，见安全模型「写单归属」）。Space 列表扫 `spaces/` 顶层目录自动发现（排除 `.` / `_` 前缀）。**不存在「当前 Space」持久状态**。
4. 读 `config.yaml` 的 `confirm`（默认 `always`）。
5. **调度角色**：按「调度表」——有命令名直达 `roles/builtin/<slug>/role.md`，一次一个、不经调度器；无命令名走非确定路径（主角色门面兜底，或主角色 → `dispatcher` 提议 → 派活确认 → 移交）。
6. **加载生效规则**：两类 Rule 都作为行为约束，`status: deprecated` 忽略。
   - **Domain Rule**：`rules/global/`（全 Space / 跨 Space）+ **`spaces/<name>/rules/`（仅该 Space，内聚在 Space 内）**，用 `mindmate.mjs search --rules`（全库）或 `--space <name> --rules`（收窄）取；**规则是行为约束，不是检索结果分区**。
   - **Role Rule**：`roles/<slug>/rules/`（含 `builtin/` / `custom/` 下，内聚在角色内），仅当角色激活时由 `search --roles <slug>` 返回；**不进任何检索结果分区**。
   - **优先级**：本文件硬约束 > Role Rule > Domain Rule > 角色工作流默认行为。冲突时不自行挑选，列出冲突让用户裁决。

## 五个正交概念

`~/.mindmate/` 是整体同步单元，下面各部分互不隶属：

| 目录 | 内容 | 概念 |
|---|---|---|
| `spaces/` | 领域知识 bundle，每个顶层子目录是一个 **Space**；Space 自带 `rules/` 子目录 | 领域数据 + Space 绑定的 Domain Rule |
| `shelf/` | **待处置 bundle**：`sources/`（原始输入）+ `deprecated/`（废弃结论），两个文件夹不混合 | 不活跃、等用户处置的内容 |
| `roles/` | 角色 bundle（`builtin/` 预置 + `custom/` 自定义）；角色自带 `rules/` 子目录 | 角色定义 + Role Rule |
| `rules/` | **仅全 Space / 跨 Space 生效**的 Domain Rule（`global/`） | 全局/跨 Space 规则容器 |
| `mindmate-secrets.toml` | **明文 Secret**：`<id>` → 明文值，TOML 字面串，用户显式维护 | 同步单元内的敏感明文（须排除同步 / git） |
| `config.yaml` | 控制面配置 | 配置 |

`spaces` / `shelf` / `rules` / `roles` 各带 root `index.md` + `okf_version: "0.2"`。**规则就近内聚**：绑定某 Space 的 Domain Rule 放 `spaces/<name>/rules/`，绑定某角色的 Role Rule 放 `roles/<slug>/rules/`（与角色一并移动），顶层 `rules/` 只收不隶属单一 Space 的规则（全 Space 生效；跨多 Space 时用 `scope` 收窄）。**角色与领域是独立概念，不是 Space 的子类**；Role Rule 与 Domain Rule 分属两个不同的作用域维度（角色激活 vs Space 归属）。

**Source 和 deprecated 都放 `shelf/`，不进任何 Space**：前者是原始输入（默认留着、有引用时建议保留），后者是废弃结论（待删）。两者都「不参与活跃检索、等用户处置」，是同一清理流程的两种筛选条件，不是两类东西。各 Space **不再有 `sources/` 子目录**，也不再有名为 `deprecated` 的 Space；`inbox` 是纯入口、消化完即空。

> **明文位置改了（本批）**：`~/.mindmate-secrets.json`（同步单元之外、config 引用）已废弃。现在**每个根内**放一份 `mindmate-secrets.toml`：用户级 `~/.mindmate/`、项目级 `<repo>/.mindmate.local/`（gitignored）；共享根 `<repo>/.mindmate/` 进 git、**绝不放**。路径固定、不可配置，由「Card 在哪个根」推导。因此 `~/.mindmate/` **不再是纯同步单元**：同步 / 提交时必须显式排除 `mindmate-secrets.toml`（文件名显式、便于写排除规则），项目侧靠 `.gitignore` 排除整个 `.mindmate.local/`。详见「Secret 与明文」。

骨架（**仅用户级根**，`node mindmate.mjs init --apply` 生成）：

```
~/.mindmate/
├── config.yaml              confirm: always（不再写 secrets: 键）
├── types.yaml              type 注册表（默认槽位，用户数据，可迭代）
├── mindmate-secrets.toml    明文 Secret（用户显式维护，chmod 600；同步 / 提交须排除）
├── spaces/                  ← 领域 bundle
│   ├── index.md             okf_version: "0.2" + Space 入口
│   └── inbox/               ← Space（纯入口，消化完即空）
│       ├── index.md  log.md
│       ├── concepts/         Concept / Idea / Reference / Card / 任务文档
│       └── rules/            Domain Rule（仅该 Space 生效）
├── shelf/                   ← 待处置 bundle
│   ├── index.md  log.md
│   ├── sources/              Source（原始输入，全部归此）
│   └── deprecated/           废弃结论（status: deprecated，全部归此）
├── rules/                   ← 全局/跨 Space 规则容器
│   ├── index.md             okf_version: "0.2"
│   └── global/              全 Space / 跨 Space 生效（默认不写 scope）
└── roles/                   ← 角色 bundle
    ├── index.md             okf_version: "0.2"
    ├── builtin/             ← 预置角色（11 个，init 从 prompts/ 下发，不覆盖已有）
    │   └── <slug>/role.md   type: Concept + tags:[role] (+ rules/；dispatcher/ 下另有 evolution.md 派活选择记录)
    └── custom/              ← 用户自定义角色
        └── <slug>/role.md   (+ rules/)
```

项目级根**不是同样结构**，是最小骨架（`init-project --project <repo> --roots <mode> --apply`）：

```
<repo>/.mindmate/            （共享，进 git，--roots both|shared）
<repo>/.mindmate.local/      （个人，整体 gitignore，--roots both|local）
├── mindmate-secrets.toml    仅 local 根，纯注释模板
├── spaces/
│   ├── index.md             okf_version: "0.2" + Space 入口
│   └── inbox/
│       ├── index.md  log.md
│       ├── concepts/
│       └── rules/           Domain Rule（仅该 Space 生效，项目内规则就近放此）
├── shelf/
│   ├── index.md  log.md
│   ├── sources/
│   └── deprecated/
├── rules/index.md           okf_version: "0.2"
└── roles/index.md           okf_version: "0.2"（空；角色定义统一在用户级根）
```

**项目根不放** `config.yaml` / `types.yaml` / `roles/builtin/` / `roles/custom/` / `rules/global/` / 项目专家门面角色。原因：控制面（`readConfig()` / `resolveTypes()`）与角色定义（`search --roles` 的 `resolveRoles()`）都基于 `controlRoot()`（用户级根）解析，项目根里的同名文件**运行时从不被读**，是死文件；11 个预置角色按读优先级共享、不复制。三根读合并只消费项目根的 `spaces/` `shelf/` `rules/`。

**`--roots local` 档**：只创建 `.mindmate.local/`、不创建 `.mindmate/`。`findProjectRoot()` 靠 `.mindmate.local/` 即可识别为项目根（`write_root` → local），缺失的共享根在读合并时被跳过。不要用 `init --root <repo>/.mindmate.local` 代替——`--root` 是「把控制面挪到该目录」的 override，会带出整套用户级骨架（本次设计缺陷即由此而来）。

> `mindmate-secrets.toml` 含明文，勿同步、勿提交、勿贴进对话。**WSL/drvfs 下 `chmod 600` 已实测无效（仍是 777）**——Windows 侧须自行设 ACL，例如（对用户级文件）：
> `icacls "%USERPROFILE%\.mindmate\mindmate-secrets.toml" /inheritance:r /grant:r "%USERNAME%:F"`
> 并把该文件名加入同步工具的排除列表；项目侧确保 `.mindmate.local/` 已 `.gitignore`。

## 领域语言

规范词（不得用 `_Avoid_` 里的同义词）：**Space / Bundle / Shelf / Source / Idea / Concept / Master / Reference / Rule / Domain Rule / Role Rule / Role / Card / Secret**（无 `Vault`：`spaces/` 目录本身即「所有 Space 的集合」）。

- **Space**：`spaces/` 内按「互无关联」切分的独立知识集合，是**知识的唯一归属维度**——**读可跨 Space**（缺省 `--space` 全库检索、`--space` 收窄），**写不可跨 Space**（同一知识只归一个 Space，禁止分散）。_Avoid_ 知识库、分区、命名空间。
- **Bundle**：OKF 规范中由若干文档组成、可被独立消费的一个知识单元。`spaces/`、`shelf/`、`rules/`、`roles/` 各是一个 bundle。
- **Shelf（待处置区）**：`shelf/` bundle，装**不活跃、等用户处置**的内容，与按领域划分的 Space 正交。内部 `sources/`（原始输入）与 `deprecated/`（废弃结论）两个文件夹**不混合**。放这里的东西不参与活跃检索；要么「仍被引用、建议保留」，要么「可删」。它不是归档（不暗示永久保留），也不是回收站（不暗示立即删除）。_Avoid_ 归档、回收站、垃圾箱、archive。
- **Source**：一次摄入的原样内容，是 Concept 的出处依据，仅用于溯源 / 防幻觉 / 重加工，**不是可引用的事实**。统一放 `shelf/sources/`，**不进任何 Space**（Q85：不进检索与结构化查询，但仍进 `shelf/index.md` 导航）。「只追加、不可变」是流程约定，非代码强制。Source **有待删属性**：默认留着，但无引用时成为可删候选，由用户逐条确认后删除（见「shelf 待处置区与清理」）。_Avoid_ 内容、输入、原文、事实。
- **Idea**：由 Source 原样记下、**尚未定论、需要探索**的想法 / 问题 / 假设 / 要点，与 Concept 同放 `concepts/`，靠 `type: Idea` 区分。**不是可引用的事实**：条目原样放 `## 待确认`，不提炼、不推断、不写结论；`search` 单列 `Ideas (待探索，非事实)` 分区，`mmt:ask` 不得把它放进「## 解答（事实）」。`tags` 是检索用的自由扩展维度，无强制标准。_Avoid_ 笔记、草稿、待办、TODO。**Idea 探索完成、结论可确认后，由 `organize` 角色就地转变为 Concept**（改 `type` 与正文，同一文件、不另建 Source）；Idea 是过程态，不是终态。
- **Concept**：由 Source 提炼而成、可演进且可互相链接的知识单元，是被检索与引用的对象。_Avoid_ Note、笔记、Topic、Entity。
- **Master**：一条跨 Space 内容的**权威版本**，是 Reference 所指向的对象；是身份而非 `type`（此「角色」指身份，与 `Role` 无关）。
- **Reference**：指向 Master 的轻量 Concept（`type: Reference`），本身不自足，须显式解引用才能读取 Master 的内容。**全库检索排除 Reference 存根**（Master 会被直接召回，避免同一知识两条 HIT），存根仅在显式解引用 / `--space` 收窄时出现。_Avoid_ 引用、副本、链接、存根、双写。
- **Rule**：一种**特殊知识**，记录「我怎么处理信息」的约定（`type: Rule`），而非关于世界的事实。_Avoid_ 偏好、设置、指令、记忆、config。与 Concept 的边界：**Rule 只写怎么处理，不写什么为真**；「这个项目不写周报」这类事实必须落为 Concept，不得写成 Rule。判断例：摄入补充说明里「`mmt` 是 mindmate 的简写」是**规定怎么读我的输入**（解码约定）→ Rule；「`herdr` 是一个分屏工具」是**描述世界** → Concept。详见 `capture` 角色「摄入补充说明」节。
- **Domain Rule（领域规则）**：按 Space 作用域生效的 Rule，**路径优先**：`spaces/<name>/rules/` 仅该 Space 生效（内聚在 Space 内）、`rules/global/` 全 Space / 跨 Space 生效（顶层容器）。_Avoid_ 通用规则、全局规则。
- **Role Rule（角色规则）**：`roles/{builtin,custom}/<slug>/rules/` 下的 Rule，**仅在其角色激活时加载**；与 Domain Rule 叠加，冲突交用户裁决。_Avoid_ 角色配置、人格设定。
- **Role（角色）**：mindmate 在**同一 skill 内**的特化模式，`roles/{builtin,custom}/<slug>/role.md` 定义，含触发条件、工作流、字段 schema；`target_space` **按需携带**——会写知识 / 需兜底 Space 的角色带（写类 capture / organize、读类 ask），控制面角色（门面 / 调度 / 建库 / 建角 / 结构检查 / 回顾 / Space 管理 / 优化器）与 Space 无关、不带。`builtin/` 是预置（命令名显式入口、删除会使对应命令失效），`custom/` 是自定义（`trigger` 内容匹配）；两个目录装的都是 Role，无新增维度。一个角色**不是一个 skill**、不属于任何 Space。_Avoid_ 人格、Persona、Mode、插件、子 skill。
- **Card（私人卡片）**：一种特殊 Concept（`type: Concept` + `tags: [private]` + `secret: <id>`），**只含脱敏摘要与脱敏检索关键词**，`<id>` 是可读 slug，指向所在根的 Secret 条目。**全库检索排除 private 私人卡片**（不稀释 private 可见范围；`--space` 收窄到其归属 Space 时仍只复述脱敏摘要）。_Avoid_ 密文、加密块、占位文件。
- **Secret（明文条目）**：`mindmate-secrets.toml` 中以 `<id>` 为键的明文值；用户显式维护、TOML 字面串（零转义、可多行）。mindmate **绝不读取**；只由用户在会话外终端通过 `secret <id>` 取用，且只读 **Card 所在根**的那一份、不跨根翻。_Avoid_ 密文、哈希、映射表。
- **两类 Rule 的关联是反向索引**：Role Rule 在 `roles/<slug>/rules/` 下靠目录归属，角色文档**不列 rule 清单**（避免双写漂移）；查看用 `search --roles <slug>` 动态反查。
- **边界**：敏感明文**不得进入 mindmate 的任何上下文**（含命令参数、工具 stdout、`index.md`、`secrets` 内容）；Card 的摘要必须脱敏。跨 Space 允许**单向、显式**的 Reference 引用边，解引用必须显式触发；**读可跨 Space（全库检索）、写不可跨 Space（同一知识唯一归属）**；不做无 query / 无过滤的跨 Space 全库总览。

## 存储约定（OKF v0.2）

- 每个非保留 `.md` 必须有 YAML frontmatter 且 `type` 非空；**`type` 集合由用户数据的注册表定义**（`~/.mindmate/types.yaml`，默认由 `init` 生成），脚本按槽位驱动行为，不硬编码类型名。内置五个默认类型：`Source` / `Idea` / `Concept` / `Reference` / `Rule`。槽位（`partition` / `citable` / `provenance` / `index_marker` / `transitions` / `owner`）是**封闭**的，只能组合、不能新增；新增槽位属顶层架构改动。注册表缺失或损坏时脚本保守降级并报错，不静默放行。
- `index.md` / `log.md` 是保留名。`index.md` 由脚本**确定性生成，LLM 不参与**；**仅各 bundle 根**的 `index.md` 可带 `okf_version: "0.2"`。`log.md` 用 `YYYY-MM-DD` 倒序分组。
- 跨 Space 链接与 Reference 的 `resource` 用 bundle-relative `/<space>/<file>.md`（在 `spaces/` bundle 内解析）。**Source 出处引用统一用 `/shelf/sources/<file>.md`**（在 `shelf/` bundle 内解析，跨 Space 不变、无需随文档迁移改写）。角色与领域分属不同 bundle，故**任务文档用 `role: <slug>` 字段引用角色，不用 Markdown 链接**。
- **`repo://` 源码证据出处**：`sources[].resource` 除指向本地 `Source` 文档外，还可指向项目源码证据 `repo://<仓库内相对路径>[#L<n>[-L<m>]]`（如 `repo://src/server.ts#L40-L82`）。这是**版本化引用、不是文件快照**；`lint` 只校验格式（协议 / 相对路径 / 行号片段），**不校验文件存在**——证据可能指向历史版本。写法要求：`#` 行号片段前必须有合法路径、路径不以 `/` 开头、不含 `..` / 空格、行号 `L<n>-L<m>` 起点 ≤ 终点；**frontmatter 里含 `#` 必须整值加引号**（标准 YAML 会把裸 `#` 当注释、丢掉行号证据）。**证据复核（C3）**：`repo-check` 只读子命令用项目根判定「文件是否存在 + 行号是否越界」，**不判定源码内容变化**（无版本基线、不依赖 git、不存哈希），经 `mmt:review` 用户主动触发、或 `ask`/`capture` 处理中只提示建议复核；问题项经用户逐项确认才改。**晋升（local → shared）不搬 Source**：Source 全在 `shelf/`、与 Space 无关，两个根各有自己的 `shelf/`；晋升后出处引用 `/shelf/sources/<file>.md` 在目标根解析，若目标根无该 Source 由 `lint` 报断链、交用户裁决（不自动复制、不自动改）。
- Concept 正文骨架：一句话摘要（兼 `description`）、正文（事实与推断分标）、`## 关联`、`## 出处`（`[^id]` 对应 `sources[].id`）、`## 待确认`。
- **Idea 文档骨架**（`type: Idea` + `status: draft`，放 `concepts/`）：`description` 是含检索关键词的一句话，**不写结论**；正文只陈述一条元事实「用户于 <日期> 记下 N 条待探索点，均未展开、尚无结论」，**不提炼、不推断**；原文条目**原样逐条**列在 `## 待确认`；`## 出处` 的 `[^s1]` ↔ `sources[].id` 与 Concept 同规则（受 `lint` Q85 校验）；`## 关联` 不强制「至少连两个」，凑不足就如实写「暂无其它同主题文档」。多片共一条 Source 时都用同一个 `s1`。会话中补充的确定知识**不写进 Idea 正文**，按 `capture` 角色「摄入补充说明」节独立落盘，本片只在 `## 关联` 链接过去。
- **Source 降级（Q85）**：`shelf/sources/` 只作出处，**不是可引用事实**；`search` 的 `Ranked facts` 与 `--where` / `--sort` 结构化查询都排除它，`shelf/index.md` 仍列出供导航。`lint` 校验 `sources[].resource`：本地路径查存在性、`repo://` 查格式（见上条）；`## 出处` 脚注 `[^id]` ↔ `sources[].id` 对应（多余 id 为 WARN）。Source「不可变」靠流程，不靠代码。出处引用统一写 `/shelf/sources/<file>.md`；**不再有「共享 Source 留原 Space / 专属 Source 随搬」的判定**——Source 全在 `shelf/`，与 Space 无关。
- **Rule 文档**：Space 绑定的 Domain Rule 放 `spaces/<name>/rules/`、全局/跨 Space 的放 `rules/global/`；Role Rule 放 `roles/<slug>/rules/`。frontmatter 带 `type: Rule` 与 `status`（`draft` / `stable` / `deprecated`）；作废用 `status: deprecated`，可用 `stale_after` 表达过期。**路径优先（Q84）**：目录已表达作用域时**默认不写 `scope`**（`spaces/<name>/rules/` 已表达该 Space）；仅当目录无法表达（如 `rules/global/` 里一条规则只作用于多个指定 Space）才用 `scope` 补充，白名单只允许 `global` 或 `space:<name>[,space:<name>...]`；**禁止 `topic:`（Q83 删除）与 `role:`（目录已表达）**。`lint` 校验目录与 `scope` 冲突（同时认 `spaces/<name>/rules/` 与 `rules/global/`）。Space 内的 `rules/` 会列进该 Space 的 `index.md` 导航分组，但被 `search` 的 facts / 结构化查询排除（规则不进事实分区）。
- **Role 文档**放 `roles/{builtin,custom}/<slug>/role.md`，`type: Concept` + `tags: [role]`，额外带 `role: <slug>`、`trigger`；预置角色另带 `entry: command` 与「删除会使对应命令失效」提示。`target_space` **按需**：写类 / 读兜底角色带（默认 `inbox`），控制面角色不带；它只表示「产出落到哪个 Space / 兜底元信息」，不暗示角色属于它。正文写工作流与字段 schema（`## 工作流` / `## 字段 schema`）。**不列 rule 清单**。作废用 `status: deprecated`。角色不是新 `type`、不是新 skill。
- **Card 文档**放 `spaces/<space>/concepts/`，`type: Concept`，额外带 `tags: [private, ...]` 与 `secret: <id>`（小写可读 slug）；正文只写脱敏摘要 + 脱敏检索关键词，**不得含任何明文**。`<id>` 与所在根 `mindmate-secrets.toml` 的键一一对应，但 mindmate 从不读取该文件。
- **`mindmate-secrets.toml`**：TOML 扁平键值，键是 `<id>`（纯 slug），值是字符串（字面串 `'...'` / `'''...'''` 优先，也支持基本串 `"..."`）；`#` 注释可写于行首或行尾。脚本只实现这个子集（表 / 数组 / 数字 / 布尔 / 点号键一律报错）。路径由根固定、**不可配置**；共享根 `<repo>/.mindmate/` 不放。
- 时间戳一律 ISO 8601 带 UTC 偏移。UTF-8 + LF，不设 Windows hidden 属性。

## shelf 待处置区与清理（契约）

`shelf/` 装两类「不活跃、等用户处置」的内容，**都有待删属性**：

| | `shelf/sources/`（Source） | `shelf/deprecated/`（废弃结论） |
|---|---|---|
| 是什么 | 原始输入快照 | `status: deprecated` 的 Concept / Idea |
| 默认状态 | 留着（有引用时建议保留） | 待删 |
| 与活跃文档关系 | 被活跃文档的出处引用依赖 | 活跃文档不链向它 |

两者是**同一清理流程的两种筛选条件**，不是两类东西。

**触发（唯一）**：只有**用户主动提出清理**才启动。不做定时、不做自动批量整理（属「明确不做」）。时间、体积、年代都不作为清理标准；判定只看「还有没有用」（是否被引用 / 是否已废弃）。

**链的定义（判定口径，严格）**：只有**活跃文档 frontmatter `sources[].resource` 对 Source 的出处引用**算链。以下**都不算**：`log.md` 的 `**Creation**` 提及、`index.md` 导航条目、`## 出处` 脚注文字里的文件名、Rule 的「来源：」句。**Rule 保持现状、不带 `sources[]`，不算引用**（规则是当下约定、会变，不需要溯源）。

**清理流程（两类统一）**：

1. 用户主动提出 → 跑 `node mindmate.mjs shelf`（只读枚举）。
2. 脚本按 `sources[].resource` 在**合并三根视图**上判定引用，输出一份清单，自动分两组：
   - **「仍被引用 / 建议保留」**：还被活跃文档引用的 Source。
   - **「无引用或已废弃 / 可删」**：无引用的 Source（孤儿）+ `shelf/deprecated/` 全部文档。
3. **逐条确认**（破坏性永远确认，`--yolo` 不豁免）：用户逐条决定删哪些，脚本默认 dry-run、`--apply` 才删。
4. **删除顺序**：删引用方（废弃文档 / 活跃文档）→ 确认无断链 → 再删被引用方（Source）。`'shelf --drop'` 拒绝删除仍被引用的 Source。
5. **`shelf/log.md`** append-only 记录每次清理（纯 prose，YYYY-MM-DD 倒序）。

**孤儿判定边界**：必须在**合并三根视图**上做（单根判会误判——这根无引用、另一根有），且能区分「全库无引用」（真孤儿，可删）与「引用解析不到」（断链，见下）。按文件名 grep 会同时漏判、误判，一律以 `sources[].resource` 为准。

**断链处理（禁止伪造）**：先分清方向——「Source 删了、引用方还在」是真断链（`lint` 报 `sources[].resource` 指向不存在的文档）；「引用方删了、Source 还在」是孤儿、无害。**禁止靠删 `sources[].resource` 字段或抹掉 `## 出处` 脚注来「修」断链**——那是抹掉证据假装没引用过，违反「Never fabricate」与防幻觉初衷。已发生时：优先从同步单元 / 备份恢复（Source 不可变，通常找得回）；找不回就显式标「出处已丢失」，保留字段并注明，或按契约降级为「无来源」，同时同步处理脚注 `[^id]` ↔ `sources[].id`。`log.md` 是 append-only 历史，不改。

**`repo://` 例外**：`repo://` 是版本化引用、不是本地文件，不参与 shelf 的删除 / 孤儿判定；其失效（文件消失 / 行号越界）走 C3 `repo-check` 复核、只提示不自动改。

**活跃文档不链向待删目标**：`shelf/deprecated/` 里的文档不得被活跃文档用 Markdown 链接引用；已有的链接降级为纯文字说明。迁移到 shelf 时由编排层处理。deprecated 内部互链、deprecated → 活跃的链接整批待删，不维护。

**`shelf/` 是第四个 bundle**：各根同构（用户级 / 项目共享 / 项目个人各一份），带 root `index.md` + `okf_version: "0.2"`，`shelf/sources/` 与 `shelf/deprecated/` 列进导航分组。

## 脚本入口

确定性能力统一走 `scripts/mindmate.mjs`（Node 内置模块 + 可选 `rg`，无 `rg` 时自动回退内置扫描；不引入 SQLite、向量库、任何落盘检索索引）：

```
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" init [--apply] [--root <dir>] [--spaces <dir>] [--shelf-root <dir>] [--rules-root <dir>] [--roles-root <dir>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" init-project --project <repo-dir> [--roots shared|local|both] [--apply]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" space  --list | --create <slug> | --rename <old> <new> | --delete <name>
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" move   --from <space> --to <space> --files <doc.md>[,<doc.md>...] [--apply]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" shelf  [--space <name>] [--root <write_root>]         # 只读清理清单
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" shelf  --drop <file> [--apply] [--root <write_root>]  # 单条删除，默认 dry-run
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" roots
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" probe --input "<用户输入>"   # 一次性只读探测 + 命令名 route
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" repo-check --space <name> [--root <write_root>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" index  --space <name> [--root <write_root>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" lint   --space <name>
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" search --query "<q>" [--space <name>] [--limit 8]   # 缺省 --space = 全库检索
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" search --where <k>=<v> [--where ...] [--sort <k>] [--space <name>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" search --rules [--space <name>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" search --roles [<slug>]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" promote <file> [--apply]
node "${CODEBUDDY_SKILL_DIR}/scripts/mindmate.mjs" secret  <id> [--root <dir>]   # 仅用户会话外终端执行
```

`init` 建用户级知识库（五根：`spaces/` `shelf/` `rules/` `roles/` + `config.yaml`/`types.yaml`/`mindmate-secrets.toml`）并把 11 个预置角色从 `prompts/` 下发到 `roles/builtin/`；`init-project` 建项目级**最小骨架**（`<repo>/.mindmate/` 共享 + `.mindmate.local/` 个人，各含 `shelf/`，**只 local 根含 `mindmate-secrets.toml`**），`--roots shared|local|both` 选择创建哪几根（默认 `both`；`local` 只建个人根）。项目根**不写** config / types / 角色定义 / `rules/global/` / 项目专家门面角色——这些是用户级根的控制面单例与角色定义，运行时按读优先级共享，复制到项目根即成死文件。二者是脚本能力，由 `bootstrap` 角色调用，脚本本身不判断、不参与激活链。`init` 生成 secrets 文件为**纯注释模板**（不含任何明文）、不覆盖已存在的文件。

**`probe`（一次性只读探测）**：把探测阶段原本要分别跑的 `roots` / `space --list` / `search --roles` / 读 `config.yaml` 合并成一次调用，输出 `scope` / 五根路径 / `write_root` / `*_exists` / `bootstrap`（`ready` / `need_bootstrap`）/ `confirm` / Space 列表 / 候选角色元数据（仅 frontmatter 字段 + `trigger`，**不读 `role.md` 正文**）/ `route`。`route` 只做确定性的命令名识别：`/mmt:<slug>` 且 slug 属六个预置命令 → `route=command:<slug>`；未知命令 → `route=unknown-command:<slug>`（明确报错、不静默降级）；其余 → `route=dispatcher`。**`route` 是给流程层的标记，不是新的调度决策**——它复刻调度表已有映射，不改「命令名显式 > 项目上下文作用域绑定 > trigger 内容匹配 > 主角色兜底」的激活优先顺序，也不取消主角色兜底：非确定路径仍由 `dispatcher` 处理，问候 / 帮助 / 自我介绍转回主角色 `mindmate`。首次运行 `need_bootstrap` 的骨架展示与写盘确认仍由 `bootstrap` 角色走 `init`，不由 probe 代劳。probe 绝不读取 `mindmate-secrets.toml`、不写任何文件。

**`search`（读可跨 Space，全库检索为默认）**：缺省 `--space` 时脚本内部遍历每个读根下**所有 Space** 的 `index.md` 做渐进式导航 + 召回；`--space <name>` 仅用于收窄到单个 Space。结果按 C1 合并三根、同名 / 冲突条目**全列出、不覆盖**，每条 HIT 标 `root=` 与 `space=`（二维标源）。`shelf/` 天然不在候选集；**全库检索排除 Reference 存根与 private 私人卡片**。输出**只分两节**：`# Ranked facts`（可作事实引用的 Concept / Card）与 `# Ideas`（待探索、非事实，已排除 `status: deprecated`）；**不设 Applicable rules 分区**——Rule 是约定、不是检索结果，仅在显式 `--rules` 分支原样呈现（`--rules` 缺省 `--space` 时列 `rules/global/` 加所有 Space 的规则）。**空 query 护栏**：无 `--query` 且无 `--where` 时不执行、不枚举，脚本输出「需要明确检索意图」，由流程层直接反馈用户询问意图；`--where` / `--sort` 结构化清单是显式过滤、不属总览，照常执行。`probe` 无需为全库检索新增输出。

**`shelf`（清理）**：无 `--drop` 时只读输出清理清单（「仍被引用 / 建议保留」与「无引用或已废弃 / 可删」两组，附孤儿判定与断链告警）；`shelf --drop <file>` 单条删除、默认 dry-run、`--apply` 才执行，且**拒绝删除仍被引用的 Source**。判定口径见「shelf 待处置区与清理」。由 `organize` / `review` 角色在用户主动提出清理时调用，不新增 `mmt:*` 命令。

**写目标根（C2）**：写类流程先跑 `roots` 拿 `write_root`（只读，输出 `scope` / 三根路径 / `write_root` / `*_exists`）。写文件落在 `write_root` 下的 Space，重建派生索引用 `node mindmate.mjs index --space <name> --root <write_root>`（不带 `--root` 则落全局根）。`--root` 是「让确定性命令作用于指定根」，不改变「全局根」的判定。若 `roots` 报 `local_exists=false`（clone 只有共享根），先用 `init-project --project <repo> --roots local --apply` 幂等补建 local 根（已存在的不覆盖）再写。

**晋升（C2）**：`promote <file>` 把 local 根的单文档移到 shared 根（shared 新建 + local 删除）+ 重建两边 index，**移动非复制**；默认 dry-run、破坏性，`--apply` 前必须按安全模型写盘确认、且确认信息写明目标根。由 `organize` 角色的「晋升」动作调用，不新增 `mmt:*` 命令。

**跨 Space 迁移**：`move --from <源> --to <目标> --files <doc.md>...`，把存量 Concept / Idea 文档整理到专门 Space。默认 dry-run、`--apply` 才执行，mv 语义非复制；两边 index 重建。**Source 全在 `shelf/`、与 Space 无关**：迁移不再搬运 Source、不改写 `sources[].resource`（统一 `/shelf/sources/`，跨 Space 不变）；活跃文档指向 `shelf/deprecated/` 的链接降级为纯文字。由 `organize` 角色的「跨 Space 迁移」动作调用，不新增命令 / 角色。定 Space 边界须守「少而稳定、不造碎片 Space」，逐组确认；这是用户显式触发的整理，不是定时 / 自动批量全库整理（后者仍属「明确不做」）。

**证据复核（C3）**：`repo-check --space <name> [--root <write_root>]` 只读扫描该 Space 的 `repo://` 引用，逐条报 `ok` / `missing`（文件不存在）/ `range`（行号越界）/ `no-project`（无项目根无法判定）/ `invalid-format`，带文档与根标源。只查「文件存在 + 行号范围」，**不判源码内容变化**（无版本基线、不依赖 git、不存哈希）、不改文件。经 `mmt:review` 用户主动触发才复核，或 `ask`/`capture` 处理中发现问题只提示「建议复核」——是否复核由用户决定，不自动触发、不自动改。

`--where` / `--sort` 是**通用** frontmatter 过滤排序（支持 `=`、`!=`、`<`、`>`），不含任何角色语义；角色只声明「我用哪些字段」。结构化模式下无需 `--query`，直接枚举候选集（缺省 `--space` 为全库、带 `--space` 为收窄）的文档。

`secret <id>` 是**唯一例外**：它读取当前根 `mindmate-secrets.toml` 的 TOML 子集并输出明文，带 TTY 检查，**只允许用户在会话外的真实终端运行**。skill 绝对不得调用它，只把命令文本给用户。读哪个根由 `--root` 或项目三根判定（project → local，global → 用户级），**不跨根翻、查不到明确报错**。

> `search --roles <slug>` 的详情输出会把正文截断到 2000 字符，仅供快速浏览；命令加载角色流程必须**整篇 Read `role.md`**，不能依赖这个截断输出。

## Secret 与明文（契约）

> **本节是 secret 规则的唯一定义处**：文件名 / 位置 / 格式 / 风险规则在这里定；`SKILL.md` 其余段落（探测、骨架图、领域语言、脚本入口、安全模型）对它的引用**以本节为准**，不算第二份定义。**命令文件与角色定义不得另写一份规则**，只指回本节。格式的可读副本落在 `mindmate-secrets.toml` 的**文件头注释**（由 `init` 生成，给用户看）——那是模板文本，不是规则定义。改格式 / 位置时：动脚本模板 + 本节 + `.gitignore`（文件名变时），流程层不动。

**归属与位置**（路径固定、**不可配置**，由「Card 所在根」推导）：

| 根 | secrets 文件 | 进 git |
|---|---|---|
| 用户级 | `~/.mindmate/mindmate-secrets.toml` | 否（须显式排除同步） |
| 项目个人 | `<repo>/.mindmate.local/mindmate-secrets.toml` | 否（`.gitignore` 整个目录） |
| 项目共享 | **不放** | 是（进 git，push 不可回滚） |

- **用户显式维护**：文件不以 `.` 开头、名字显式带 `secrets`，用户应明确知道其存在与风险；同步 / 提交时必须排除该文件，项目侧靠 `.gitignore` 排除 `.mindmate.local/`。
- **不复用 `.env`**：文件是 mindmate 专属、不被 dotenv / 框架 / CI 自动加载、不进环境变量；也不读取项目的 `.env`。
- **格式**：TOML 扁平键值，键 = Card 的 `secret: <id>`（纯 slug），值 = 明文字符串。字面串 `'...'` / `'''...'''` 零转义、可多行，优先；基本串 `"..."`（含 `\n \t \\ \" \uXXXX` 转义）也支持。`#` 注释可写行首 / 行尾，文件头自述风险。脚本只实现这个子集（表 / 数组 / 数字 / 布尔 / 点号键报错）。Node 无内置 TOML 解析器，脚本内置极小子集解析。
- **解析**：`secret <id>` 读 Card 所在根的那一份，查不到明确报错、不跨根翻；带 TTY 检查、会话外执行、绝不代跑。`lint` **不校验** secrets 文件里有没有对应条目（那会把明文带进上下文）。
- **元数据归 Card，明文归 secrets 文件**：Card 只存脱敏摘要 + 检索关键词 + `secret: <id>`，两者分离。
- **`init` / `init-project` 只生成注释模板**，绝不写明文；已存在则不覆盖。旧 `~/.mindmate-secrets.json` 的迁移由用户会话外自行完成，脚本不读取、不转换其内容。

## 安全模型（唯一出处，命令文件不得另写一份）

- **优先级**：本文件硬约束 > **Role Rule** > **Domain Rule** > 角色工作流默认行为。两类 Rule 可改「用中文整理」「会议纪要列出席人」「TODO 完成只标 done」这类处理方式，但**不得**关闭确认、跳过破坏性确认、启用「明确不做」里的项、绕过明文三条铁律。角色激活时 Domain Rule **继续生效**（叠加），冲突不自行挑选、列出让用户裁决。
- **默认先确认**：任何写/改知识库的动作，先把将写入的内容、路径、**目标根**列清楚，等用户确认后执行。目标根由 `node mindmate.mjs roots` 给出（`write_root`）：有项目根时为 `<repo>/.mindmate.local/`，无项目时为 `~/.mindmate/`；仅当用户明确「晋升到共享根」时才写 `<repo>/.mindmate/`。**写确认里必须写明将写入哪个根**——个人随手记不误进团队共享（git）。
- **破坏性永远确认**：删除 Source/Concept、**删除 Space**、覆盖已有 Concept、跨 Space 批量改写、**晋升（单文档移动，local 删除）**、**跨 Space 迁移（原 Space 删除）**、**shelf 清理删除（Source / 废弃结论）**，即使 `--yolo` 也要确认。`space --delete` 只允许删空 Space；`promote` / `move` / `shelf --drop` 默认 dry-run、`--apply` 才执行，且逐组列清单确认。`shelf --drop` 拒绝删除仍被引用的 Source。

> **Space 边界（顶层契约）**：Space 是**少而稳定**的**知识唯一归属维度**，不是标签，也不是检索隔离边界——**读可跨 Space（全库检索为默认）、写不可跨 Space（同一知识只归一个 Space，禁止分散到多个 Space）**。整理存量建专门 Space 时须按「互无关联」分组、优先复用已有 Space、一次只提一个（或按用户确认的整份清单），不因话题关键词造碎片 Space。**不建名为 `deprecated` 的 Space**——废弃是 `status`，不是领域；废弃结论进 `shelf/deprecated/`。边界判断是流程约定，靠 `organize` 角色落实。
>
> **写单归属（硬约束）**：写类流程落盘前须先跑一次**全库** `search --query "<同主题词>"`（不带 `--space`）拿同名 / 同 tag 候选；「是否同一知识」由 LLM 在写盘确认环节判定（脚本只给候选、不做语义裁决）。命中已有 → **就地更新或走 `move` 迁移，不新建副本**；判不出归属 → 落 `inbox`，不硬猜、不造碎片 Space。
- **共享根外发风险不可回滚**：`<repo>/.mindmate/` 一旦 push，本地回滚撤不回外发。所以默认写 `.mindmate.local/` 是硬边界，晋升必须显式动作 + 确认，不能因方便而默认写共享根。
- **显式 YOLO**：`--yolo` 参数或 `config.yaml` 的 `confirm: yolo` 可跳过非破坏性确认。
- 规则之间冲突时不得自行挑一条，须列出冲突让用户裁决。
- 不在 frontmatter 硬限 `allowed-tools`（frontmatter hooks 为 Beta 且受门控）；以上约束靠主流程与各角色 `role.md` 的指令落实。

**明文三条铁律（不可被 Rule / `--yolo` 覆盖）**：

1. **绝不读 `mindmate-secrets.toml`**：不得读取、glob、打印其内容，也不得把它或其中的值注入任何上下文。脚本只在用户显式运行 `secret <id>` 时读它（且有 TTY 检查）。
2. **只输出命令，绝不代执行**：`mmt:ask` 命中 Card 时，只输出摘要 + 一行「请在会话外终端运行 `node mindmate.mjs secret <id>`」；**绝不**调用该命令、绝不把明文取回。
3. **明文不得进对话**：用户要求把敏感明文贴进会话让 mindmate 代填时，**拒绝**并给出 Card 模板 + `mindmate-secrets.toml` 的会话外填充指引。mindmate 可以生成**模板与占位符**，绝不接触填好的值。

## 明确不做

定时增量更新 / git-diff 自动回顾、**shelf 的定时或自动批量清理**、连接器、MCP、Deep Agents 运行时、网页/剪贴/OCR 输入、向量库与落盘检索索引、Synthesis 落盘、**无 query / 无过滤的跨 Space 全库总览（枚举）**、持久化 `current_space`、**任何加密/哈希（含 MD5）作为保密手段**、**对敏感明文的语义答疑或摘要**、**为每个角色新建独立 skill 或新增第七个命令**、**`topic` 维度（已删，横切分类统一用 `tags`）**。这些是后续演进项，不要在 v1 里偷偷实现。

> 注：**带 `--query` / `--where` 的跨 Space 全库检索是默认能力，不在此禁令内**（读可跨 Space）。

敏感域的能力是明确降级的：mindmate 只维护 Card 的脱敏摘要并做定位式检索；需要明文时由用户自行在会话外取用。
