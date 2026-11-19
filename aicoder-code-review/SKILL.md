---
name: aicoder-code-review
description: Use when the user asks to review code, audit a diff or recent changes, check code quality before commit, or review AI-generated code against project conventions; also for follow-up review rounds (复审/复查/第二轮/修复后再看/再审一遍), registering review decisions (某条不修/已修好), or querying past findings (遗留问题/上次报了什么). Triggers include: 代码审查、代码评审、review 一下、帮我看看这段代码、提交前检查、审查 AI 生成的代码、检查这次改动、检查是否违反项目惯例/约定、复审、遗留问题. Covers Java/Spring, Vue and JavaScript/TypeScript projects.
allowed-tools: Read, Bash, Edit, Write, Grep, Agent, Glob
---

# AICoder Code Review

对变更代码（尤其是 AI 生成的代码）做结构化审查，输出一份块状 Markdown 报告。

**核心原则：每条问题必须回到代码中验证，确认真实文件与逐字代码后才能写入报告，禁止凭印象报告。** 对 AI 生成的代码，**项目惯例一致性是首要专项**——AI 惯于用"通用最佳实践"覆盖项目本地约定，惯例只能从项目存量代码归纳（检查点见 ai-code-pitfalls.md 第 4 节）。

## 何时使用

- 审查 / review / 提交前检查；修复后再审
- 审查 AI 生成的代码（专项，默认启用）
- 轻交互（不走完整审查）：对已报问题表态（"R1-3 不修""修好了"→ 定点验证后更新台账）、查询历史（"还有几条没修"→ 读台账回答）。**边界：仅限点名单条或明确限定的核实；凡对变更整体的审查请求（复审/复查/再审一遍），无论措辞带不带"复"字，一律走完整工作流**

**不适用**：修具体 bug（走调试流程）、格式化/import 排序（交给 lint 工具）、未要求审查时的普通答疑。

## 工作流

1. **写分块 spec**：

!`git diff --stat 2>/dev/null || printf '(no git diff)\n'`

!`printf 'UNTRACKED:\n'; git status --short 2>/dev/null || printf '(none)\n'`

按功能内聚把变更文件分成块，写 spec JSON（每块 id + files + 有交互关系的块摘要）。≤500 行单块，>500 行分块（上限 4 块）。**一律派发子代理，禁止直跑**。不读 review.md/lessons.md（只在写回阶段读）。
2. **准备 + 派发（脚本）**：调用 `scripts/repo_prep.js <项目根> <skill根> <spec文件>`——脚本读 config/清单/lessons/diff，**拼装 N 份完整 prompt 到 `tmp/review-prompts/fN.md`**，主会话不经手正文（token≈0）。manifest 重定向到文件再 Read（规避 Bash VT 伪影）。**manifest 自带各块 `lines`/`diffHunks`/`diffEmpty`，据此确认产物即可，不再额外 `wc -l`/`grep` 校验**。按 manifest **一条消息并行派发** N 个子代理，每个只传"用 Read 读取 fN.md 并严格遵守"。子代理发现不带行号、用轻量标记文本。接收后主会话对账合并（同文件同语义）。派发规范见 `assets/subagent-dispatch.md`。
3. **行号解析 + 报告（脚本）**：把合并发现的可定位符号写成 JSON，调用 `scripts/resolve_lines.js` 批量解析行号；再调用 `scripts/render_report.js <标记文本>` 生成 markdown 报告（stdout 或文件）。**报告须正文呈现**：主会话读报告原文原样输出。默认不写"修复确认"（见"复核场景"）。格式规则已内置脚本，`assets/report-generation.md` 只留判定口径与脚本接口。
4. **写回状态**：读 `review.md` 最新内容（定轮次号 + 防并行覆盖），本轮发现并入被接续的主条目（禁止并列/空条目），全终态压缩为存根（决策明细行保留）；lessons 新模式/新决策/新惯例入册；遵守容量与老化规则。此阶段才读 `lessons.md` 提炼惯例增量。

## 复核场景（暂未启用，后续单独添加）

**当前默认审查不复核**：不读 `review.md` 判定首轮/跟进、不核实历史未决项、不做决策复核、不做回归检测，报告也不写"修复确认"。以上动作仅在用户明确要求"复审/复查/再审一遍/核实遗留项"等复核意图时执行，届时另起复核流程规范。**注**：写回阶段读取 `review.md` 只为定轮次号与防覆盖，不属于复核。

## 审查结论（报告末尾必给，四选一）

- 有任一 🔴 阻断 → **🔄 Request Changes**
- 仅 🟡/🟢/💡 → **💬 Comment**
- 存在架构方向分歧 → **🔍 Needs Discussion**（先讨论再动手）
- 无任何问题 → **✅ Approve**

🟢/💡 参与判定，与 🔴/🟡 一起进入结论后的速览表（两列：编号/问题，直接渲染），格式见报告生成模块。

## 常见错误（高频红牌）

- **纯静态红线**：禁止编译/测试/写操作；动态验证先征询用户
- 凭印象写问题 → 必须打开文件验证逐字代码与行号后才写入
- 采信子代理返回的行号 → 子代理不带行号，由 `resolve_lines.js` 批量解析后填入
- 直接解析脚本 stdout → 重定向到文件再 Read（Bash stdout 有 VT 伪影）
- 审查阶段读 review.md/lessons.md 做核实 → 默认不复核，这两份只在写回阶段按需读
- 写回时凭旧 log 追加或另开条目 → 写回前重读最新 review.md，同变更并入主条目
- lint 能查的格式问题 → 直接跳过
