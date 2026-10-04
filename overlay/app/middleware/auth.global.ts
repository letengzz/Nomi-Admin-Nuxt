import { safeRedirect } from '~/utils/navigation'

export default defineNuxtRouteMiddleware(async (to) => {
  const { isLoggedIn, resolve } = useAuth()

  // ① 先拿结论，再判定。
  //    useState 在 SSR 与客户端之间共享，但首屏直链刷新时它还是空的：
  //    不先 resolve 就判定，已登录用户会被判成未登录、踢到登录页。
  if (!isLoggedIn.value) await resolve()

  // ② 放行名单：登录页永远放行。这一条必须写在「要求登录」之前。
  if (to.path === '/login') {
    // 已经登录还手敲 /login：送回来源页（默认首页）
    return isLoggedIn.value ? navigateTo(safeRedirect(to.query.redirect)) : undefined
  }

  // ③ 其余路由一律要求登录，并把「原本想去哪」带上
  if (!isLoggedIn.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
