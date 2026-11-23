# Nomi Admin Nuxt

基于 **Nuxt 4 + Vue 3 + TypeScript** 的企业级中后台开发模板，集成
Element Plus、Pinia、VueUse、UnoCSS、Sass、国际化、SEO 以及代码质量与 Docker
部署工具链。

项目采用 Nuxt 4 的 `app/` 目录结构，支持 SSR、SPA、预渲染与混合渲染，适合作为
运营管理后台、企业内部系统和中台业务应用的开发基座。

## 技术栈

| 分类       | 技术方案                                | 用途                                       |
| ---------- | --------------------------------------- | ------------------------------------------ |
| 应用框架   | Nuxt 4、Vue 3                           | 文件路由、混合渲染、Nitro 服务端能力       |
| 开发语言   | TypeScript                              | 严格模式、索引访问检查与显式 override 检查 |
| UI 组件    | Element Plus                            | 中后台组件体系                             |
| 状态管理   | Pinia                                   | 跨页面、跨组件状态共享                     |
| 组合式工具 | VueUse                                  | 常用浏览器与响应式工具函数                 |
| 样式方案   | UnoCSS、Sass、CSS Variables             | 原子化样式、设计令牌与主题扩展             |
| 国际化     | Nuxt i18n                               | 中文、英文语言资源与路由前缀               |
| 图标与图片 | Nuxt Icon、Nuxt Image                   | 图标按需使用与图片优化                     |
| SEO        | Nuxt SEO                                | 站点信息、canonical、sitemap 等能力        |
| 工程规范   | ESLint、Prettier、Stylelint             | 代码检查、格式统一与样式检查               |
| 测试       | Vitest、Vue Test Utils、Nuxt Test Utils | 单元测试、组件测试与 Nuxt 运行时测试       |
| 部署       | Docker、Docker Compose、Nginx           | 多阶段镜像、容器编排、反向代理与健康检查   |

## 核心特性

- **混合渲染**：公开页面可预渲染，后台路由可切换为 SPA，其余页面默认 SSR。
- **严格类型约束**：启用 TypeScript 严格模式，并拆分应用、服务端、共享代码类型配置。
- **中后台 UI 体系**：Element Plus 与全局设计令牌结合，便于统一主题和组件风格。
- **清晰的状态边界**：Pinia 管理跨路由状态，局部状态仍保留在组件内部。
- **可扩展的样式架构**：UnoCSS、Sass 变量和 CSS 变量分层使用，支持暗色系统偏好。
- **双语资源**：默认中文，英文路由使用 `/en` 前缀，默认语言不添加路由前缀。
- **质量工具齐全**：内置 ESLint、Stylelint、Vitest、类型检查和模板产物校验命令。
- **可直接容器化**：提供多阶段 Dockerfile、Compose 配置、Nginx 配置和健康检查接口。

## 环境要求

- Node.js **>= 22.12.0**
- pnpm，建议使用 **11.x**，与当前 `pnpm-workspace.yaml` 配置保持一致
- Docker 与 Docker Compose（仅容器化部署时需要）

## 快速开始

```bash
# 安装依赖；postinstall 会自动执行 nuxt prepare
pnpm install

# 启动开发服务
pnpm dev
```

