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
│  ├─ nginx.conf                     # Nginx 反向代理、缓存与流式响应配置
│  ├─ compose.prod.yaml              # 服务器部署编排（拉 GHCR 镜像，不在服务器构建）
│  └─ remote-deploy.sh               # 服务器上执行的滚动更新与健康检查脚本
├─ .github/
│  └─ workflows/ci-cd.yml            # CI 门禁 + GHCR 镜像 + SSH 自动部署
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

### 静态站点

仅当业务不依赖 Nitro 服务端能力时使用：

```bash
pnpm generate
```

将 `.output/public/` 发布到静态托管平台即可。静态产物不包含
`server/api/health` 等服务端接口。

## CI / CD 与自动部署

`.github/workflows/ci-cd.yml` 在 push 到 `main`、提交 PR 和手动触发时运行，分三个 job：

1. **ci**：`pnpm lint`、`pnpm lint:style`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
   PR 只跑这一步，不构建镜像、不部署。
2. **image**：CI 通过后用多阶段 `Dockerfile` 构建镜像，推送到
   `ghcr.io/<owner>/<repo>`，同时打 `latest`、分支名和 `sha-<短 commit>` 三个 tag。
3. **deploy**：SSH 到服务器，同步 `deploy/compose.prod.yaml` 与 `deploy/nginx.conf`，
   拉取本次 commit 对应的精确镜像并 `docker compose up -d app`，随后轮询
   `/api/health`；失败时打印容器日志并让 workflow 失败。

### 服务器准备

只需要 Docker 与 Docker Compose 插件，不需要 Node、pnpm 或项目源码：

```bash
mkdir -p /opt/nomi-admin
# 私有 GHCR 包：用有 read:packages 权限的 PAT 登录一次（也可把包可见性改为 public）
echo '<PAT>' | docker login ghcr.io -u '<GitHub 用户名>' --password-stdin
```

若把 PAT 配成 `GHCR_READ_TOKEN` secret，workflow 每次部署会自动登录，上面这步可省略。

### 需要的 Secrets

在仓库 `Settings > Secrets and variables > Actions` 中添加：

| Secret               | 说明                                        | 必填 |
| -------------------- | ------------------------------------------- | ---- |
| `SERVER_HOST`        | 服务器 IP 或域名                            | 是   |
| `SERVER_USER`        | SSH 用户名                                  | 是   |
| `SERVER_SSH_KEY`     | SSH 私钥全文（含 BEGIN / END 行）           | 是   |
| `DEPLOY_PATH`        | 部署目录，如 `/opt/nomi-admin`              | 是   |
| `SERVER_PORT`        | SSH 端口，默认 22                           | 否   |
| `SERVER_KNOWN_HOSTS` | `ssh-keyscan -H -p 22 <host>` 输出，防 MITM | 否   |
| `APP_PORT`           | 应用对外端口，默认 3000                     | 否   |
| `GHCR_READ_TOKEN`    | 有 `read:packages` 权限的 PAT               | 否   |

未配置必填项时，CI 与镜像构建照常成功，deploy 只打一条 warning 并跳过；补齐后
重新运行 workflow 即可生效，无需改动代码。

需要 Nginx 反向代理时，在服务器上手动启用一次（自动部署默认不带代理，避免占用
8080 或与已有 Web 服务冲突）：

```bash
cd /opt/nomi-admin
docker compose -f compose.yaml --profile proxy up -d
```

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
