/**
 * 把 URL 里的 redirect 参数净化成「一定是站内路径」。
 * 五档登录页 + 全局守卫共用这一份。
 */
export function safeRedirect(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw) return fallback
  // 必须以单个 / 开头：'//evil.com' 与 'https://evil.com' 都会被挡掉
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  // 挡住控制字符与编码后的协议形式
  if (/[\u0000-\u001f]/.test(raw)) return fallback
  return raw
}
