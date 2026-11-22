# 多阶段构建：只在产物镜像里留下「跑起来需要的东西」。
#
# 三个阶段的分工不能合并：
#   deps    —— 只装依赖，这一层的缓存最值钱（依赖没变就不会重装）
#   build   —— 跑 nuxt build，产物是 .output（自包含，含服务端代码与静态资源）
#   runtime —— 只拷 .output，最终镜像里没有源码、没有 node_modules、没有构建工具
#
# 最终镜像大约 200MB 上下（Node 基础镜像占大头）。把 deps/build 合并进去会到 1GB 以上，
# 而多出来的东西对运行毫无帮助，只增加攻击面。

# ---------------------------------------------------------------------------
# deps：依赖层
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# 先只拷清单文件：源码变了也不会让这一层失效。
# 一并拷工作区与 npmrc 配置：镜像里的安装行为必须与本地逐条一致，
# 否则会出现「本地装得上、镜像里 peer 依赖报错」这类只在 CI 暴露的问题。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm 场景下这条命令自带 `corepack enable` —— alpine 基础镜像不自带 pnpm。
# corepack 会挑一个当前稳定的 pnpm；要钉死版本就在 package.json 里加 packageManager 字段。
RUN corepack enable && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build：构建层
#
# 必须 FROM deps，不能另起一个 node:22-alpine 再只拷 node_modules：
# pnpm 是 corepack 在 deps 层里生成的 shim（/usr/local/bin/pnpm），
# 换个基础镜像就丢了这个 shim，`RUN pnpm build` 会直接 exit 127。
# 继承 deps 也让依赖层缓存原样复用，不必重复下载 pnpm。
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# runtime：产物层
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0

# 运行时上传目录（站点 logo、公告配图，见 server/utils/site-assets.ts）。
# 必须先建好并交给 node 用户：compose 把命名卷挂到这个路径，卷首次创建时继承镜像里
# 这个目录的属主 —— 不建的话挂载点是 root:root，以 node 运行的进程上传时直接 EACCES。
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

# 用 node 用户（镜像自带，uid 1000）而不是 root：
# 容器内进程逃逸时，非 root 能少走很多路。
USER node

COPY --from=build --chown=node:node /app/.output ./.output

EXPOSE 3000

# 打的是 /api/health 而不是首页：首页要渲染组件树，健康检查只该回答「进程还在吗」。
# 连不上、或状态码不是 200，容器就会被编排系统重启。
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
