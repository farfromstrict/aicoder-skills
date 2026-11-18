> `space` 角色工作流。顶层契约（领域语言 / 探测 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。只做四件事：列 / 建 / 改名 / 删。

## 写目标根（C2，写类流程前置）

本角色会写盘。**写盘前**先跑 `node mindmate.mjs roots` 拿 `write_root`（有项目根 → `<repo>/.mindmate.local/`，无 → `~/.mindmate/`）。若 `roots` 报 `local_exists=false`（clone 只有共享根），先 `init-project --project <repo> --roots local --apply` 幂等补建 local 根再写。

- 本文件后文所有 `index` / `space` 命令里的 `<write_root>` 都代入 `roots` 给出的实际路径；所有文档（Source / Concept / Idea / Rule / Card / `log.md`）写在 `write_root` 下对应目录。
- **写盘确认必须列明目标根**（`SKILL.md` 安全模型）：默认写 local，**不写共享根 `<repo>/.mindmate/`**；共享根一旦 push 本地回滚撤不回外发。仅当用户明确「晋升到团队共享」时，走 `organize` 角色的「晋升」动作（`promote`）。
- 无项目根时 `write_root=~/.mindmate/`，所有写行为与单根一致。

## 输入

`--list` | `--create <name>` | `--rename <old> <new>` | `--delete <name>`。确定性操作统一走 `node mindmate.mjs space ... --root <write_root>`（下文各步给出完整命令）。

## 步骤

1. 按 `SKILL.md` 探测 `spaces/` 根。
2. **列**：`node mindmate.mjs space --list --root <write_root>`。扫 `spaces/` 顶层目录自动发现 Space（排除 `.` / `_` 前缀）；不带任何参数时也默认走列。
3. **建**：`node mindmate.mjs space --create <name> --root <write_root>`。
   - 脚本建 `<name>/` 及 `index.md` / `log.md` / `concepts/` / `rules/`，并重生成四个 bundle 根（`spaces` / `shelf` / `rules` / `roles`）的 `index.md`。**不建 `sources/`**——Source 全在 `shelf/sources/`，不进任何 Space。
   - Space 名一律**可读小写 slug**；脚本拒绝非法名与重名。
   - **建需确认**（写盘）。由 `capture` 角色判断内容是否需要新 Space 时，一次只提议一个、先说明现状 + 给一个起名建议 + 等用户确认；不静默建、不批量建、不因话题关键词造碎片 Space。
4. **改名**：`node mindmate.mjs space --rename <old> <new> --root <write_root>`。脚本重命名目录、把文档里 `](<old>/` 批量改为 `](<new>/`、重生成 root `index.md`；新名须为合法 slug。**改名需确认**（写盘）。
5. **删**：`node mindmate.mjs space --delete <name> --root <write_root>`。**仅空 Space**：脚本拒绝默认 `inbox`；非空或有散落文件时列出待迁移文件并拒绝，不自动迁移、不静默删。**删需确认**（破坏性，永远确认，`--yolo` 不豁免）。
6. 报告结果；`index.md` 一律由脚本确定性生成，LLM 不手写。

## 硬约束

- **不做「切换并持久化当前 Space」**：Space 列表每次扫目录发现，不存在 `current_space` 状态；**读类流程缺省 `--space` 即全库检索**，写类流程的目标 Space 由 `--space` 参数或默认 `inbox` 给定（写单归属）。
- **Space 是少而稳定的知识唯一归属维度（读可跨、写不分散），不是标签，也不是检索隔离边界**：优先复用已有 Space（含 `inbox`），宁可先落 `inbox` 以后用 `mmt:organize` 的「跨 Space 迁移」动作迁移，也不造碎片 Space。本角色只管建 / 改名 / 删，搬运文档归 `organize`（调 `move` 脚本）。
- 建 / 改名 / 删都先列清单等确认；删只允许空 Space、拒绝默认 `inbox`。
- `index.md` 由脚本生成，LLM 不手写。
- 不因话题关键词自动建 Space；新 Space 一次最多提议一个。
