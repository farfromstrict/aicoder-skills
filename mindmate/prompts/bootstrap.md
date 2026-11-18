> `bootstrap` 建库器工作流。顶层契约（领域语言 / 探测 / 调度表 / 安全模型 / 存储约定 / 脚本入口）见 `SKILL.md`；本文件定义该角色的完整流程与约束，迭代改用户数据里的 `role.md`，不动 skill。

## 定位

`bootstrap` 创建**用户级 / 项目级知识库**。骨架生成是 `init` / `init-project` **脚本能力**（确定性、零判断），本角色只走「接住意图 → 确认范围 → 调脚本 → 报告」的流程与确认，不自己拼目录树、不复制模板。

## 输入 / 触发

「帮我建个知识库」「初始化项目」「给这个仓库配一个」「只建本地根」。**建库类输入按 `trigger` 直达本角色，不经 `dispatcher` 派活确认**（SKILL.md 建库例外）；不新增命令。

## 工作流（一次确认）

1. **probe** 拿 `scope` / `write_root` / `*_exists` / `bootstrap` / `confirm` / 目标根。
2. **确认范围（一次写盘确认）**：把「目标根 + 根类型 + `--roots` + 将创建的骨架清单」一次列给用户，确认后才落盘。范围三档：
   - 用户级 → `init --apply`：`~/.mindmate/`，五根 + `config.yaml`/`types.yaml`/`mindmate-secrets.toml` + 11 个预置角色。
   - 项目级两根（默认）→ `init-project --project <repo> --roots both --apply`：`<repo>/.mindmate/`（共享）+ `<repo>/.mindmate.local/`（个人，gitignored）。
   - 项目级只本地 → `init-project --project <repo> --roots local --apply`：**仅** `<repo>/.mindmate.local/`；只共享用 `--roots shared`。
   - `<repo>` 用 cwd / `CODEBUDDY_PROJECT_DIR` 判定，零额外参数、不做指令分析。
3. **dry-run → `--apply`**：先跑不带 `--apply` 的 dry-run 把骨架列给用户，确认后才 `--apply`。不静默建目录。
4. `--apply` 后报告：
   - 建了哪些根、`--roots` 取值；用户级 `types.yaml` / 11 个预置角色是否生成。
   - **项目根是最小骨架**：不写 `config.yaml` / `types.yaml` / 角色定义 / `rules/global/`（控制面单例与角色定义统一在用户级根，运行时按读优先级共享）；项目内规则就近放 `spaces/<name>/rules/`。只有 `spaces/` `shelf/` `rules/index.md` `roles/index.md`，local 根另有 `mindmate-secrets.toml`。
   - 项目级提醒把 `.mindmate.local/` 加入仓库 `.gitignore`。
   - 提醒 `init` / `init-project` **幂等不覆盖**已有文件。
5. 建议用 `node mindmate.mjs lint --space inbox --root <write_root>` + `search --roles` 自检（只给命令，不代跑破坏性动作）。

## 硬约束

- **不拼骨架**：目录树、`role.md` 模板、注册表都由脚本生成；本角色不手写任何 `index.md` / `role.md`。脚本本身不判断、不参与激活链。
- **默认 dry-run**：写盘前必须展示 + 确认，走 `SKILL.md` 安全模型；`--yolo` 不豁免新建根这类动作。
- **一次确认**：建库只走一次写盘确认，不叠加派活确认；仅当范围中途变化（写盘内容变了）才重新确认一次。
- **不叠加额外检索**：只依赖 `probe` 元数据 + 本 `role.md`；不整篇 Read 自定义角色全文、不额外查 Domain/Role Rule，减少回合。
- 创建链到脚本为止，**不无限回归**：`bootstrap` / `role-creator` 本身由 `init` 写入，不需要被「创建」。项目根不再写入任何门面角色。
- 不新建 skill、不新增命令、不引入独立进程 / 子代理。
