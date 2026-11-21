/**
 * 会话守卫：定时确认自己这条会话还「活着」。
 *
 * 为什么需要它：强退删的是库里的令牌行，被踢的人只要不动手就不发请求 ——
 * 他会一直停在原页面看着旧数据，看起来像「强退没生效」。这里每个周期问一次
 * 服务端「我还认不认」，令牌没了就是 303，`apiFetch` 立刻清登录态并跳登录页。
 * 于是被踢的人无论当时是「在线」还是「离开」，最多一个周期就会被送回去。
 *
 * 三个刻意的细节：
 *   · 页面在后台（`document.hidden`）时不发：定时器本来就会被浏览器节流，
 *     没必要在看不见的时候折腾服务端；回到前台立即补一次。
 *   · 心跳不刷新「最后活跃」（服务端 `touch: false`）：它不是用户操作，
 *     否则在线用户页里永远不会出现「离开」状态。
 *   · 失败一律静默：断网、超时、被踢都在 catch 里咽掉 —— 被踢的跳转由请求器
 *     统一处理，其它情况不该弹提示打断用户。
 */
import { pingSession } from '../services/session';
import { useUserStore } from '../stores/user';

/** 心跳周期。25 秒是「被发现得够快」和「请求量可忽略」之间的折中。 */
const HEARTBEAT_MS = 25_000;

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    let inflight = false;

    async function check(): Promise<void> {
      if (inflight) return;
      if (document.hidden) return;
      if (!useUserStore().isLogin) return;

      inflight = true;
      try {
        await pingSession();
      } catch {
        // 303 已由 apiFetch 跳转；409 续期失败也走同一条路。其余情况忽略。
      } finally {
        inflight = false;
      }
    }

    window.setInterval(() => void check(), HEARTBEAT_MS);

    // 后台标签页的定时器可能整段被节流掉，回到前台补一次。
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void check();
    });
    window.addEventListener('focus', () => void check());
  });
});
