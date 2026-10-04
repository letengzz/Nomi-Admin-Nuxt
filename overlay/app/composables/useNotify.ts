import type { ApiRequestError } from '~/utils/api'

export type NotifyLevel = 'success' | 'error' | 'info' | 'warning'

export interface NotifyMessage {
  level: NotifyLevel
  title: string
  description?: string
}

/**
 * 逻辑层只「描述要提示什么」，不决定「怎么弹」。
 * 五档的落地方式完全不同（ElMessage 是函数式全局 API、Nuxt UI 要 useToast 且需 UApp 包裹、
 * Vuetify 得自己搭 v-snackbar），所以「怎么弹」留在视图层。
 */
export function useNotify() {
  // 注意：push 用「替换数组」而不是 push 进原数组——
  // 视图层用 watch(queue) 只有替换才会触发（浅层 watch 不看数组内部变化）
  const queue = useState<NotifyMessage[]>('notify:queue', () => [])

  function push(message: NotifyMessage): void {
    queue.value = [...queue.value, message]
  }
  function success(title: string, description?: string): void {
    push({ level: 'success', title, description })
  }
  function failure(err: unknown, fallback = '操作失败'): void {
    const e = err as Partial<ApiRequestError>
    push({
      level: 'error',
      title: e?.message ?? fallback,
      description: e?.code ? `错误码 ${e.code}` : undefined,
    })
  }
  /** 视图层取走消息并落地；取走即清空，避免同一条消息被弹两次 */
  function take(): NotifyMessage[] {
    const all = queue.value
    queue.value = []
    return all
  }

  return { queue, success, failure, take }
}
