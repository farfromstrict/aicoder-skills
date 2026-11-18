# aicoder-code-review

针对 AI 生成代码的 code review skill（个人级安装）：Java/Spring + Vue + JavaScript/TypeScript 技术栈，多轮记忆、干净上下文子代理执行、结构化审查直接生成标准 Markdown 报告，支持项目级配置与用户自定义规约。

## 功能特性

- **AI 代码专项审查**：幻觉 API、伪实现、过度工程、项目惯例一致性、测试质量等系统性问题，重点核对 AI 代码是否打破项目已有惯例、违反项目约定
- **标准化报告**：红绿灯分节、全报告连续编号、可点击引用代码块、速览表——版式规范集中于报告生成模块
- **两级自定义**：项目级 `.aicoder/code-review/`（config.yaml 行为配置 + rules/*.md 项目规约）+ 用户级 `references/rules/*.md`（跨项目规约）
- **维度开关**：按项目关闭 security / ai-pitfalls / performance / maintainability
- **干净上下文执行**：单轮分析默认派发子代理（新鲜眼睛防锚定、现读最新规范），主会话只做模式判定、派发、渲染报告与台账写回
- **多轮记忆**：`.aicoder/code-review/review.md`（轮次台账）+ `lessons.md`（犯错模式 / 项目惯例缓存 / 决策口径）——跟进轮自动携带未决项、确认修复、不重复报告已决策项；模式复现 ≥2 次建议晋升为正式规则

## 目录结构

```
aicoder-code-review/
├── SKILL.md                     # 主工作流（触发后加载）
├── README.md                    # 使用方式（本文件）
├── DESIGN.md                    # 设计与决策记录（维护者视角，非运行时规范）
├── assets/
│   ├── report-generation.md     # 报告生成模块（核心格式 + 骨架 + 硬性要求 + 常见错误；写报告前必读）
│   └── subagent-dispatch.md     # 子代理派发模板 + 执行规范 + 返回契约（派发前必读）
└── references/
    ├── review-state.md          # 多轮状态规范（log/lessons 格式、生命周期、轻交互）
    ├── java-checklist.md        # Java/Spring/MyBatis/lombok 专项
    ├── vue-checklist.md         # Vue 专项
    ├── js-ts-checklist.md       # JavaScript/TypeScript 专项（含 TS 类型分节）
    ├── ai-code-pitfalls.md      # AI 生成代码专项（含项目惯例检查，默认开启）
    ├── security-checklist.md    # 安全专项（默认开启）
    └── rules/                   # 用户自定义规则目录（放 .md 即生效）
```

## 使用方式

对 agent 说"审查一下这次改动 / review 这个文件 / 提交前检查"等即触发；也可显式指定文件或粘贴代码。

## 多轮使用

- **首轮**审查后自动在项目 `.aicoder/code-review/` 创建 `review.md`（轮次台账）与 `lessons.md`（经验沉淀）
- **跟进**："修复后再审 / 第二轮" → 自动携带未决项、确认已修、不重复报告已决策项，报告标题标注轮次
- **表态**："R1-3 不修" / "修好了" → 只更新台账不出报告（"修好了"会定点验证后才标记）
- **查询**："还有几条没修 / 上次报了什么" → 读台账回答
- **变更切换**："开始新变更" → 旧条目封存（可解封），新变更从第 1 轮计数；"清空 review log" 为显式硬重置（须确认）
- 格式与生命周期规范见 skill 的 `references/review-state.md`；状态文件默认随 `.aicoder/` gitignore（本机记忆），长期知识经晋升进入规约（项目特有进 `.aicoder/code-review/rules/`，跨项目进用户级 `references/rules/`）

## 配置

### 项目级：`<项目根>/.aicoder/code-review/config.yaml`

```yaml
version: 1

# 维度开关（未列出的默认开启；正确性为核心维度不可关闭）
review:
  security: true
  ai-pitfalls: true
  performance: true
  maintainability: true

# 排除路径（glob）
exclude: ["**/*.md"]                      # 示例：忽略 md 文档

# 项目规约（rules）不写在 config —— 见下方「项目规约」
```

- 规约条目以 `## [level] 描述` 标注级别，`level` 为机器标识（severe / important / normal / minor），报告中分级显示为中文：🔴 阻断 / 🟡 严重 / 🟢 一般 / 💡 轻微
- yaml 不存在 → 全默认；格式错误 → 警告后按默认继续

### 用户级：`references/rules/*.md`

放任意 `.md` 规则文件即生效，对所有项目生效。建议格式：

```markdown
## 强制项（违反计 🔴 或 🟡）
- 具体规则 + 正/反例

## 建议项（违反计 🟢 或 💡）
- 具体规则
```

（旧分节格式继续兼容；新晋升文件统一用下方类别文件格式）

### 项目规约：`.aicoder/code-review/rules/*.md`

**一个类别一个文件**，与用户级同格式。类别集合：test / exception / logging / naming / security / architecture / api / db / performance / doc / misc（新类别需用户确认）。

```markdown
---
category: test
language: java
tags: [ai-pitfall]
---

## [normal] 测试代码禁止内联全限定类名，依赖类一律 import

反例：`com.cicc...StatusEnum state = UserTokenStateEnum.valueOf(...)`
正例：`import ...StatusEnum;` 后直接 `StatusEnum state = ...`
来源：promoted(11-04, 犯错模式 ×2)
```

- frontmatter = **文件级** label（category 必填；language/tags 可选）；**level 与 source 是条目级 label**（分节标题 `[level]` + 来源行），不进 frontmatter
- 优先级：项目 rules/*.md > 用户级 rules/*.md > 内置清单（同义冲突项目覆盖用户）
- 晋升：lessons 犯错模式 ≥2 轮（🔴/🟡 级 1 次）→ 报告 💡 建议 → 用户确认 → 追加/更新类别文件分节，lessons 条目移除

## 报告生成与版式

审查完成后，agent 读取 `assets/report-generation.md`（唯一规范）直接生成报告并展示。版式要点：红绿灯分节（🔴/🟡/🟢/💡）、问题标题 `### N.` 全报告连续编号、文件行号一律用 `起:止:相对路径` 引用代码块（IDE 可点击跳转）、审查结论后附问题速览表（全部问题进表，两列：编号 / 问题，直接渲染）。

```
# 代码审查：[主题]
---
## 总体评价
---
## 🔴 阻断                  ← ### 1. 问题标题（引用代码块 + 说明）
---
## 🟡 严重                  ← ### 2.（编号跨节连续）
---
## 🟢 一般 / ## 💡 轻微 / ## 📚 说明
---
## 审查结论                   ← Approve / Comment / Request Changes / Needs Discussion
**问题速览**（🔴🟡🟢💡 全量两列表，直接渲染）
```

---

> 设计取舍、设计边界、降噪纪律与决策时间线（维护者视角）见 [DESIGN.md](DESIGN.md)。本 README 只保留使用方式。
