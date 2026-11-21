/**
 * 启动收尾 —— 对应传统项目 App.vue 里 onMounted 那段「应用起来之后才该做的事」。
 *
 * 放在插件而不是页面里：它属于应用级一次性的初始化，和具体页面无关；
 * 挂在 app:mounted 上比组件 onMounted 更晚，此时首屏已经画完，做任何检查都不会
 * 拖慢首帧。
 *
 * 这里刻意只做两件成本极低的事：
 *   ① 存储可用性探测（不可用时给出明确告警，而不是让用户「设置保存不上」）
 *   ② 开发期启动横幅（版本 / 环境 / 构建时间）
 * 版本迁移（systemUpgrade）等重型初始化不放这里 —— 没有真实迁移需求时它只是
 * 一段永远不执行的死代码，等有了第一个破坏性变更再补。
 */
import { APP_VERSION, BUILD_TIME } from '../utils/version';
import { checkStorageCompatibility } from '../utils/storage';
import { purgeOutdatedStorage, STORAGE_SCHEMA_VERSION } from '../utils/storage-key';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    const support = checkStorageCompatibility();
    if (!support.local) {
      console.warn(
        '[bootstrap] localStorage 不可用：主题与登录态将无法持久化。' +
          '常见原因是隐私模式、禁用站点数据或跨域 iframe。',
      );
    }

    // 只保留当前 schema 版本的持久化键：升级后残留的旧键永远不会再被读到，
    // 留着只会占配额，而配额打满时症状是「设置改了保存不上」。
    const removed = purgeOutdatedStorage();
    if (import.meta.dev && removed.length > 0) {
      console.info(
        `[bootstrap] 已清理 ${removed.length} 个非 v${STORAGE_SCHEMA_VERSION} 的持久化键`,
        removed,
      );
    }

    if (import.meta.dev) {
      const build = BUILD_TIME ? ` · ${BUILD_TIME.slice(0, 19).replace('T', ' ')}` : '';
      console.info(
        `%c Nomi Admin %c v${APP_VERSION}${build} `,
        'background:#00c16a;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px',
        'background:#0f172a;color:#e2e8f0;border-radius:0 3px 3px 0;padding:2px 4px',
      );
    }
  });
});
