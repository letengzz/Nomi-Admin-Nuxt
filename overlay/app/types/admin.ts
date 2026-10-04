/** 菜单项：与 UI 框架无关的纯数据。icon 存「图标名字符串」，由视图层翻译成组件 */
export interface MenuItem {
  title: string
  path: string
  icon?: string
  roles?: string[]
  children?: MenuItem[]
}

export interface AdminUser {
  id: number
  username: string
  displayName: string
  roles: string[]
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface UserRow {
  id: number
  username: string
  displayName: string
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  createdAt: string
}

/** 服务端约定的业务错误码：与 HTTP 状态码正交 */
export const ERROR_CODES = {
  UNAUTHORIZED: 1001,
  BAD_CREDENTIALS: 1002,
  ACCOUNT_LOCKED: 1003,
  FORBIDDEN: 1004,
  NOT_FOUND: 2001,
  DUPLICATE: 2002,
  VALIDATION: 3001,
  INTERNAL: 9001,
} as const

/** 服务端失败时的统一响应体 */
export interface ApiErrorBody {
  code: number
  message: string
}
