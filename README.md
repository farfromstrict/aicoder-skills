# aicoder skills

个人使用的 CodeBuddy Code skills 集合，用一个 repo 集中管理。

## Skills

- **aicoder-code-review** — 结构化代码审查，重点核对 AI 生成代码与项目存量惯例的一致性；支持复审与遗留问题追踪，覆盖 Java/Spring、Vue、JS/TS。
- **mindmate** — 个人第二大脑，把输入沉淀为 OKF v0.2 知识库，并基于知识库检索、答疑、给出建议（`/mmt:*`）。
- **terminal-assistant** — 在 tmux/herdr/hc/zellij 会话里读写其它窗格（ez/wz 编号），在本屏幕执行命令并回读结果。

## 使用

CodeBuddy 只扫描 `~/.codebuddy/skills/`（用户级）和项目 `.codebuddy/skills/`。本机通过目录联接（junction）把这里的 skill 挂过去即可，改动 repo 会即时生效：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.codebuddy\skills\mindmate" -Target "<repo 路径>\mindmate"
```
