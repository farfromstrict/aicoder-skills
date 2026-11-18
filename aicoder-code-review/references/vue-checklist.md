# Vue 审查清单

按需逐项过，发现问题必须定位到 `文件:行号`。

## 响应式（AI 代码高发区）

- 解构 props/reactive 对象导致响应性丢失（应 `toRefs`/`toRef` 或保持属性访问）
- ref 在 `<script>` 中漏 `.value`，在模板中多余 `.value`
- reactive 整体替换（应逐属性赋值或改用 ref）
- `watch` 直接监听 reactive 对象属性（用 getter 函数形式）

## 组合式 API

- 副作用（定时器、事件监听、订阅）未在 `onUnmounted`/`onScopeDispose` 清理 → 内存泄漏
- `watchEffect` 中放入应显式声明依赖的逻辑（依赖不清晰、易误触发）
- composables 未返回响应式引用，或返回后被解构

## 模板

- `v-for` 缺 `key` 或用 index 作 key（列表有增删排序时）
- `v-if` 与 `v-for` 同节点（优先级陷阱）
- 直接修改 props；子组件未声明 `emits`
- 大计算未用 `computed` 缓存，模板内写复杂表达式

## 状态与数据流

- 组件间深层 props 透传（考虑 provide/inject 或状态库）
- 请求未处理 loading/error 状态；竞态（快速切换未取消旧请求）
- API 地址/密钥硬编码在前端代码

## TypeScript（仅 Vue 组件相关）

- props 未定义类型（`defineProps` 泛型）
- `emits` 未声明载荷类型

语言通用项（`any`/`as` 断言、类型守卫、泛型、API 响应类型等）见 `js-ts-checklist.md`。

## 可维护性

- 单组件超 ~300 行且职责混杂（拆分）
- 与项目既有组件/工具重复（先搜 components/ 与 utils/）
