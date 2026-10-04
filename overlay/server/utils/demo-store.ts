import type { UserRow } from '~/types/admin'

/**
 * 事件对象类型。
 *
 * Nuxt/Nitro 全局注入的 `H3Event` 在 h3 v2 里是一个**类**（值），不是类型别名 ——
 * 所以要用 `InstanceType<typeof H3Event>` 取实例类型，直接写 `H3Event` 会报
 * `TS2749: 'H3Event' refers to a value, but is being used as a type here`。
 *
 * **不要**写成 `Parameters<typeof setResponseStatus>[0]`：那个函数是重载的
 * （`(event, code?, message?)` 与 `(code, message?)`），而 `Parameters<>` 取的是
 * **最后一个**重载 —— 得到的是 `number` 而不是事件。于是 `setResponseStatus(event, status)`
 * 会报 `TS2769`，且报错里两个候选重载看起来都与这行无关，排查成本极高。
 *
 * 不从 `'h3'` 直接 import 类型：pnpm 的严格布局下 h3 不在根 `node_modules` 里，
 * 那会让产物一装完就 typecheck 失败。
 */
type ServerEvent = InstanceType<typeof H3Event>

/**
 * 演示用数据源：进程内存里的账号表、令牌表与用户列表。
 * 生产环境请换成真实会话 / JWT / 数据库 —— 届时只改这一处与 server/api/auth/。
 */

interface Account {
  id: number
  username: string
  password: string
  displayName: string
  roles: string[]
}

const ACCOUNTS: Account[] = [
  { id: 1, username: 'admin', password: 'admin123', displayName: '系统管理员', roles: ['ADMIN'] },
  { id: 2, username: 'viewer', password: 'viewer123', displayName: '只读用户', roles: ['VIEWER'] },
]

/** token → accountId */
const TOKENS = new Map<string, number>()

export const SESSION_COOKIE = 'admin_session'

export function findAccount(username: string, password: string): Account | undefined {
  return ACCOUNTS.find(a => a.username === username && a.password === password)
}

export function issueToken(accountId: number): string {
  const token = crypto.randomUUID()
  TOKENS.set(token, accountId)
  return token
}

export function readToken(token: string | undefined): Account | undefined {
  if (!token) return undefined
  const id = TOKENS.get(token)
  return id === undefined ? undefined : ACCOUNTS.find(a => a.id === id)
}

export function revokeToken(token: string | undefined): void {
  if (token) TOKENS.delete(token)
}

/** 公开给视图层的用户形状（不暴露 password） */
export function toPublicAccount(account: Account) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    roles: account.roles,
  }
}

/**
 * 统一的失败出口：按约定设置 HTTP 状态码并返回 { code, message }。
 * 与 app/utils/api.ts 的 normalizeError 一一对应。
 */
export function fail(event: ServerEvent, status: number, code: number, message: string) {
  setResponseStatus(event, status)
  return { code, message }
}

// ── 用户列表（演示数据，确定性生成，便于分页验证） ──────────────────────────

const SEED_NAMES = [
  '王伟', '李娜', '张敏', '刘洋', '陈静', '杨帆', '赵磊', '黄丽',
  '周涛', '吴迪', '徐峰', '孙婷', '马超', '朱琳', '胡军', '郭鹏',
  '林霞', '何鑫', '高翔', '罗娟', '梁勇', '宋佳', '唐磊', '许诺',
]

const SEED_ROLES = ['ADMIN', 'EDITOR', 'VIEWER'] as const

const DAY = 86_400_000
const SEED_BASE = Date.UTC(2026, 0, 2, 1, 30)

function seedUsers(): UserRow[] {
  return SEED_NAMES.map((displayName, i) => ({
    id: i + 1,
    username: `user${String(i + 1).padStart(3, '0')}`,
    displayName,
    role: SEED_ROLES[i % SEED_ROLES.length]!,
    // 确定性时间戳：同一份数据每次启动都一样，分页与排序才好核对
    createdAt: new Date(SEED_BASE + i * 3 * DAY)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' '),
  }))
}

export const USERS: UserRow[] = seedUsers()

/** 自增主键：新增用户时用，避免与种子数据撞 id */
let nextUserId = USERS.length + 1

export function insertUser(input: { username: string; displayName: string }): UserRow {
  const row: UserRow = {
    id: nextUserId++,
    username: input.username,
    displayName: input.displayName,
    role: 'VIEWER',
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  }
  USERS.unshift(row) // 新记录排在最前，正好验证「新增后回到第 1 页能看到」
  return row
}

export function usernameTaken(username: string): boolean {
  return USERS.some(u => u.username.toLowerCase() === username.toLowerCase())
}
