/**
 * 校验验证码并重置密码。
 *
 * ## 与旧版的三个关键差异
 *
 * 1. **不再返回 `404 该账号不存在`**。旧版先查账号、查不到就 404，等于给了一个
 *    「这个账号存在吗」的免费查询接口 —— 配合注册接口的 409，整个用户名录可以被扫出来。
 *    现在先消耗验证码、再查账号：账号不存在时永远只会看到「验证码不存在或已失效」。
 *
 * 2. **新密码走强策略**（`checkPasswordStrength`：≥10 位、四类字符取三、不含账号名）。
 *    旧版只要求 6 位，于是「找回密码」成了绕过登录页强口令的唯一后门：
 *    把管理员密码重置成 `123456` 照样能登录。
 *
 * 3. **按 IP 限流**。验证码 6 位、5 次上限是「同一枚码」的约束，但攻击者可以不断
 *    重新申请新码来重置额度，所以入口这一层必须再挡一道。
 *
 * 密码改完立刻清掉该账号的全部登录态：改密的语义是「把别人踢下线」，
 * 只改哈希的话，已经拿到 token 的人还能继续用。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { checkPasswordStrength, hashPassword } from '../../utils/auth/password';
import { findAdminByAccount } from '../../utils/auth/session';
import { nowSeconds } from '../../utils/auth/token';
import { getPool } from '../../database/pool';
import { fail, ok } from '../../utils/http';
import { consumeRateLimit } from '../../utils/rate-limit';
import { clientIpOf } from '../../utils/request-ip';
import { consumeResetCode, RESET_CODE_LENGTH } from '../../utils/reset-codes';

/** 同一 IP 的提交频率：10 分钟 10 次。正常用户最多失败两三次。 */
const IP_LIMIT = 10;
const IP_WINDOW_MS = 10 * 60 * 1000;

/**
 * 验证码校验失败时**唯一**的提示文案。
 *
 * 四种失败（没发过 / 过期 / 不对 / 试错超限）共用一句，是刻意的：
 *   · 如果「没发过」和「不对」用不同的话，攻击者先申请一次验证码、再随便填一个，
 *     就能从回执里读出「这个账号刚才有没有拿到验证码记录」—— 那是一个账号枚举器。
 *   · 对真实用户来说，四种情况的处置动作完全一样：重新获取验证码。
 *     区分它们只是让界面好看一点，代价是泄露账号是否存在。
 */
const CODE_REJECTED = '验证码不正确或已失效，请重新获取';

export default definePublicHandler(async (event) => {
  const body = await readBody<{
    account?: unknown;
    code?: unknown;
    newPassword?: unknown;
  }>(event);

  const account = typeof body?.account === 'string' ? body.account.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!account) return fail('请输入账号', 422);
  if (!new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`).test(code)) {
    return fail(`验证码为 ${RESET_CODE_LENGTH} 位数字`, 422);
  }

  const gate = consumeRateLimit(`reset-submit:${clientIpOf(event)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!gate.allowed) {
    return fail(`请求过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试`, 429);
  }

  // 与「个人中心改密」用同一套策略，不因为入口不同就放宽 ——
  // 找回密码恰恰是攻击者最想用的那条路径。
  const weak = checkPasswordStrength(newPassword, { username: account });
  if (weak) return fail(`新密码不符合要求：${weak}`, 422);

  // 先消耗再查账号：顺序反过来的话，账号是否存在会通过「404 vs 验证码错误」泄露。
  const status = consumeResetCode(account, code);
  if (status !== 'ok') return fail(CODE_REJECTED, 422);

  const admin = await findAdminByAccount(account).catch(() => undefined);
  // 理论上不可能：没有账号就不会有验证码记录。兜底仍然回同一句话。
  if (!admin) return fail(CODE_REJECTED, 422);

  // 上面那次用输入值做「不能包含账号名」的判断；这里用真正的登录名复核一次 ——
  // 用户可能是拿邮箱走进来的，那时 `account` 里没有登录名可比。
  const weakForUser = checkPasswordStrength(newPassword, { username: admin.username });
  if (weakForUser) return fail(`新密码不符合要求：${weakForUser}`, 422);

  const pool = getPool();
  await pool.query(
    'UPDATE `user` SET `password` = ?, `salt` = \'\', `login_failure` = 0, `must_change_password` = 0, `update_time` = ? WHERE `id` = ?',
    [await hashPassword(newPassword), nowSeconds(), admin.id],
  );

  // 旧版只删 admin/admin_refresh 两类；这里保持同一口径（与 resetUserPassword 一致）。
  await pool.query('DELETE FROM `token` WHERE `user_id` = ? AND `type` IN (?,?)', [
    admin.id,
    'admin',
    'admin_refresh',
  ]);

  return ok({ userName: admin.username });
});
