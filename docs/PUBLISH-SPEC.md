# DSH 插件上架规范与实操（本机实测整理）

> 来源：`@nethiel/dsh-llm-keypool` 从 0.1.0 到 0.1.5 完整上架过程（2026-10 ~ 11），
> 加上 `dsh-community-plugins` 官方 README 的强制约定。
> 原始记录：`DSH\reports\2026-10-25-发布对齐与缺口清单.md`（306 行，十三轮）。

## 一、package.json 硬性要求

社区仓的 `scripts/family-dsh-engines.test.mjs` 会**强制校验**，缺一项 CI 就红。

| 字段 | 要求 | 说明 |
|---|---|---|
| `name` | **必须 scoped** `@账号/包名` | 非 scoped 会在市场里与别人撞名 |
| `publishConfig.access` | `"public"` | scoped 包默认私有，不写发不出去 |
| `dsh.bundle.patch` | `./cordis.patch.yml` | 官方 bundle 清单，`dsh plugin` 靠它识别 |
| `dsh.client.platform` | `"web"` | 有浏览器半区的插件必填 |
| **`dsh.engines.dsh`** | `">=X.Y.Z[-rc.N]"` | **★必填**（issue #754）。唯一支持 `>= semver` 形式 |
| `engines.node` | `>=22.12.0` | 参考实现用的值 |
| `exports["./cordis.patch.yml"]` | 必填 | 否则外部读不到 patch |
| `icon` | 顶层字段 `icon.svg` | 市场列表显示 |
| `peerDependencies` | `react` / `react-dom` | 浏览器半区不打包 React |
| `dsh.compatibility.dshReleases` | 按内核版本逐个声明 | 只写实测过的版本 |
| `private` | **必须删除** | 残留 `true` 会让 `npm publish` 直接失败 |

`dsh.engines.dsh` 的用途：插件管理器在**更新检查与更新前**读取它，据此提示或拦截不兼容的内核。
顶层 `engines.dsh` 只是兼容读取的备用位，新声明一律用 `dsh.engines.dsh`。

## 二、三个需要同步改名的位置

改名是最大的坑，漏一处就静默失效：

1. `package.json` 的 `name`
2. `cordis.patch.yml` 行里的 `name`（含子路径）
3. **浏览器半区 `window.__ModuleLoader__.load({ id })`** ← 最容易漏

第 3 项漏改的后果不是报错，而是**重复注册**：内核按包名识别 bundle，
id 与包名不一致时同一份 bundle 会被装载多次，日志每 5 分钟刷一次
`duplicate factory registration`（实测 22 次/小时）。

**行 `id`（patch 里的 `id: turn-report`）不要改** —— 那是用户配置的锚点，改了会丢配置。

## 三、一个包只挂一行

keypool 0.1.0 在 patch 里挂了三行（同一包），导致 client bundle 被装载三次。
0.1.1 改为**单行挂载**，`index.js` 在同一 fiber 内直接 apply 各子模块。

**这条是硬规则**：一个 npm 包在 `cordis.patch.yml` 里只能有一行。

## 四、npm 发布流程

本机**没有全局 npm CLI**（DSH 自带只有 node + pnpm）。实测可行路径：

```powershell
# 1. 用 DSH 的 pnpm 把 npm 装到工作区
pnpm add npm --dir tools\npm-cli

# 2. 登录（必须在可见终端窗口）
tools\npm-login-window.ps1   # npm login --auth-type=web
npm whoami                    # nethiel

# 3. 暂存发布（不是直接 publish）
npm stage publish --registry=https://registry.npmjs.org
```

要点：

- **必须走代理** `127.0.0.1:7890`，直连会 `ECONNRESET`
- agent 的重定向 stdin **无法完成 `npm login`**（卡在 `Username:`），必须开可见窗口
- 登录链接**约 10 分钟过期**，过期报 `Invalid or Expired Token`
- `npm stage publish` 后 registry 只显示占位 `0.0.0-stage`，**需用户到
  `https://www.npmjs.com/settings/账号/staged-packages` 点 Approve**
- Approve 可能触发 Windows Hello 验证；passkey 可能绑在另一台设备上
- token 写在 `~/.npmrc`，**不要进仓库**（`.gitignore` 加 `.npmrc`）

## 五、市场收录

