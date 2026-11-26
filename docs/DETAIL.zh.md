# 轮末项目汇报

在每一轮回复结束的位置加一张汇报卡，卡内含任务状态栏（HUD）。
所有数据都由宿主从会话日志推导——**不调用模型、不消耗 token、不写任何文件**。

![真实 DSH 界面里的轮末汇报卡](demo-card.png)

## 每轮都会有的

| 区块 | 出现条件 | 内容 |
|---|---|---|
| 📋 指标 | 每一轮 | 工具调用、失败数（为 0 时隐藏）、改动文件数、结束状态 |
| ⚙️ 执行摘要 | 本轮有模型响应 | 模型、**调用次数**、输入/输出 token、缓存命中率 |
| 📄 产出文件 | 本轮改过文件 | 相对工作区路径，最多 6 个 |
| 📝 本轮完成 | 本轮有新完成的项 | 只列这一轮新打勾的 |
| 🎮 计划 HUD | 本轮写过任务清单 | 进度条 + 三个可折叠槽位 |

## 计划 HUD

```
▰▰▰▰▰▰▰▰ 4/4  ✅ 4  ⏳ 0  ⬜ 0   ✨ 全部完成
📋 当前计划
┌ ▼ ✅ 已完成  4
│  ✅ 修复「下一项」与「进行中」组内容重复
│  ✅ 0% 进度条改为虚线框
│  ✅ 同步更新 README
│  ✅ 验证：syntax + 断言
┈ ⏳ 进行中  0        ← 虚线框、半透明、不可点
┈ ⬜ 待办  0
```

三个槽位**永远都在**，顺序固定。槽位时有时无会让人以为数据丢了；空槽留着才表示「此刻这里是 0」。

## 刻意不做的两件事

- **不重复完整任务清单**。DSH 输入框上方已有原生面板显示当前清单。
  这张卡只补它没有的两件事：**这一轮完成了什么**、**这一轮结束时计划长什么样**。
- **不强制每轮写清单**。调不调用 `todo_write` 是模型自己的判断，强行每轮写会让一句「你好」变成一堆复选框。没写清单的轮次就是没有 HUD。

## 诚实的边界

- 「本轮完成」按条目文本匹配，因为 `todo_write` 条目**没有稳定 id**。
  匹配前会剥掉列表符号、空白并忽略大小写，普通改写没问题——但**实质性改写措辞会被当成新工作**。
- 分组按**状态**，不按任务文本里的缩进。实测真实会话，`todo_write` 载荷全是平铺的
  （5 项里 0 项有缩进），按缩进分组会一个组都分不出来。
- 只保留最近 15 轮的卡片，更早的滚出投影窗口。
- 计划 HUD 是**逐轮快照**。如果模型只写一次清单、之后不更新，卡片就会一直如实显示那份旧清单。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖同一行（整份 `config` 替换，不是深合并）：

```yaml
- id: turn-report
  config:
    maxRows: 6              # 树和完成清单的行数（硬上限 20）
    showWithoutTasks: true  # 本轮没有任务清单时也出卡
    showTree: true          # 允许 ASCII 项目树
    showFiles: true         # 列改动文件
    showFinished: true      # 出「本轮完成」
    showLlm: true           # 出「模型 / 调用次数 / token」摘要行
    showStatusBar: true     # 出计划 HUD
    todoView: auto          # auto | tree | both
```

## 安装

```powershell
dsh plugin --profile desktop add file:"D:\path\to\dsh-turn-report"
```

装完重启 DSH，刷新页面。

## 数据来源

| 数据 | 来源 |
|---|---|
| 任务清单 | `todo_write` 快照（`todo/write`，整表覆盖） |
| 工具调用 / 失败 | 本轮 `tool/call`、`tool/result.message.isError` |
| 模型 / token | 本轮 `assistant/message.usage` 与 `message.source` |
| 改动文件 | `write` / `edit` / `multi_edit` / `insert` / `str_replace_editor` 的参数 |
| 轮次边界 | `turn/start`、`turn/end` |