> **安装需要访问 `cdn.sheetjs.com`。** `xlsx` 在 npm 上停在 0.18.5（含两个高危漏洞），
> 修复版本只在 SheetJS 自有源站发布，因此依赖写成
> `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，`pnpm-lock.yaml` 里已钉住 `integrity`。
> 内网构建可先在有网环境 `pnpm fetch` 预热 store，或把 tarball 落到制品库后改为
> `file:./vendor/xlsx-0.20.3.tgz`；**不要**改回 npm 版本。

访问：

- 应用首页：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>

生产构建与本地预览：

```bash
pnpm build
pnpm preview
```

## 常用命令

| 命令                 | 说明                                         |
| -------------------- | -------------------------------------------- |
| `pnpm dev`           | 启动 Nuxt 开发服务                           |
| `pnpm build`         | 构建 SSR / Nitro 生产产物，输出到 `.output/` |
| `pnpm generate`      | 生成静态站点                                 |
| `pnpm generate:demo` | 生成**带假数据**的静态演示站（不连后端）      |
| `pnpm preview`       | 预览已构建或已生成的产物                     |
| `pnpm lint`          | 执行 ESLint 检查                             |
| `pnpm lint:fix`      | 自动修复可修复的 ESLint 问题                 |
| `pnpm lint:style`    | 检查独立 CSS / Sass 样式文件                 |
| `pnpm test`          | 执行全部 Vitest 测试                         |
| `pnpm test:watch`    | 以监听模式运行测试                           |
| `pnpm run typecheck` | 执行 Nuxt TypeScript 类型检查                |

建议提交代码前至少执行：

```bash
pnpm lint
pnpm lint:style
pnpm run typecheck
pnpm test
```

## 渲染策略

当前 `nuxt.config.ts` 使用混合渲染：

| 路由        | 策略               | 适用场景                       |
| ----------- | ------------------ | ------------------------------ |
| `/`         | 预渲染             | 公开首页、说明页               |
| `/admin/**` | 关闭 SSR，使用 SPA | 登录后的后台页面，按需新增     |
| 其他路由    | SSR                | 需要服务端渲染的公开或动态页面 |

根据业务调整 `routeRules` 即可，不需要重新执行模板初始化。若应用依赖
`server/api/`、服务端中间件或其他 Nitro 能力，生产部署应使用 `pnpm build`，
不要改为纯静态托管。

## 项目目录

以下结构遵循 Nuxt 4 约定，并为企业级后台扩展预留了清晰分层：

```text
Nomi-Admin-Nuxt/
├─ app/                              # Nuxt 客户端与通用应用代码
│  ├─ assets/
│  │  ├─ images/                     # 参与构建的图片资源
│  │  └─ styles/                     # 设计令牌、基础样式与全局样式
│  ├─ components/
│  │  ├─ base/                       # 无业务语义的基础组件
│  │  ├─ business/                   # 可复用业务组件
│  │  └─ layout/                     # 布局内部组件，如侧栏、顶栏、标签页
│  ├─ composables/                   # 组合式函数，如分页、字典、权限判断
│  ├─ constants/                     # 前端常量、枚举映射与静态配置
│  ├─ layouts/                       # Nuxt 布局，如 default、admin、auth
│  ├─ middleware/                    # 路由中间件，如认证与权限守卫
│  ├─ pages/
│  │  ├─ admin/                      # 后台页面，对应 /admin/** 路由
│  │  └─ index.vue                   # 当前首页
│  ├─ plugins/                       # Nuxt 客户端、服务端或通用插件
│  ├─ services/                      # API 请求封装与数据传输对象转换
│  ├─ stores/                        # Pinia 跨页面状态
│  ├─ types/                         # 前端业务类型与接口定义
│  ├─ utils/                         # 前端通用纯函数
│  └─ app.vue                        # 应用根组件
├─ server/                           # Nitro 服务端代码
│  ├─ api/
│  │  └─ health.get.ts               # 健康检查：GET /api/health
│  ├─ middleware/                    # 服务端请求中间件
│  ├─ plugins/                       # Nitro 插件
│  ├─ services/                      # 服务端业务逻辑与外部服务调用
│  ├─ types/                         # 服务端专用类型
│  └─ utils/                         # 服务端工具函数
├─ shared/                           # 前后端共享且不依赖运行时的代码
│  ├─ constants/                     # 共享常量
│  ├─ schemas/                       # 共享数据结构与校验 Schema
│  ├─ types/                         # 共享类型
│  ├─ utils/                         # 共享纯函数
│  └─ wizard/                        # 模板初始化引擎共享逻辑
├─ i18n/
│  └─ locales/                       # zh.json、en.json 语言资源
├─ public/                           # 不经构建处理的静态资源
├─ test/
│  ├─ unit/                          # 纯函数、Store、Composables 单元测试
│  ├─ integration/                   # 组件、路由与 API 集成测试
│  └─ app.spec.ts                    # 当前 Pinia Store 示例测试
├─ deploy/
│  ├─ nginx.conf                     # 测试环境：3000 入口的反向代理、缓存与流式响应
│  └─ nginx.prod.conf                # 正式环境：80/443 + HTTPS（certbot）+ 反向代理
├─ compose.yaml                      # 测试环境编排（app + MySQL + nginx）
├─ compose.prod.yaml                 # 正式环境覆盖配置（app 绑本机，容器 nginx 不启动）
├─ .github/
│  └─ workflows/ci-cd.yml            # CI 门禁 + GitHub Pages 静态发布
├─ nuxt.config.ts                    # Nuxt 模块、渲染、样式与运行期配置
├─ uno.config.ts                     # UnoCSS 预设、主题与 shortcuts
├─ vitest.config.ts                  # Vitest 测试环境与匹配规则
├─ eslint.config.mjs                 # ESLint flat config
├─ stylelint.config.mjs              # Stylelint 规则
├─ Dockerfile                        # 多阶段生产镜像
├─ compose.yaml                      # 应用与可选 Nginx 编排
└─ package.json                      # 项目依赖与命令
```

预留的空目录已使用 `.gitkeep` 保留；新增实际源码后，可删除对应的占位文件。
这些目录只提供代码组织约束，不代表相应业务功能已经实现。

## 目录职责与依赖边界

为避免项目增长后出现循环依赖和跨层调用，建议遵循以下规则：

1. **`app/` 只放应用层代码**：页面和组件通过 composables、services、stores
   获取能力，不在组件中散落请求地址和服务端逻辑。
2. **`server/` 只放 Nitro 服务端代码**：数据库、密钥和第三方服务凭证只能留在
   服务端，不进入 `runtimeConfig.public`。
3. **`shared/` 保持运行时无关**：不引用 Vue、Nuxt、Nitro、浏览器 DOM 或
   Node.js 专属 API，确保前后端都可以安全导入。
4. **Store 不替代局部状态**：只有跨组件、跨路由共享或需要统一调试的状态才放入
   Pinia。
5. **Service 不持有 UI 状态**：请求加载态、弹窗开关和表单临时状态由页面、组件或
   composable 管理。

Nuxt 会按约定扫描 `components/`、`composables/`、`layouts/`、`middleware/`、
`pages/`、`plugins/`、`stores/` 和 `utils/`。`constants/`、`services/`、
`types/` 中的内容应显式导入，避免依赖隐式行为。

常用导入别名：

```ts
import UserTable from '~/components/business/UserTable.vue';
import { getUserList } from '~/services/user.service';
import type { UserInfo } from '#shared/types/user.types';
```

## 命名建议

| 类型                   | 约定                               | 示例                                                |
| ---------------------- | ---------------------------------- | --------------------------------------------------- |
| 基础 / 业务 / 布局组件 | PascalCase                         | `BaseModal.vue`、`UserTable.vue`、`AdminHeader.vue` |
| 页面与布局文件         | kebab-case 或 Nuxt 路由约定        | `user-list.vue`、`admin.vue`                        |
| Composable             | `use` 前缀                         | `usePagination.ts`                                  |
| Pinia Store            | 文件名简洁，导出 `useXxxStore`     | `user.ts` → `useUserStore`                          |
| Service                | `xxx.service.ts`                   | `user.service.ts`                                   |
| 类型文件               | `xxx.types.ts`                     | `user.types.ts`                                     |
| 路由中间件             | 语义化小写命名                     | `auth.ts`、`permission.ts`                          |
| 测试文件               | 与被测对象对应，以 `.spec.ts` 结尾 | `user.service.spec.ts`                              |

### 状态管理

六个 store + 一层持久化，对应 `docs/状态管理.md` 的方案，按 Nuxt 4 + VueUse 重写：

| Store    | 文件                     | 持久化键                                | 职责                                                     |
| -------- | ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| 布局偏好 | `app/stores/layout.ts`   | `nomi:v1:layout`                        | 菜单类型/宽度、容器宽度、圆角、各区域软开关               |
| 主题     | `app/stores/setting.ts`  | `nomi:color-mode`、`nomi:theme-color`   | 主色与明暗模式（首帧由 `<head>` 内联脚本读同一对键）     |
| 用户     | `app/stores/user.ts`     | `nomi:v1:user`                          | token、身份、语言、搜索历史；登出清理与「换人」判断       |
| 菜单     | `app/stores/menu.ts`     | 不持久化                                | 菜单树、扁平表、首页路径、动态路由注销函数               |
| 标签页   | `app/stores/worktab.ts`  | `nomi:v1:worktab`                       | 多标签状态与 `keepAliveExclude`                          |
| 表格     | `app/stores/table.ts`    | `nomi:v1:table`                         | 尺寸、斑马纹、边框、表头底色                             |

- 持久化不用 `pinia-plugin-persistedstate`，而是 `usePersistedState()`
  （`app/composables/usePersistedState.ts`）：内部是 `useStorage` + `skipHydrate`，
  既保留跨标签页同步，又避免水合时用 SSR 快照覆盖用户真正的偏好。
- 键由 `app/utils/storage-key.ts` 统一生成，格式 `nomi:v{schema}:{name}`。版本段只随
  **持久化结构**变化，不跟应用版本走；`v1` 之前的 `nomi:layout`、`nomi:worktabs`
  等老键会在首次读取时自动搬迁，升级不会重置用户偏好。
- 主题键刻意不带版本段：`<head>` 内联脚本必须在首帧同步读到它，而迁移只能发生在
  JS 加载之后。
- `logOut()` 清凭证、身份与动态路由，保留语言、搜索历史与布局偏好；标签页按
  「是否换了个人」决定保留还是清空（`checkAndClearWorktabs`）。
- store 一律不调用 `navigateTo`：关标签、登出只返回「接下来该去哪」，导航留给组件，
  这样状态层可以在裸 vitest 里测（见 `test/state-layer.spec.ts`）。

## 配置说明

### 应用与运行期配置

主要配置集中在 `nuxt.config.ts`：

- `runtimeConfig.public.appName`：公开的应用名称。
- `i18n`：默认语言、语言列表和路由策略。
- `site`：SEO 使用的站点名称与绝对 URL。
- `routeRules`：各路由的渲染方式。
- `css`：全局样式入口及顺序。

可通过环境变量覆盖对应的运行期配置：

| 环境变量               | 默认值         | 说明                                   |
| ---------------------- | -------------- | -------------------------------------- |
| `NUXT_PUBLIC_APP_NAME` | `Nuxt Shuttle` | 公开应用名称                           |
| `NITRO_HOST`           | Nuxt 默认值    | Nitro 监听地址；容器中为 `0.0.0.0`     |
| `NITRO_PORT`           | `3000`         | Nitro 监听端口                         |
| `NUXT_BUILD_ID`        | `dev`          | 健康检查返回的构建标识，仅展示前 12 位 |

`.env` 已被 Git 忽略，不要提交密钥。部署前还应将 `site.url` 从
`https://example.com` 改为真实域名，并统一 `site.name`、页面标题和 i18n 中的
默认应用名称。

### 权限系统与 MySQL

权限系统（菜单/按钮/接口同源 RBAC、双 token + 409 续期、非超管只看本部门及子部门的部门数据范围）的完整说明见
[`docs/权限系统实现.md`](docs/权限系统实现.md)。

```bash
cp .env.example .env   # 填 MYSQL_PASSWORD 与 TOKEN_SECRET
pnpm dev               # 首次启动自动建库、建表、写入种子数据
```

| 环境变量                             | 默认值      | 说明                                    |
| ------------------------------------ | ----------- | --------------------------------------- |
| `MYSQL_HOST` / `MYSQL_PORT`          | `127.0.0.1` | MySQL 地址与端口                        |
| `MYSQL_USER` / `MYSQL_PASSWORD`      | `root` / 空 | 账号需有 `CREATE` 权限才能自动建库      |
| `MYSQL_DATABASE`                     | `nomi_admin`| 库名只允许字母、数字、下划线            |
| `MYSQL_POOL_SIZE`                    | `10`        | 连接池上限                              |
| `TOKEN_SECRET`                       | 开发默认值  | token 的 HMAC 密钥，**上线必须改**      |
| `INITIAL_ADMIN_PASSWORD`             | 随机生成    | 初始超管口令，至少 16 位且覆盖三类字符  |
| `SEED_DEMO_ACCOUNTS`                 | 非生产才建  | `1` = 连演示账号一起建，`0` = 一律不建  |

首次启动会创建**一个**超级管理员 `super`，口令**不再写死在代码里**：

- 配了 `INITIAL_ADMIN_PASSWORD` 就用它（不够强会直接启动失败，不会静默降级）；
- 没配就随机生成 24 位，写入 `data/initial-admin-password.txt`（权限 600），
  开发环境同时打印在启动日志里；该文件在首次改密后自动删除。

`super` 带 `must_change_password` 标记：**首次登录必须先改密**，改密前除个人中心与退出登录外，
所有接口返回业务码 `428`，前端会直接把用户带到「个人中心 → 修改登录密码」。

演示账号（`admin`、`user` 及 8 名员工，口令与初始超管相同）**只在非生产环境创建**，
生产种子只有 `super` 一个账号；从旧版本升级上来的库如果还留着它们，启动日志会告警。

### 记住密码

登录页勾选「记住密码」后，账号与密码会一起保存在本机，下次打开自动回填；
取消勾选则三者（账号、密码、勾选状态）一并清除。密码在前端做可逆编码（不是加密），
**仅为避免 localStorage 出现裸明文，不能当作凭据保护**；真正的安全边界是同源策略与 XSS 防护。
登录框同时开启了 `autocomplete="username"` / `current-password`，浏览器 / 系统密码管理器
是更推荐的安全路径；服务端另发 refresh token 负责会话续期，与表单回填互不替代。

在线用户 / 系统日志的「登录地点」：内网与本地 IP 自动识别；公网 IP 想显示具体地名，
配 `IP_LOCATION_API`（`{ip}` 占位）即可，不配则显示「公网 IP」，不会留空。
经反向代理部署时要传 `X-Forwarded-For`，详见《部署指南》2.5 节。

### 找回密码与邮件服务

登录页的「忘记密码」走的是**邮箱验证码**：验证码只发到账号在 `user.email` 里绑定的地址，
**不会**出现在接口响应或页面上（早期版本为了演示把验证码直接回传，等于任何人凭账号名就能改掉别人密码）。
输入框收**用户名或绑定邮箱**两种写法 —— 用户记不住登录名时，邮箱往往是唯一能想起来的东西。
登录页同样接受**用户名 / 手机号 / 邮箱**三种标识，服务端按「用户名优先、手机号次之、邮箱最后」定位账号。

- **要先在「系统设置 → 邮件配置」里填 SMTP**（`host` / `port` / `encryption` / `fromAddress`，需要认证再填账号密码）并启用，自助找回才会打开。
- 同一页底部有「**发送测试邮件**」：用**已保存**的配置发一封自检信，不用真的走到忘记密码流程就能确认 SMTP 通不通。
- 没配置时接口返回 `503 当前未配置邮件服务…`，前端提示「请联系管理员重置」——这是**有意的关闭**，不是故障。管理员仍可在「用户管理 → 重置密码」处理（重置出的口令会强制下次登录改密）。
- 本地开发没配 SMTP 时，验证码打印在运行 `pnpm dev` 的终端里，不出网络。
- 新口令要求 ≥10 位、覆盖大小写/数字/符号中的三类、不含账号名 —— 与「个人中心改密」同一套策略。
- 取码时会直接提示三类账号问题：登录名不存在（`404`）、邮箱未绑定用户（`441`）、账号未绑定邮箱（`440`）；账号已停用与冷却期内仍回「已发送」。按 IP 的 5 次/10 分钟限流保留，用来兜住枚举风险。
- 收不到信时再看服务端日志：`[password-reset] 未投递（…）` 与 `[password-reset] 已投递：… → x***@qq.com` 会记下具体原因和脱敏收件人。

首页菜单、按钮权限、接口验权都由数据库里的 `permission_rule` / `role` 驱动，
角色带稳定编码（`super` / `admin` / `member`），改角色名不影响代码里的引用。
账号统一存在 `user` 表，**没有账号类型字段**——能进后台、看到什么，全看它挂的角色；
部门（`department`）只用于归档、筛选与登录页选择，不参与鉴权。改授权不需要改代码。

多语言文案由「系统管理 → 语言管理」维护：首次启动会把 `i18n/locales/*.json` 的
526 个词条、1052 条译文导入数据库，页面上改完立即生效（静态语言文件作为兜底）。
改过 JSON 后执行 `pnpm lang:sync` 重新生成导入种子；新增语言还需在
`nuxt.config.ts` 的 `i18n.locales` 注册才能出现在语言切换菜单。

系统配置（站点 / 安全 / 登录 / 邮件 / 存储 / 环境 / SEO 七个区块）的默认值也会在首次
启动时整份写入 `system_config`，装完打开「系统配置」页看到的就是库里的值；
某个区块「恢复默认」= 删掉该区块的行，读取时回落到代码里的 `DEFAULT_CONFIG`。

启动日志会说明这次初始化到底写了什么，例如：

```text
[db] 已自动创建 数据库 nomi_admin / 表 ... system_config, token, user, user_role
[db] 种子数据已写入：语言 2 / 部门 10 / 菜单/权限节点 55 / 角色 3 / 系统配置 43 / 账号 11
```

第二次启动不会再写任何数据，只打印「库与表已存在且种子齐备，本次不做任何写入」。

### 样式入口

当前全局样式顺序为：

```text
UnoCSS → tokens.scss → base.css → Element Plus
```

新增样式时保持以下约束：

- 当前 Sass 方案以 `app/assets/styles/tokens.scss` 作为设计令牌入口。
- 业务组件优先使用语义化 CSS 变量和 UnoCSS shortcuts，避免重复定义颜色与间距。
- 组件库样式必须先于业务覆盖样式加载。
- 不通过滥用 `!important` 或行内布局样式解决层叠问题。

### 国际化

语言资源位于 `i18n/locales/`。新增语言时需要同步完成：

1. 添加对应的 JSON 语言文件。
2. 在 `nuxt.config.ts` 的 `i18n.locales` 中注册语言。
3. 保持各语言文件的 key 结构一致。

当前策略为 `prefix_except_default`：中文路径不带前缀，英文路径使用 `/en`。

## 测试约定

Vitest 默认使用 `happy-dom`，测试文件匹配 `test/**/*.spec.ts`：

- 纯函数、Pinia Store、普通 composable 放在 `test/unit/`。
- 组件挂载、路由、Nitro API 等集成测试放在 `test/integration/`。
- 需要真实 Nuxt 运行时的测试，在文件顶部添加：

```ts
// @vitest-environment nuxt
```

不要为了单个 Nuxt 集成测试把全局环境改为 Nuxt，以免拖慢全部单元测试。

## 部署

完整步骤（三种形态、首次上线、更新与回滚、备份恢复、故障排查）见
[`docs/部署指南.md`](docs/部署指南.md)。下面是速查。

### GitHub Pages（当前线上部署方式）

push 到 `main` 后，`.github/workflows/ci-cd.yml` 自动跑质量门禁、执行
`pnpm generate` 并发布到 Pages：

https://letengzz.github.io/Nomi-Admin-Nuxt/

workflow 里的 `actions/configure-pages` / `deploy-pages` 会自动启用 Actions 来源；
只有首次运行报 "GitHub Pages has not been enabled" 时，才需要到仓库
`Settings > Pages > Build and deployment > Source` 手动选一次 **GitHub Actions**。
之后每次 push 自动更新，也可以在 Actions 页手动 `Run workflow`。

本地复现静态产物（Windows Git Bash 需要 `MSYS_NO_PATHCONV=1`，否则 `/xxx/`
会被当成 POSIX 路径转换成 Windows 路径，污染 baseURL）：

```bash
MSYS_NO_PATHCONV=1 \
NUXT_APP_BASE_URL=/Nomi-Admin-Nuxt/ \
NUXT_SITE_URL=https://letengzz.github.io/Nomi-Admin-Nuxt \
pnpm generate
```

产物在 `.output/public/`。`NUXT_APP_BASE_URL` 决定 HTML 里的资源前缀，
`NUXT_SITE_URL` 决定 sitemap 与 canonical 的绝对地址；两者都由 workflow 注入，
本地不设置时维持默认值，不影响开发。

**静态化的限制**：Pages 只托管静态文件，Nitro 服务端路由不会随产物发布，
因此 `/api/health` 与演示登录接口 `/api/auth/login` 在线上不可用，登录页提交会
404。页面渲染、主题切换、国际化以及 sitemap / llms.txt 等静态产物正常可用。
需要服务端接口时改用下面的 Node.js 或 Docker 部署。

### Node.js

```bash
pnpm build
node .output/server/index.mjs
```

生产环境至少配置合适的 `NITRO_HOST` 与 `NITRO_PORT`，并通过进程管理器或
容器平台保障进程常驻。

### Docker Compose（应用 + MySQL）

`compose.yaml` 自带 MySQL，一条命令起「应用 + 数据库」，库表与种子由应用首启自动写入
（日志出现 `[db] 种子数据已写入：…` 即成功）。

首次部署先把三个变量补进 `.env`（compose 会读它做变量替换，文件本身不进镜像）：

```bash
MYSQL_ROOT_PASSWORD=***   # 容器内 MySQL 的 root 密码，只有 compose 用得到
MYSQL_PASSWORD=***        # 应用连库用的 nomi 账号密码
TOKEN_SECRET=***          # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

