# Nomi Admin · 后台管理系统模板

一套**把后台管理系统接进 NuxtTemplate 初始化流水线**的模板。

用法与 NuxtTemplate 完全一致：clone 下来 `pnpm install`、`pnpm dev`，在技术栈选择页选好 UI 框架、预处理器、原子化与渲染模式，点「初始化项目」——**初始化跑完，你手上就是一个后台管理系统，浏览器直接落到登录页**。没有第二条命令要记。

关键差异只有一句：**叠加进来的代码，用的是你刚才选定的那套技术栈。**

选了 Element Plus，登录页就是 `el-form` + `el-input` + `el-button`；选了 Ant Design Vue，就是 `a-form` + `a-input` + `a-button`。**没有任何跨框架适配层**——页面上看到什么组件，取决于你在选择页点的是什么。

## 三条硬约束

1. **上游不动，本文档所在的仓库往前接一段。** 上游 `nuxt-shuttle`（通用模板）的选择页与引导期文件照旧；本仓库作为它的**派生模板**，在初始化引擎里插入了第 5 阶段「叠加后台骨架」。边界仍然只有一处：读初始化写出的 `template.config.json`。
2. **视图层用所选栈的真实组件。** `layouts/` 与 `pages/` 里出现的就是该框架的组件标签，不再包一层 `UiButton` 之类的适配组件。
3. **逻辑层与 UI 框架无关，只写一份。** 菜单、鉴权、守卫、请求封装、列表页状态机放在 `config/`、`composables/`、`middleware/`、`utils/`、`types/`，五档视图层共用；这层里**不许 import 任何 UI 库**。

分界判据是「**删掉 UI 框架依赖之后，这个文件还能不能存在**」：能 → 逻辑层；不能 → 视图层。

## 用法：一次初始化

```shell
# 环境：Node >= 22.12（推荐 24 LTS）、pnpm 11
node -v && pnpm -v

pnpm install
pnpm dev
# 浏览器打开 http://localhost:3000/setup → 选技术栈 → 点「初始化项目」
#
# 引擎跑六个阶段：
#   [1/6] 计算计划 → [2/6] 备份快照 → [3/6] 安装依赖
#   [4/6] 改写与自举 → [5/6] 叠加后台骨架 → [6/6] 校验产物
#
# 期望：退出码 0，第 5 阶段打印 C1~C5 全 PASS，第 6 阶段 12 项通过（引导器残留 0）
# 然后浏览器在 1.5 秒后自动跳到 / ，被守卫带到 /login
```

演示账号：`admin / admin123`（管理员）、`viewer / viewer123`（只读，看不到「系统管理」分组）。

### 为什么后台骨架是引擎的第 5 阶段，而不是第二个脚本

早先的实现把它做成第二条命令（`node scripts/admin-init.mjs`）。那是个缺陷：

- 忘了跑的人会得到一个**干净的 Nuxt 基线**，而且完全不知道自己少了什么——引导器已经自删，仓库里没有任何提示；
- 第 5 阶段排在 `verify` **之前**，所以那 12 项断言验的是**最终产物**。排在后面的话，第 8 项「首页已替换」验的就是叠加前的中间态——一条永远绿、却什么都没验的断言。

`scripts/admin-init.mjs` 仍然保留，但它现在只干另外三件事：`--check` 复核、`--ui` 换栈、`--rollback` 回滚。

## 目录结构

```text
Nomi-Admin-Nuxt/
├─ skeleton/                       # 五档视图层源文件，按 selection.ui 的取值命名
│  ├─ none/app/{layouts,pages}/
│  ├─ element-plus/app/{layouts,pages}/
│  ├─ ant-design-vue/app/{layouts,pages}/
│  ├─ nuxt-ui/app/{layouts,pages}/
│  └─ vuetify/app/{layouts,pages}/
├─ overlay/                        # 待叠加的源文件（引擎的删除/保留清单都不会碰这棵目录）
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
├─ shared/wizard/                  # 引导器的白名单/计划/区间表（第 1~4 阶段读它）
├─ scripts/init.mjs                # 初始化引擎：六阶段，第 5 阶段读 admin-layer
├─ scripts/lib/admin-layer.mjs     # 后台骨架层：plan → snapshot → apply → verify(C1~C5)
└─ scripts/admin-init.mjs          # 薄 CLI 外壳：--check / --ui / --rollback
```

目录名直接等于 `selection.ui` 的取值——**不做任何名称映射**。多一层映射表就多一个「表里写了、目录忘了建」的静默失败点，而按 id 同名的话，目录不存在会立刻在 `plan` 阶段报错。

### 叠加逻辑为什么住在 `scripts/lib/admin-layer.mjs`

同一套逻辑有两个消费者，而且它们必须产出**逐字节相同**的结果：

- 引擎的第 5 阶段（`scripts/init.mjs`）；
- `scripts/admin-init.mjs` 的 `--ui` / `--check`。

