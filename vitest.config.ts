import { fileURLToPath } from 'node:url';
import { defineVitestConfig } from '@nuxt/test-utils/config';

/**
 * Vitest 配置。
 *
 * 默认环境是 happy-dom，用来跑**快**的那一类：纯函数、组合式函数、Pinia store。
 * 这类测试几百毫秒跑完，适合在保存时高频执行。
 *
 * 需要真实 Nuxt 环境（组件挂载、服务端接口、路由）的测试，在**那个文件顶部**加一行：
 *
 *   // @vitest-environment nuxt
 *
 * 它比 happy-dom 慢得多（要起 Nuxt 运行时），所以不要把它设成全局默认 ——
 * 那样每跑一次测试都要等几秒，久而久之就没人跑了。
 */
export default defineVitestConfig({
  resolve: {
    // #shared 是 Nuxt 提供的虚拟别名，只存在于 Nuxt 运行时里。
    // happy-dom 环境没有它就解析不到，而 app/utils、app/stores 会用到 shared/ 里的
    // 纯逻辑（主题键名、版本号）。补一条 alias，比让测试改用相对路径更不容易走偏。
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.spec.ts'],
    // Windows 上首次拉起 Nuxt 测试环境可能超过默认 10s；这里给到 30s。
    hookTimeout: 30_000,
    // 关闭文件级缓存：默认缓存在 node_modules/.vitest，启动时批量清理会被
    // 本地安全删除保护拦截。这里只有 1 个测试文件，关掉缓存几乎没有代价。
    cache: false,
    // dot 报告器：通过时只打点，失败时才展开 —— 高频跑测试时输出噪音最小
    reporters: 'dot',
  },
});
