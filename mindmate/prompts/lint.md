> `lint` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。**纯机械、只报告、不自动修改。**

## 输入

`--space <name>`（默认 `inbox`）。

## 步骤

1. 按 `SKILL.md` 探测 `spaces/` / Space。
2. 运行 `node mindmate.mjs lint --space <name>`。它检查该 Space、`rules/` / `roles/` 两个 bundle，以及 **`shelf/deprecated/`**（废弃文档也是出处引用方，纳入扫描以便发现「删了 Source 但仍被引用」的断链）；`shelf/sources/` 里的 Source 是原样输入、`provenance: none`，**不按正文链接校验**（避免把原文里的 URL / 链接误报）。检查项：
   - 每个非保留 `.md` 有 YAML frontmatter 且 `type` 非空
   - `type` 是否已在 `~/.mindmate/types.yaml` 注册表声明（未声明为 WARN，并按保守槽位处理）；注册表本身缺失、损坏、含未知槽位或非法槽位值则为 **ERROR**，脚本会保守降级并报错，不静默放行
   - 断链（bundle-relative `/...` 与相对路径）；**`/shelf/sources/...` 在 `shelf/` bundle 内解析**；活跃文档**不得链接指向 `shelf/deprecated/`**（待删目标，应降级为纯文字，报 ERROR）；**`repo://` 链接 / 出处只校验格式**（协议 / 相对路径 / `#L<n>[-L<m>]` 行号片段），不校验文件存在
   - `type: Reference` 必须有 `resource` 且指向的 Master 存在
   - **出处完整性（Q85）**：`sources[].resource` 分两类——本地路径必须指向真实存在的 Source 文档（缺失 = ERROR，防幻觉）；`repo://` 必须是合法证据引用（格式非法 = ERROR，含原因；合法即放行，**不查文件存在**）。`## 出处` 脚注 `[^id]` 必须有对应的 `sources[].id`（疑似幻觉引用 = ERROR）；已声明却未被脚注引用的 `sources[].id` 为 WARN。只校验引用完整性，不读 Source 内容、不检测「不可变」（那是流程约定）。**`repo://` 的文件存在 / 行号越界不由 lint 判定**，那是 `repo-check` 只读复核的职责（C3），经 `mmt:review` 用户主动触发
   - **Card**：`secret` 必须是合法可读 slug；带 `private` 标签却无 `secret` 为 WARN
   - **角色 / 两类 Rule**：Domain Rule 在 `rules/`（`global/` + `spaces/<name>/`），Role Rule 在 `roles/<slug>/rules/`，靠目录区分；角色文档应有 `role` / `trigger`，`target_space` **仅写类 / 读兜底角色按需带**、控制面角色不带（缺它不是问题）；`scope` 路径优先、默认不写，目录与 scope 冲突会报错；作废用 `status: deprecated`
   - 非根 `index.md` 不得带 frontmatter；**四个 bundle 根**（`spaces` / `shelf` / `rules` / `roles`）的 `index.md` 必须带 `okf_version: "0.2"`
   - `index.md` 条目与实际文件一致性（缺条目 / 陈旧条目为 WARN）

   **lint 绝不读取明文 Secret 文件**（定义见 `SKILL.md`「Secret 与明文」节），也不校验其中是否有对应条目——那会把明文带进上下文。
3. 把输出原样呈现给用户，附一句人话总结。检查项与 `review` 不重叠：这里**不判断内容是否过时、是否该合并**。

## 硬约束

- **只报告，不自动修复**。修复建议可以给，但改文件必须用户明确要求，且按 `SKILL.md` 安全模型走确认。
- 发现断链时**不要**顺手创建占位页（OKF 允许断链代表「尚未写入的知识」）。
- 不以本命令产出任何写入。