缺任一项 `docker compose up` 会直接报错退出 —— 刻意如此，免得起了一个连不上库、
token 用开发默认密钥的容器。

```bash
docker compose up --build -d      # 应用 + MySQL + Nginx，一条命令全起
docker compose logs -f app        # 看首启建库/灌种子日志
```

默认端口：

- 对外入口：`3000`（Nginx，转发到容器网络内的 app:3000）
- Nuxt 应用：只在 compose 内网监听 `3000`，不对外暴露
- 健康检查：`/api/health`

访问 `http://<服务器IP>:3000` 即落到登录页。流量会先过 Nginx，它写入的
`X-Forwarded-For` 让应用拿到真实客户端 IP —— 登录地点、操作审计都依赖这一点；
若把 app 端口直接暴露到公网，应用只能看到 Docker 网桥 IP，会被判成「局域网」。

**上面这套是测试环境。正式环境**（域名 + HTTPS）叠加覆盖文件，由宿主机 Nginx 终止 TLS：

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

app 只绑 `127.0.0.1:3000`、容器 nginx 不启动，对外走 80/443；证书用 certbot 自动签发与续期。
配置文件 `deploy/nginx.prod.conf`，完整步骤见《部署指南》3.7 节。

数据持久化在两个命名卷上：`mysql_data`（数据库文件）、`uploads`（站点 logo、公告配图，
挂到容器内 `/app/data/uploads`）。**`docker compose down -v` 会连这两个卷一起删**，
对生产库执行前先确认。

