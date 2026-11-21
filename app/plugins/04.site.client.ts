/**
 * 站点配置的**增量**同步。
 *
 * 首屏那份已经由 app.vue 的 useAsyncData 在服务端取到并写进 payload（SEO 标签
 * 必须如此，爬虫不执行 JS），所以这里不再重复拉一次 —— 之前 onNuxtReady 里那次
 * load() 会多打一个完全相同的接口。
 *
 * 只保留两件事：
 *   ① 后台改完系统配置派发 nomi:site-updated 时重拉（品牌/环境/SEO 立刻生效）；
 *   ② 开发期热更新后状态可能过期，同样走这个事件。
 */
export default defineNuxtPlugin(() => {
  const site = useSiteStore();
  window.addEventListener('nomi:site-updated', () => void site.load());
});
