import type { PageResult } from '~/types/admin'
import { ApiRequestError, request, type RequestFetcher } from '~/utils/api'
import { DEFAULT_PAGE_SIZE } from '~/config/env'

export interface CrudOptions {
  url: string
  pageSize?: number
}

/**
 * 列表页状态机。视图层只负责把状态渲染出来、把事件接回来。
 * 这一层不 import 任何表格/分页组件——五档的表格长得完全不同，但状态机是同一台。
 */
export function useCrud<T extends { id: number }, F extends Record<string, unknown>>(
  options: CrudOptions,
  initialFilters: F,
) {
  const items = ref<T[]>([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(options.pageSize ?? DEFAULT_PAGE_SIZE)
  const loading = ref(false)
  const error = ref<ApiRequestError | null>(null)
  const filters = reactive({ ...initialFilters })

  // 同 useAuth：SSR 里必须用会转发入站 Cookie 的 fetch，否则首屏拿不到登录态（见 utils/api.ts）
  const fetcher = useRequestFetch() as RequestFetcher

  // 竞态守卫：只接受「最后一次发出」的请求结果
  let seq = 0

  async function load(): Promise<void> {
    const mine = ++seq
    loading.value = true
    error.value = null
    try {
      const res = await request<PageResult<T>>(options.url, {
        query: { page: page.value, size: size.value, ...filters },
        fetcher,
      })
      if (mine !== seq) return                   // 已有更新的请求在路上 → 丢弃本次
      items.value = res.items
      total.value = res.total
    }
    catch (err) {
      if (mine === seq) error.value = err as ApiRequestError
    }
    finally {
      if (mine === seq) loading.value = false
    }
  }

  function search(): Promise<void> {
    page.value = 1                               // 改条件必须回到第 1 页
    return load()
  }
  function changePage(next: number): Promise<void> {
    page.value = next
    return load()
  }
  function changeSize(next: number): Promise<void> {
    size.value = next
    page.value = 1
    return load()
  }
  function reload(): Promise<void> {
    return load()
  }

  return { items, total, page, size, loading, error, filters, load, search, changePage, changeSize, reload }
}