## CI / CD 与自动部署

`.github/workflows/ci-cd.yml` 在 push 到 `main`、提交 PR 和手动触发时运行，分两个 job：

1. **ci**：`pnpm lint`、`pnpm lint:style`、`pnpm typecheck`、`pnpm test`。
   PR 只跑这一步，不发布。
2. **pages**：`actions/configure-pages` 读取站点真实 `base_path` / `base_url`
   → 注入 `NUXT_APP_BASE_URL` / `NUXT_SITE_URL` / `NUXT_PUBLIC_DEMO=1` 后执行
   `pnpm generate` → 写入 `.nojekyll`、补 SPA 兜底 → 上传产物 → `actions/deploy-pages` 发布。

### 发布出去的是演示站

Pages 上没有 Nitro，也没有 MySQL，所以构建时打开 `NUXT_PUBLIC_DEMO=1`：

- `app/utils/api.ts` 的 `callApi` 是唯一出口。演示模式下它不调 `$fetch`，
  改从 `app/mock` 取数据 —— 页面代码一行都不用改。
- `app/mock` 的数据来自 `shared/constants/seed-data.ts`，与后端首次建表的种子
  同源（同一份菜单、角色、部门、账号），演示里看到的菜单顺序与真机一致。
- 登录页任意账号 + 任意密码都能进；增删改只改内存，刷新即复原。
- `nuxt.config.ts` 的 `DEMO_PRERENDER_ROUTES` 会把后台每个页面预渲染成 HTML 壳，
  直接打开 `/<repo>/admin/system/users` 这类深链不会 404。