两处各写一份的话，迟早出现「初始化叠出来的是 A 档、`--check` 按 B 档验」这类只在特定路径上出现的分叉。共享层里已经有一条同源纪律（`shared/wizard/plan.mjs` 由服务端与引擎共用），这里照办。

### 源目录为什么叫 `overlay/` 而不是 `shared/`

引擎生成的 `.nuxt/tsconfig.shared.json` 把 `../shared/**/*` 放进了 `include`，同时把 `~/*` 映射到 `../app/*`。逻辑层这 10 个 `.ts` 是**互相用 `~/config/env` 这样引用**、并且要用到 `useXxx` 自动导入全局的——放进 `shared/` 就会被那份 tsconfig 收编，于是模板仓库**自身**的 `pnpm typecheck` 会因解析不到 `~/config/env` 而变红（这是模板仓库的门禁，不能破）。

`overlay/` 不被任何生成的 tsconfig 引用，也不在引导器的删除清单里（`WIZARD_FILES` 逐条枚举），所以它既不会污染类型检查，也能在初始化中安全存活。

## 五档依赖：唯一的入口是 `options.json`

后台骨架**不引入任何新依赖**——它要用到的包全部写进 `server/utils/wizard/options.json` 对应档位的 `deps` / `devDeps`，由引擎的第 3 阶段统一安装。于是「配置声明了模块、模块还没装」那个危险窗口不会在叠加期重新出现。

| 档位 | 它比组件库本体还多要什么 | 为什么 |
| --- | --- | --- |
| 无 UI 框架 | — | — |
| Element Plus | `dayjs`、`lodash-unified`、`@element-plus/icons-vue` | Element Plus 直接 import 前两个；它们不在项目根部就无法被 Vite 预打包，运行期报 `NUXT_B7002`/`default 导出缺失`。图标包给 `el-icon` 用 |
| Ant Design Vue | `dayjs`、`@ant-design/icons-vue` | 同上（`dayjs` 上游已声明） |
| Nuxt UI | `@iconify-json/lucide` | `UIcon name="i-lucide-…"` 按名字取图标，**不体现在任何一行 import 里** |
| Vuetify | `@mdi/font` | `v-icon` 的默认图标集是 mdi 字体，同样不体现在 import 里 |

## 文件归属

| 层 | 个数 | 随 UI 档位变化 |
| --- | --- | --- |
| 公共逻辑层 `app/{config,types,utils,composables,middleware}` | 10 | ❌ |
| 演示接口 `server/` | 6 | ❌ |
| 栈视图层 `app/{layouts,pages}` | 6 | ✅ 唯一被替换的一批 |
| 覆盖基线 `app/app.vue` | 1 | ❌ |

首次叠加写入 23 个文件；其中 `app/app.vue` 与 `app/pages/index.vue` 是**覆盖**（上游产物里已存在），其余 21 个是新增。

## `--check`：五项断言

```shell
node scripts/admin-init.mjs --check
# PASS  1 文件齐全（逻辑层 10 / 服务端 6 / 视图层 6 / 覆盖基线 1，合计 23 个）
# PASS  2 框架标签一致（ui=element-plus，本档命中 49、他档命中 0）
# PASS  3 逻辑层无 UI 依赖（扫描 5 个目录，0 命中）
# PASS  4 档位与上游一致（element-plus）
# PASS  5 视图层依赖与选择一致（扫出 3 个第三方包，全部在本次选择的 18 个依赖里且可解析）
# admin-init: 5/5 通过
```

| # | 断言 | 破了说明什么 |
| --- | --- | --- |
| C1 | `admin.config.json` 的 `layer` 里每个路径都存在 | 有人删了视图层文件，或叠加没跑完 |
| C2 | 本档特征命中 > 0 **且**其他档特征命中 = 0 | 视图层改到一半、或手改时混入了别的档 |
| C3 | 逻辑层目录 grep 各 UI 库 import，结果为 0 | 逻辑层被污染 |
| C4 | `ui === upstreamSelectionUi` | 只跑了 `--ui` 没改依赖（依赖与代码错配） |
| C5 | 四层源码里扫出的**每个裸 import** 都在本次选择的 `deps`/`devDeps` 里，且能 resolve | 视图层 import 了一个没声明的包 |

C5 是这五条里唯一**从源码反推**的一条，其余四条都是「列一份清单逐个查」。区别在于：硬编码清单只能守住你今天想到的包，而「视图层 import 了一个没声明的包」是随代码长出来的——有人给用户列表加个日期格式化、import 了 `dayjs`，C1~C4 全绿，`pnpm dev` 一起就报 `NUXT_B7002`。所以判据必须从 import 反推：**视图层依赖的任何第三方包，都必须是本次选择声明过的依赖。** 依赖只有一个入口，`template.config.json` 才是唯一事实。

