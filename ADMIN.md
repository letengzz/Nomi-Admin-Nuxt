# Nomi Admin · 后台管理系统模板

一套**架在 NuxtTemplate 初始化产物之上**的后台管理系统模板。

NuxtTemplate 的流程原样保留：clone 下来 `pnpm dev`，先在技术栈选择页选好 UI 框架、预处理器、原子化与渲染模式，点「初始化项目」得到一份干净的基线工程；本模板再在基线上叠加后台绕不开的那几件事——**登录页、侧边栏 + 顶栏的工作台、路由守卫、列表页**。

关键差异只有一句：**叠加进来的代码，用的是初始化时选定的那套技术栈。**

选了 Element Plus，拿到的登录页就是 `el-form` + `el-input` + `el-button`；选了 Ant Design Vue，拿到的就是 `a-form` + `a-input` + `a-button`。**没有任何跨框架适配层**——页面上看到什么组件，取决于你在选择页点的是什么。

## 三条硬约束

1. **不改 NuxtTemplate。** 选择页、初始化引擎、引导期文件零改动；本模板只读取初始化生成的 `template.config.json`，在它之后再叠加。
2. **视图层用所选栈的真实组件。** `layouts/` 与 `pages/` 里出现的就是该框架的组件标签，不再包一层 `UiButton` 之类的适配组件。
3. **逻辑层与 UI 框架无关，只写一份。** 菜单、鉴权、守卫、请求封装、列表页状态机放在 `config/`、`composables/`、`middleware/`、`utils/`、`types/`，五档视图层共用；这层里**不许 import 任何 UI 库**。

分界判据是「**删掉 UI 框架依赖之后，这个文件还能不能存在**」：能 → 逻辑层；不能 → 视图层。

## 目录结构

```text
Nomi-Admin-Nuxt/
├─ skeleton/                       # 五档视图层源文件，按 selection.ui 的取值命名
│  ├─ none/app/{layouts,pages}/
│  ├─ element-plus/app/{layouts,pages}/
│  ├─ ant-design-vue/app/{layouts,pages}/
│  ├─ nuxt-ui/app/{layouts,pages}/
│  └─ vuetify/app/{layouts,pages}/
├─ overlay/                        # 待叠加的源文件（第一段不会碰这棵目录，见下方说明）
│  ├─ app/                         # 公共逻辑层（源目录结构 == 产物结构，多一层 app/ 前缀）
│  │  ├─ app.vue                   # 「覆盖基线」：给上游 app.vue 补上 <NuxtLayout>
│  │  ├─ config/{env,menu}.ts
│  │  ├─ types/admin.ts
│  │  ├─ utils/{api,navigation}.ts
│  │  ├─ composables/{useAuth,useMenu,useCrud,useNotify}.ts
│  │  └─ middleware/auth.global.ts
│  └─ server/                      # 演示接口（与 UI 档位无关）
│     ├─ utils/demo-store.ts
│     └─ api/{auth/{login.post,me.get,logout.post},users.{get,post}}.ts
├─ shared/wizard/                  # NuxtTemplate 自带（引导器的白名单/计划/区间表），本模板不改
└─ scripts/admin-init.mjs          # 叠加引擎：读 template.config.json → 挑一套视图层
```

目录名直接等于 `selection.ui` 的取值——**不做任何名称映射**。多一层映射表就多一个「表里写了、目录忘了建」的静默失败点，而按 id 同名的话，目录不存在会立刻在 `plan` 阶段报错。

### 源目录为什么叫 `overlay/` 而不是 `shared/`

第一段生成的 `.nuxt/tsconfig.shared.json` 把 `../shared/**/*` 放进了 `include`，同时把 `~/*` 映射到 `../app/*`。逻辑层这 10 个 `.ts` 是**互相用 `~/config/env` 这样引用**、并且要用到 `useXxx` 自动导入全局的——放进 `shared/` 就会被那份 tsconfig 收编，于是模板仓库**自身**的 `pnpm typecheck` 会因解析不到 `~/config/env` 而变红（这是模板仓库的门禁，不能破）。

`overlay/` 不被任何生成的 tsconfig 引用，也不在引导器的保留/删除清单里（`WIZARD_FILES` 逐条枚举、`KEEP_DIRS` 只有 `scripts/templates`），所以它既不会污染类型检查，也能在 `pnpm verify` 与初始化中安全存活——**不需要改 NuxtTemplate 的任何一行**。


## 用法：两段式初始化

