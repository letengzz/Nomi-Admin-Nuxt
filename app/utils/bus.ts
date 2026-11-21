import { onScopeDispose } from 'vue';

/**
 * 全局浮层的事件总线 —— 对应 docs/主布局设计.md 第 1.9 / 5.3 节的 mittBus。
 *
 * 顶栏按钮不需要知道抽屉在哪一层：emit 一个事件，全局层的异步组件自己订阅。
 * 这样业务页面切换、内容区 KeepAlive 换组件，浮层开关状态都不受影响。
 *
 * 第 19 章点名了原实现的两处 bug：设置面板订阅后没有 off，热更新后一次点击
 * 会开多个抽屉。这里的 on() 返回注销函数，useNomiBus() 更是绑到 effect scope，
 * 组件卸载时自动清理 —— 结构上就不可能忘。
 *
 * 模块级 Map 在 SSR 进程里是共享的，但事件只在浏览器点击时触发，且订阅随
 * 组件 scope 销毁，不会跨请求泄漏。
 */
export type NomiBusEvent =
  | 'openSetting'
  | 'openSearch'
  | 'openNotification'
  | 'openChat'
  | 'openLockScreen'
  | 'closeFloating';

type Handler = () => void;

const channels = new Map<NomiBusEvent, Set<Handler>>();

export function onNomiBus(event: NomiBusEvent, handler: Handler): () => void {
  let handlers = channels.get(event);
  if (!handlers) {
    handlers = new Set();
    channels.set(event, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers?.delete(handler);
    if (handlers?.size === 0) channels.delete(event);
  };
}

export function emitNomiBus(event: NomiBusEvent): void {
  // 复制一份再遍历：handler 内部可能再次 off，边遍历边删会跳过下一个订阅者。
  for (const handler of [...(channels.get(event) ?? [])]) handler();
}

/** 组件内用这个：注册与注销成对，onUnmounted / HMR 都不留残骸。 */
export function useNomiBus(event: NomiBusEvent, handler: Handler): void {
  const off = onNomiBus(event, handler);
  onScopeDispose(off);
}
