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
│  └─ nginx.conf                     # Nginx 反向代理、缓存与流式响应配置
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

### Docker Compose

仅启动 Nuxt 应用：

```bash
docker compose up --build -d
```

同时启动 Nginx 反向代理：

```bash
docker compose --profile proxy up --build -d
```

默认端口：

- Nuxt 应用：`3000`
- Nginx 代理：`8080`
- 健康检查：`/api/health`

## CI / CD 与自动部署

`.github/workflows/ci-cd.yml` 在 push 到 `main`、提交 PR 和手动触发时运行，分两个 job：

1. **ci**：`pnpm lint`、`pnpm lint:style`、`pnpm typecheck`、`pnpm test`。
   PR 只跑这一步，不发布。
2. **pages**：`actions/configure-pages` 读取站点真实 `base_path` / `base_url`
   → 注入 `NUXT_APP_BASE_URL` / `NUXT_SITE_URL` 后执行 `pnpm generate`
   → 写入 `.nojekyll` → 上传产物 → `actions/deploy-pages` 发布。

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

在实现完整后台时，可基于现有目录逐步补充：

- 登录、退出、Token 刷新和路由认证守卫。
- 用户、角色、菜单、按钮级权限与动态路由。
- 后台布局、侧边栏、面包屑、多标签页和主题设置。
- 统一请求错误处理、消息提示、加载状态与异常页面。
- 字典管理、表格分页、表单校验和文件上传等通用能力。
- CI 质量门禁、构建缓存、日志、监控与错误追踪。

以上属于后续实现方向，不应被理解为当前模板已经提供的功能。

## License

[MIT](./LICENSE)