```shell
# 环境：Node >= 22.12（推荐 24 LTS）、pnpm 11
node -v && pnpm -v

# ── 第 1 段：NuxtTemplate 自己的流程 ─────────────────────────────
pnpm install
pnpm dev
# 浏览器打开 http://localhost:3000/setup → 选技术栈 → 点「初始化项目」
# 引导器自删，得到基线工程 + template.config.json
pnpm verify          # 期望：12/12 通过，引导器残留 0

# ── 第 2 段：叠加后台骨架 ────────────────────────────────────────
node scripts/admin-init.mjs --dry-run   # 先看将写哪些文件，不落盘
node scripts/admin-init.mjs             # 叠加：逻辑层 + 对应档位的视图层
# 期望：plan: 逻辑层 10 / 服务端 6 / 视图层 6 / 覆盖基线 1（ui=element-plus）
#       admin-init: 写入 23 个文件 / 覆盖 2 个 / 跳过 0 个 / 失败 0

node scripts/admin-init.mjs --check      # 四项断言
pnpm dev
# 期望：访问 http://localhost:3000/ 被守卫带到 /login；
#       登录后出现「侧边栏 + 顶栏 + 内容区」，控制台 0 error
```

演示账号：`admin / admin123`（管理员）、`viewer / viewer123`（只读，看不到「系统管理」分组）。

### 为什么没有 `pnpm admin:init`

`package.json` 的 `scripts` 区间是 NuxtTemplate 引擎维护的 marker 区间（`TEMPLATE:SCRIPTS`），初始化时会**整段重写**——往里加的任何脚本都会被冲掉。所以第二段的入口一律是 `node scripts/admin-init.mjs`。

## 五档与额外依赖

NuxtTemplate 的选型只负责装**组件库本体**。下面这些是各组件的真实使用中还会需要的东西，它们不在 NuxtTemplate 的依赖映射表里，叠加脚本会在 `plan` 阶段提示：

| 档位 | 额外需要 | 用途 | 是否必需 |
| --- | --- | --- | --- |
| 无 UI 框架 | — | — | — |
| Element Plus | `@element-plus/icons-vue` | `el-icon` 里的图标 | 用到图标时必需 |
| Ant Design Vue | `@ant-design/icons-vue` | 菜单/按钮图标 | 同上 |
| Nuxt UI | `@iconify-json/lucide` | `UIcon` 的图标来源 | 同上 |
| Vuetify | `@mdi/font` | Vuetify 默认图标集是 mdi | **必需**，不装 `v-icon` 显示为空白 |

引擎只提示、不安装：它们不是「初始化的选择」，而是「后续按需加的」——写进 `template.config.json` 会让「从快照复现」的语义变形。

## 文件归属

| 层 | 个数 | 随 UI 档位变化 |
| --- | --- | --- |
| 公共逻辑层 `app/{config,types,utils,composables,middleware}` | 10 | ❌ |
| 演示接口 `server/` | 6 | ❌ |
| 栈视图层 `app/{layouts,pages}` | 6 | ✅ 唯一被替换的一批 |
| 覆盖基线 `app/app.vue` | 1 | ❌ |

首次叠加写入 23 个文件；其中 `app/app.vue` 与 `app/pages/index.vue` 是**覆盖**（上游产物里已存在），其余 21 个是新增。

## `--check`：四项断言

```shell
node scripts/admin-init.mjs --check
# PASS  1 文件齐全（逻辑层 10 / 服务端 6 / 视图层 6 / 覆盖基线 1，合计 23 个）
# PASS  2 框架标签一致（ui=element-plus，本档命中 49、他档命中 0）
# PASS  3 逻辑层无 UI 依赖（扫描 5 个目录，0 命中）
# PASS  4 档位与上游一致（element-plus）
# admin-init: 4/4 通过
```

| # | 断言 | 破了说明什么 |
| --- | --- | --- |
| C1 | `admin.config.json` 的 `layer` 里每个路径都存在 | 有人删了视图层文件，或叠加没跑完 |
| C2 | 本档特征命中 > 0 **且**其他档特征命中 = 0 | 视图层改到一半、或手改时混入了别的档 |
| C3 | 逻辑层目录 grep 各 UI 库 import，结果为 0 | 逻辑层被污染 |
| C4 | `ui === upstreamSelectionUi` | 只跑了 `--ui` 没改依赖（依赖与代码错配） |

C2 与 C3 必须一起看：C2 过、C3 不过是最难察觉的一种——视图层标签全对（页面看起来完全正常），但逻辑层里藏着一个 `import { ElMessage } from 'element-plus'`，换栈会**在换到一半时炸在逻辑层**。

