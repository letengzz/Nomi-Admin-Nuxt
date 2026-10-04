import type { MenuItem } from '~/types/admin'

/**
 * 菜单单一来源：侧边栏、面包屑、页面标题、'/' 的重定向目标全部由它派生。
 * roles 缺省 = 所有登录用户可见。
 */
export const MENU: MenuItem[] = [
  { title: '仪表盘', path: '/dashboard', icon: 'dashboard' },
  {
    title: '系统管理',
    path: '/system',
    icon: 'settings',
    roles: ['ADMIN'],
    children: [
      { title: '用户管理', path: '/users', icon: 'user' },
      { title: '角色管理', path: '/roles', icon: 'shield' },
    ],
  },
  { title: '个人设置', path: '/profile', icon: 'account' },
]
