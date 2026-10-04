<script setup lang="ts">
/**
 * 进度页：初始化跑起来之后（或刷新之后）停留的地方 —— 一个**独立整页**。
 *
 * 它存在的第一个理由是**刷新安全**：状态与日志在 useWizard.ts 里是模块级单例，
 * 而进度本身写在引擎的锁文件里。所以哪怕浏览器被刷新、甚至换一个标签页打开，
 * 只要服务还在，这一页都能告诉你「现在卡在哪一步」。
 *
 * 第二个理由是**它该独占一屏**。初始化要删文件、装依赖；把进度挤在选择表单下方，
 * 人会一边盯着候选按钮一边等着，而那两个东西此刻都不该被操作。所以选择页只管「选」，
 * 跑起来之后整页交给这里 —— 两边都不必再为对方让位置。
 *
 * 结构上与选择页同构：外壳固定一屏高、内容层自己滚、操作条钉在下方。
 * 进度面板（会滚）与操作条（必须一直可见，尤其「中断进度流」）因此分在两个组件里。
 */
import { useWizard } from '~/utils/wizard/useWizard';
import ProgressActions from '~/components/wizard/ProgressActions.vue';
import ProgressStream from '~/components/wizard/ProgressStream.vue';
import '~/assets/styles/wizard.css';

const wizard = useWizard();
const { state, stages } = wizard;

/**
 * 「这一页有东西可看」—— 判据依次是「本页正开着进度流」→「磁盘上有锁」→「已经初始化过」。
 *
 * 与选择页的分流判据刻意**不对称**，两边合起来才既不互相弹、也不把人挡在外面：
 *   选择页 → 这一页：locked && processAlive（确实在跑）或 initialized（已经跑完）时才送人过来；
 *   这一页 → 选择页：只要流在手、或有锁（**含「进程已退出但锁还在」的残锁**）、或已完成就留下。
 * 残锁恰恰是最需要看失败原因的状态，那时不该把人赶回选择页；而「选择页会送过来」的两种情形
 * 都蕴含「这一页会留下」，所以不会出现两页来回弹。
 *
 * `state.mode === 'stream'` 这一条不是修饰：点下确认之后是**先起流、再整页过来**，
 * 而引擎要过一会儿才写出锁文件。少了它，进度页会在这个窗口里把自己判成「没有初始化在跑」
 * 弹回选择页 —— 用户看到的是「点完按钮闪一下又回到选择页」，几秒后才被送回来。
 * 这个窗口只有把页面真跑起来才看得见：静态断言里「流」与「锁」都是应该有、也确实会有的东西。
 */
const hasRun = computed(() =>
  state.mode === 'stream' || Boolean(state.remote?.locked) || state.remote?.initialized === true);

/**
 * 初始化成功之后**自动进入后台管理系统**。
 *
 * 为什么要跳、而且是整页跳：
 *   ① 用户点的是「初始化项目」，期待的是「拿到我的工程」。停在进度页上再让他自己
 *      去地址栏敲 `/`，等于把「工程在哪」这个问题留给他 —— 而这一页连同它的路由
 *      马上就要被删掉了，此时它在地址栏里看起来像是一个错误页；
 *   ② 必须整页导航而不是 `navigateTo`：路由表刚被改过（引导器文件已删、后台页面刚写进
 *      `app/`），客户端路由里还留着旧表，只有重新走一次 HTTP 才能让 dev 重新扫描。
 *
 * 留一条手动入口（下方模板里的链接）而不是把跳转做成唯一出口：万一 dev 服务
 * 恰好在重启，自动跳过去会看到一个瞬时错误页，那时用户手上得有一个能自己按的按钮。
 */
const JUMP_DELAY_MS = 1500;
const jumping = ref(false);
const done = computed(() => state.status === 'done');
let jumpTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleJump(): void {
  if (jumping.value || !import.meta.client) return;
  jumping.value = true;
  jumpTimer = setTimeout(() => {
    // replace 而不是 assign：不要在历史里留一个「已经不存在了的进度页」
    window.location.replace('/');
  }, JUMP_DELAY_MS);
}

/** 用户不等倒计时，自己按了按钮 */
function jumpNow(): void {
  if (jumpTimer) clearTimeout(jumpTimer);
  if (import.meta.client) window.location.replace('/');
}

watch(done, (value) => {
  if (value) scheduleJump();
});

onBeforeUnmount(() => {
  if (jumpTimer) clearTimeout(jumpTimer);
});

onMounted(async () => {
  await wizard.attach();
  if (!hasRun.value) {
    await navigateTo('/setup');
    return;
  }
  // 刷新进来时初始化可能早就跑完了（状态来自磁盘），这条分支负责把「已经完成」也当成
  // 「刚完成」处理 —— 否则刷新一次就永远停在进度页，而这一页的路由其实已经没了。
  if (done.value) scheduleJump();
});

/**
 * 重试不是在这个页面重开初始化 —— 引擎失败时会**故意保留**锁，重开要先清理它。
 * 所以这里只把本地残留的错误态清掉、回到选择页（锁还在时选择页会给出 409 的说明）。
 */
function onRetry(): void {
  wizard.retry();
  void navigateTo('/setup');
}
</script>

<template>
  <!-- 与选择页共用同一层「外壳 + 滚动区」：.wizard 固定一屏高，内容在 .wizard__body 里滚，
       操作条在 .wizard__dock 里不滚。不套这层的话，.wizard 的一屏高会把内容挤出去。 -->
  <main class="wizard">
    <div class="wizard__body">
      <header class="wizard__head">
        <h1>Nuxt Shuttle · 初始化进度</h1>
        <p>
          这一页可以直接刷新：进度来自引擎写的 <code>template.init.lock</code>，
          不依赖浏览器里保留的会话。关闭标签页也不会中断引擎。
        </p>
      </header>

      <div class="wizard__full">
        <ProgressStream
          :stages="stages"
          :stage-index="state.stageIndex"
          :status="state.status"
          :mode="state.mode"
          :logs="state.logs"
          :error="state.error"
          :engine-plan="state.enginePlan"
          :remote="state.remote"
        />
      </div>

      <div class="wizard__full preview">
        <p v-if="done">
          <strong>初始化完成。</strong>
          <span v-if="jumping">正在进入后台管理系统……</span>
          <a v-else href="/">进入后台管理系统 →</a>
        </p>
        <p v-if="done">
          后台骨架已经按你选的技术栈叠加完成，守卫会把未登录的访问带到登录页
          （演示账号 <code>admin / admin123</code>）。如果自动跳转没有发生，
          点上面的链接或直接访问 <code>/</code>。
        </p>
        <p><NuxtLink to="/setup">
          ← 回到选择页
        </NuxtLink></p>
        <p class="preview__empty">
          如果初始化已经跑完，选择页连同它的路由一起被删掉了，这个链接会 404 —— 那是预期行为，
          不是出错。整页访问 <code>/</code> 才是初始化后的正确入口。
        </p>
      </div>
    </div>

    <!-- 吸附区：内容怎么滚它都不动。放在 .wizard__body 之外是关键（见 wizard.css 顶部）。 -->
    <div class="wizard__dock">
      <ProgressActions
        :status="state.status"
        :exit-code="state.exitCode"
        @detach="wizard.detach()"
        @retry="onRetry()"
        @refresh="wizard.refreshStatus()"
        @enter="jumpNow()"
      />
    </div>
  </main>
</template>