C2 与 C3 必须一起看：C2 过、C3 不过是最难察觉的一种——视图层标签全对（页面看起来完全正常），但逻辑层里藏着一个 `import { ElMessage } from 'element-plus'`，换栈会**在换到一半时炸在逻辑层**。

## 换栈：两件事，不是一件

| 半边 | 内容 | 谁负责 |
| --- | --- | --- |
| **依赖** | 装目标框架、卸旧框架、调整 `nuxt.config.ts` 的 `modules` 与 CSS 入口顺序 | **初始化引擎**（重跑初始化最稳） |
| **代码** | 替换那 6 个视图层文件 | **本模板**（`--ui`） |

```shell
# 只是想看看另一档长什么样（依赖不动，只能看与框架组件无关的部分）
node scripts/admin-init.mjs --ui ant-design-vue

# 改动面恰好是那 6 个视图层文件 + 1 个产物记录
# （admin.config.json 会记录新的 ui 与 appliedAt，这是预期的）
git status --short

node scripts/admin-init.mjs --ui element-plus   # 换回来
```

**只做「代码」那一半是最常见的错**：`--ui` 会成功、C1 也会过，但依赖还是旧的，页面白屏报一串「Failed to resolve component」，C5 同时报「`ant-design-vue` 没有出现在本次选择的依赖里」。表面症状指向视图层，根因在依赖。

已经写了业务代码还想换档：重跑一次初始化（依赖、CSS 入口顺序、`template.config.json` 一次性对齐），然后只把 `app/pages/**` 与 `app/components/**` 里的业务代码搬过去——业务代码只依赖逻辑层接口，搬过去就能用。

## 回滚

```shell
node scripts/admin-init.mjs --rollback    # 从最近一次 *-admin 快照还原
```

快照只包含**将被覆盖的文件**，在 `.init-backup/<时间戳>-admin/` 下，与引擎的快照同目录但一眼可区分。整段初始化的回滚仍然走 `node scripts/init.mjs --rollback`。

## 与文档的四处刻意差异

本模板的实现照着 `docs-website` 里 `project/Base/AdminTemplate/` 的九页文档写，但有四处**必须偏离**：

1. **`app/app.vue` 必须覆盖。** 文档第 5.2 节（布局）说「NuxtTemplate 初始化的 `app.vue` 已经满足 `<NuxtLayout>` 前提」——实测**不成立**：初始化产出的 `app.vue` 是 `<NuxtRouteAnnouncer /><NuxtPage />`，**没有 `<NuxtLayout>`**，而 Nuxt 只在你调用 `<NuxtLayout>` 的地方应用布局。不覆盖它，五档布局会完全不生效，且页面正常渲染、控制台干净。本模板把它放在 `overlay/app/app.vue`（与 UI 框架无关，删掉任何组件库照样编译），作为「覆盖基线」单独计数。

2. **叠加是引擎的第 5 阶段，不是独立的第二段脚本。** 文档 Bootstrap 页把它写成两段式（`node scripts/admin-init.mjs` 是用户的第二步）。实测这个设计会让人**忘了跑第二步**，而忘了跑的结果是一个看不出少了什么的干净基线。所以它现在是 `init.mjs` 的第 5 阶段，排在 `verify` 之前。

3. **写入总数是 23，不是文档里的 21。** 文档写「写入 21 个文件 / 覆盖 1 个」，但 10 + 6 + 6 本身就是 22，且还漏了必须覆盖的 `app/app.vue`。实际是 **23 = 逻辑层 10 + 服务端 6 + 视图层 6（2 布局 + 4 页面）+ 覆盖基线 1**，其中被覆盖的是 `app/app.vue` 与 `app/pages/index.vue` 两个。

4. **源目录是 `overlay/` 而不是文档里的 `shared/`。** 文档把所有源文件都写作 `shared/app/**`、`shared/server/**`，但引擎生成的 `.nuxt/tsconfig.shared.json` 会把 `shared/**` 收进 `include` 且 `~/*` 指向 `../app/*`，逻辑层放进 `shared/` 会让模板仓库自身的 `pnpm typecheck` 报错。**产物的目录结构完全不变**（仍是 `app/**`、`server/**`）。

另外文档 Bootstrap 页给出的 `expand()` 节选按「相对源目录」取键，会把 `overlay/app/config/env.ts` 映射成 `config/env.ts`（丢掉 `app/` 前缀）。实现里给 `expand()` 加了 `prefix` 参数，其余不变。

## 自检

```shell
node scripts/init.mjs --help              # 引擎全部选项（含 --skip-admin）
node scripts/admin-init.mjs --help        # 叠加层的全部选项
node scripts/admin-init.mjs --dry-run     # 幂等：连跑两次输出逐字节相同
node scripts/admin-init.mjs --check       # 日常门禁 C1~C5
pnpm selftest                             # 引擎自测（A11 钉住六阶段顺序）
```

`--skip-admin` 是给「只要上游基线」的场景留的（引擎自测、对照实验）；正常使用不要加。
