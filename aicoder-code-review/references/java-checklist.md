# Java / Spring 审查清单

按需逐项过，发现问题必须定位到 `文件:行号`。

## 正确性与健壮性

- 空值：NPE 风险（Map.get、链式调用、Optional 误用如 `Optional.get` 无判空）
- 边界：空集合、越界、数值溢出（整型乘法）
- 等值比较：对象用 `==` 而非 `equals`（尤其 String、包装类型）
- 异常：捕获后吞掉不处理、catch (Exception e) 过宽、finally 中 return
- 分支矩阵完备性：同一段逻辑存在多个相互作用条件（标志位、boolean 返回值、集合空/非空、早退、异常 catch）时，枚举组合路径逐条核对——重复（同一组合下关键动作执行多次或分支重叠）与遗漏（组合无定义处理，"无操作"须确认是有意设计而非遗漏）。注意软失败（返回 false 不抛异常）不会中断 try，try 内后续语句仍会执行，会改变组合的实际归属
- 并发：共享可变状态无同步、SimpleDateFormat 复用、ConcurrentModificationException 风险
- 资源：流/连接未用 try-with-resources 关闭

## Spring

- 事务：`@Transactional` 失效场景（同类内部调用、非 public 方法、rollbackFor 缺失导致检查异常不回滚）；事务内做 RPC/IO 拉长事务
- Bean：循环依赖、`@Autowired` 注入多例 Bean 存入单例字段、构造器注入优于字段注入
- 配置：硬编码配置值（应走配置中心/配置文件）、明文密码/密钥
- AOP：自调用不走代理

## MyBatis

- N+1：循环内单条查询，应改批量（`in` 查询/批量接口）
- `${}` 拼接 SQL（注入风险），确认必须动态列名/排序时白名单校验
- 大结果集无分页、`select *`
- update/delete 缺少必要 where 条件

## 团队编码规范（依据用户规则，违反计 🟡 严重）

- class 声明与第一个字段之间必须有一行空行
- 字段声明之间必须有一行空行
- 项目已引入 lombok 时，getter/setter/构造器/日志等必须优先用 lombok 注解（`@Slf4j`、`@RequiredArgsConstructor`、`@Data`/`@Getter`/`@Setter`），禁止手写样板代码
- 实体类慎用 `@Data`（equals/hashCode 隐患），需要时用 `@Getter`/`@Setter` + 按需覆写

## 性能

- 循环内查询/RPC/IO
- 集合选择不当（频繁查找用 List 而非 Set/Map）
- 字符串循环拼接未用 StringBuilder
- 大对象/集合在热路径重复创建

## 可维护性

- 命名与项目既有风格不一致
- 单方法过长、深嵌套（>3 层用卫语句/提前返回）
- 魔法值应提为常量
- 注释与控制流不符（注释声称的路径实际不可达或会被软失败穿透）：误导性注释 🟢，导致维护者误判路径语义 🟡
