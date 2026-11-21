/**
 * 演示站构建：`pnpm generate:demo`。
 *
 * 只做一件事 —— 带上 `NUXT_PUBLIC_DEMO=1` 跑 `nuxt generate`。
 * 单独写一个脚本而不是在 package.json 里写 `NUXT_PUBLIC_DEMO=1 nuxt generate`：
 * 那是 bash 语法，Windows 的 cmd / PowerShell 下会被当成命令名的一部分，直接失败。
 * 这个仓库两边都有人在用，所以用 Node 设环境变量，跨平台不用额外装 cross-env。
 *
 * 产物在 `.output/public`，与 GitHub Pages 的发布目录一致（见 .github/workflows/ci-cd.yml）。
 */
import { spawnSync } from 'node:child_process';

const env = { ...process.env, NUXT_PUBLIC_DEMO: '1' };
// 变量名保留在 NUXT_PUBLIC_ 前缀下：nuxt.config.ts 里直接把它映射到 runtimeConfig.public.demo，
// 构建期与运行期读到的是同一个开关，不会出现「构建时开、运行时时关」的半演示状态。
const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.info('[demo] 以演示模式构建：所有 /api/** 由 app/mock 从内存应答');

const result = spawnSync(bin, ['nuxt', 'generate'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('[demo] 构建失败，退出码：', result.status);
  process.exit(result.status ?? 1);
}