- 构建期不连数据库：`server/plugins/database.ts` 与 `seo-site-config.ts` 在
  演示构建下直接短路，避免 CI 上等超时、或误写生产库。

想本地复现同一份结果：`pnpm generate:demo`，然后 `npx serve .output/public`。

### 两个不能省的细节

- **`.nojekyll`**：Pages 默认用 Jekyll 处理产物，会跳过 `_nuxt/` 这类下划线开头的
  目录。缺了这个空文件，所有 JS/CSS 都会 404，页面只剩空壳。
- **`baseURL`**：项目页挂在 `/<repo>/` 子路径，HTML 里的资源路径必须带这个前缀。
  取值来自 `configure-pages` 输出而非硬编码，仓库改名或大小写不同都不会失效。

### 模板说明

初始化引擎（`scripts/`、`template.config.json`）已从仓库移除；`shared/wizard/` 与
配置文件里的 marker 区间仅作历史分区说明，不会再有程序重写它们。新增业务配置
建议写在 `nuxt.config.ts` 末尾的手写区。

## 后续业务扩展建议

登录、Token 刷新、路由守卫，用户 / 部门 / 角色 / 菜单按钮级权限与动态路由，
后台布局与多标签页、统一请求与错误处理，都已具备，细节见
[`docs/权限系统实现.md`](docs/权限系统实现.md)。可以继续补充的方向：

- 字典管理、文件上传、导入导出等通用能力。
- 会员端（前台）独立登录与权限体系。
- 部门维度的数据范围（当前部门只做归档，不参与鉴权）。
- CI 质量门禁、构建缓存、日志采集、监控与错误追踪。

## License

[MIT](./LICENSE)