## 换栈：两件事，不是一件

| 半边 | 内容 | 谁负责 |
| --- | --- | --- |
| **依赖** | 装目标框架、卸旧框架、调整 `nuxt.config.ts` 的 `modules` 与 CSS 入口顺序 | **NuxtTemplate**（重跑初始化最稳） |
| **代码** | 替换那 6 个视图层文件 | **本模板**（`--ui`） |

```shell
# 只是想看看另一档长什么样（依赖不动，只能看与框架组件无关的部分）
node scripts/admin-init.mjs --ui ant-design-vue

# 改动面恰好是那 6 个视图层文件 + 1 个产物记录
# （admin.config.json 会记录新的 ui 与 appliedAt，这是预期的）
git status --short

node scripts/admin-init.mjs --ui element-plus   # 换回来
```

**只做「代码」那一半是最常见的错**：`--ui` 会成功、C1 也会过，但依赖还是旧的，页面白屏报一串「Failed to resolve component」。`--check` 的 C4 就是拦这个——表面症状指向视图层，根因在依赖。

已经写了业务代码还想换档：重跑两段式初始化（依赖、CSS 入口顺序、`template.config.json` 一次性对齐），然后只把 `app/pages/**` 与 `app/components/**` 里的业务代码搬过去——业务代码只依赖逻辑层接口，搬过去就能用。

## 回到第一段

```shell
node scripts/admin-init.mjs --rollback    # 从最近一次 *-admin 快照还原
```

快照只包含**将被覆盖的文件**，在 `.init-backup/<时间戳>-admin/` 下，与 NuxtTemplate 的快照同目录但一眼可区分。

## 与文档的四处刻意差异

本模板的实现严格照着 `docs-website` 里 `project/Base/AdminTemplate/` 的九页文档写，但有四处**必须偏离**，否则跑不起来或判据不成立：

1. **`app/app.vue` 必须覆盖。** 文档第 5.2 节（布局）说「NuxtTemplate 初始化的 `app.vue` 已经满足 `<NuxtLayout>` 前提」——实测**不成立**：初始化产出的 `app.vue` 是 `<NuxtRouteAnnouncer /><NuxtPage />`，**没有 `<NuxtLayout>`**，而 Nuxt 只在你调用 `<NuxtLayout>` 的地方应用布局。不覆盖它，五档布局会完全不生效，且页面正常渲染、控制台干净。本模板把它放在 `overlay/app/app.vue`（与 UI 框架无关，删掉任何组件库照样编译），作为「覆盖基线」单独计数。

2. **写入总数是 23，不是文档里的 21。** 文档写「写入 21 个文件 / 覆盖 1 个」，但 10 + 6 + 6 本身就是 22，且还漏了必须覆盖的 `app/app.vue`。实际是 **23 = 逻辑层 10 + 服务端 6 + 视图层 6（2 布局 + 4 页面）+ 覆盖基线 1**，其中被覆盖的是 `app/app.vue` 与 `app/pages/index.vue` 两个。

3. **换档的 `git status` 是 7 行不是 6 行。** 6 个视图层文件之外，`admin.config.json` 也会变（它记录本次生效的 `ui` 与 `appliedAt`）。真正的判据是「改动面里除 `admin.config.json` 外，恰好只有那 6 个」。

4. **源目录是 `overlay/` 而不是文档里的 `shared/`。** 文档把所有源文件都写作 `shared/app/**`、`shared/server/**`，但第一段生成的 `.nuxt/tsconfig.shared.json` 会把 `shared/**` 收进 `include` 且 `~/*` 指向 `../app/*`，逻辑层放进 `shared/` 会让模板仓库自身的 `pnpm typecheck` 报错（理由见上文「源目录为什么叫 `overlay/`」）。**产物的目录结构完全不变**（仍是 `app/**`、`server/**`），受影响的只有仓库里「源文件放哪儿」。

另外文档 Bootstrap 页给出的 `expand()` 节选按「相对源目录」取键，会把 `overlay/app/config/env.ts` 映射成 `config/env.ts`（丢掉 `app/` 前缀）。实现里给 `expand()` 加了 `prefix` 参数，其余不变。

## 自检

```shell
node scripts/admin-init.mjs --help        # 全部选项
node scripts/admin-init.mjs --dry-run     # 幂等：连跑两次输出逐字节相同
node scripts/admin-init.mjs --check       # 日常门禁
```