### 5.1 dsh-market.com（DSH 侧边栏「插件市场」）

数据源是 `zhu1090093659/dsh-community-plugins` 的 `community.json`。

1. Fork 该仓，在 `community.json` **按 `id` 升序**插入条目
   （升序是数据契约，`assertSortedById` 会校验）：
   ```json
   {
     "id": "账号/包名",
     "name": "中文名",
     "nameEn": "English Name",
     "author": "账号",
     "repo": "https://github.com/账号/包名",
     "npm": "@账号/包名",
     "description": "中文描述",
     "descriptionEn": "English description",
     "category": "tools",
     "subcategory": "dev"
   }
   ```
   必填：`id` / `name` / `nameEn` / `author` / `repo`
2. `pnpm community:check` 校验（CI 门禁同款）
3. `node scripts/market-build` 重新生成 `market/dist`，提交生成物
4. 发 PR，等维护者审核合并

合法分类枚举：
```
ui:          terminal / chat / render / panel
agent:       preset
tools:       context / browser / api / model / dev
knowledge:   memory / reading / qa
integration: remote / bridge / sync / external-ai
security:    access / policy
utility:     cleanup / stats / notify / net
```
`subcategory` **只在 `category` 已填时**才被接受。

**注意**：合并后市场清单重建才会出现；维护者可能要求改（keypool 被 `CHANGES_REQUESTED` 一次）。

### 5.2 1024Store（`imsai-sh/awesome-deepseek-harness-plugins`）

1. Fork → 新增 `catalog/plugins/账号--包名.json`（全小写连字符）
2. 发 PR，`static-review` + `merge` 两个 CI 都过会**自动合并**
3. 站点收集有延迟，缓存原因不必重复排查

**自动发现需要三个条件同时满足**：仓库 topic（`dsh-plugin` / `deepseek-harness` / `dsh`）、
`package.json` 有 `dsh.bundle`、npm latest 已发布。

### 5.3 其他

- **dshfind.com**：自动收录（页面 200 即可）
- **1024Store 的 `install` 字段**由对方离线采集任务生成，npm 发版后要等它更新

## 六、发布 ≠ 用户自动升级

**市场只是货架，不是升级器。** 三个事实：

1. 市场（dsh-market / 1024Store / dshfind）只显示信息和安装命令，不检测用户装了什么
2. DSH 本身不自动升级插件 —— 版本锁在 `pnpm-lock` 里，重启不会变版本
3. 用户必须自己跑一次更新：

| 方式 | 命令 |
|---|---|
| npm 安装的用户 | `dsh plugin --profile desktop add @账号/包名@latest` |
| GitHub 安装的用户 | `dsh plugin --profile desktop add github:账号/包名` |
| 图形界面 | 装了 `@linxin666/dsh-client-ui-plugin-manager` 才有「检查更新」 |

所以修复类版本建议在说明里写清「请更新到 x.y.z」。

## 七、发布前检查清单

- [ ] `package.json` 十一项硬性要求全过（见第一节）
- [ ] 包名 scoped，且三处同步（package.json / patch 行 name / `__ModuleLoader__.load id`）
- [ ] patch 里**只有一行**指向本包
- [ ] `stateVersion` 与投影结构改动一致（结构变了必须 bump，否则旧缓存喂旧布局）
- [ ] 无硬编码本地路径（`D:\...`、`C:\Users\...`）
- [ ] 无调试残留（`console.log` / `debugger` / 真实 TODO 注释）
- [ ] 无密钥与凭据；`.gitignore` 含 `.npmrc`
- [ ] 测试全过，README 与 `docs/DETAIL.*` 内容一致
- [ ] 截图是当前版本（市场详情页会被用户对照）
- [ ] `LICENSE` 文件存在且与 `package.json` 的 `license` 一致

## 八、本机环境事实

| 项 | 值 |
|---|---|
| DSH 内核 | 0.2.2-rc.5（profiles: `desktop`） |
| npm | 无全局 CLI；工作区 `tools\npm-cli` 装 npm 11.21.1 |
| npm 账号 | `nethiel`，包名前缀 `@nethiel/` |
| GitHub | `gh` 已登录 `NethielChou`，token 无 `workflow` scope |
| 代理 | `127.0.0.1:7890`（npm 必须走） |