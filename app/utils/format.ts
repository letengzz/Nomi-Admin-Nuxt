/**
 * 时间格式化小工具。
 *
 * 服务端统一用 unix 秒（bigint 字段），前端只在展示层转成本地时间 ——
 * 传 Date 对象进去会让「时区」变成一个跨层问题，而它本来只是展示问题。
 */
const pad = (value: number): string => String(value).padStart(2, '0');

export function formatDateTime(seconds: number | undefined | null): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDate(seconds: number | undefined | null): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 手机号脱敏：`18812345678` → `188****5678`。
 *
 * 个人中心是「给自己看」的页面，但把完整号码印在屏幕上没有收益 ——
 * 截图、投屏、旁人一瞥都会把它带出去。位数不足时原样返回，别硬凑出
 * 一个看起来像号码的字符串。
 */
export function maskMobile(mobile: string | undefined | null): string {
  const value = (mobile ?? '').trim();
  if (!value) return '';
  if (value.length <= 7) return value.replace(/\d/g, '*');
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

/**
 * 邮箱脱敏：`chen@126.com` → `c*******@126.com`。
 *
 * 只留首字母与域名：域名是「你用哪家邮箱」的线索，改密码时有用；
 * 本地部分才是身份标识，遮掉它。
 */
export function maskEmail(email: string | undefined | null): string {
  const value = (email ?? '').trim();
  if (!value) return '';
  const at = value.lastIndexOf('@');
  if (at <= 0) return value.replace(/[^@]/g, '*');
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const stars = Math.min(Math.max(local.length - 1, 4), 8);
  return `${local[0]}${'*'.repeat(stars)}${domain}`;
}

