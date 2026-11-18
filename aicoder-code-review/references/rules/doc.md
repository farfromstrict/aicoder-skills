---
category: doc
language: javascript
tags: [ai-pitfall]
---

## [minor] 代码注释禁止引用评审过程编号、跨仓文件路径行号与后端内部实现名

反例：`export const RECLAIM_WINDOW_DAYS = 30; // 单一真相：UserTokenConst.java:35`
反例：`// 也绝不发出注定被后端拒绝的恢复请求（C11）。`
反例：`// 该关联与后端签发校验 countUserTenantRelation 同源`
正例：`export const RECLAIM_WINDOW_DAYS = 30; // 与服务端回捞窗口保持一致，变更需双向同步`
正例：注释只描述不变量或行为（「与服务端签发校验同源」「变更需双向同步」），不写评审/需求过程编号、跨仓库文件行号、后端内部表名与方法名。
来源：promoted(11-11, 犯错模式 ×3)
