import type { MenuItem } from '~/types/admin'
import { MENU } from '~/config/menu'

/** 按角色过滤：父项在子项全部被过滤掉时一并消失（不留空分组） */
function filterByRole(items: MenuItem[], roles: string[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const item of items) {
    if (item.roles?.length && !item.roles.some(r => roles.includes(r))) continue

    if (item.children?.length) {
      const children = filterByRole(item.children, roles)
      if (!children.length) continue             // 子项全被挡掉 → 父项也不显示
      out.push({ ...item, children })
    }
    else {
      out.push({ ...item })
    }
  }
  return out
}

/** 深度优先展开成扁平清单（含父项） */
function flatten(items: MenuItem[], acc: MenuItem[] = []): MenuItem[] {
  for (const item of items) {
    acc.push(item)
    if (item.children?.length) flatten(item.children, acc)
  }
  return acc
}

/** 从根到目标的路径，用于面包屑 */
function trail(items: MenuItem[], target: string, acc: MenuItem[] = []): MenuItem[] | null {
  for (const item of items) {
    const next = [...acc, item]
    if (item.path === target) return next
    if (item.children?.length) {
      const hit = trail(item.children, target, next)
      if (hit) return hit
    }
  }
  return null
}

export function useMenu() {
  const { user } = useAuth()
  const route = useRoute()

  const visible = computed(() => filterByRole(MENU, user.value?.roles ?? []))
  const flat = computed(() => flatten(visible.value))

  /** 当前菜单项：取「匹配到的最长 path」，避免 /users 命中 /users 与 / 两个候选 */
  const current = computed(() => {
    const hits = flat.value.filter(
      it => route.path === it.path || route.path.startsWith(`${it.path}/`),
    )
    return hits.sort((a, b) => b.path.length - a.path.length)[0] ?? null
  })

  const breadcrumb = computed(() => trail(visible.value, current.value?.path ?? '') ?? [])
  const firstPath = computed(() => flat.value[0]?.path ?? '/dashboard')

  return { visible, current, breadcrumb, firstPath }
}
