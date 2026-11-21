/**
 * 校验验证码并重置密码。
 *
 * 顺序仍然是「先查账号 → 再消耗验证码 → 最后写密码」：任何一步失败都不能让
 * 验证码被白白消耗掉（consumeResetCode 内部只在成功时才删除记录）。
 *
 * 与旧版的区别：密码写进 `user` 表的 scrypt 哈希，并**清掉该账号的所有 token** ——
 * 改密码的语义是「把别人踢下线」，只改哈希等于旧会话还能继续用。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { ApiError } from '../../utils/http';
import { consumeResetCode, RESET_CODE_LENGTH, type ResetCodeStatus } from '../../utils/reset-codes';
import { findAdminByUsername } from '../../utils/auth/session';
import { hashPassword } from '../../utils/auth/password';
import { getPool } from '../../database/pool';
import { hasUser, updatePassword } from '../../utils/registered-users';

// 与 app/utils/forget-password.ts 对齐，由 test/forget-password.spec.ts 断言。
const PASSWORD_MIN = 6;

/** 验证码状态 → 用户能看懂的提示。故意不区分「账号是否存在」，减少枚举面。 */
const CODE_ERROR: Record<Exclude<ResetCodeStatus, 'ok'>, string> = {
  missing: '验证码不存在或已失效，请重新获取',
  expired: '验证码已过期，请重新获取',
  mismatch: '验证码不正确',
  locked: '错误次数过多，验证码已作废，请重新获取',
};

export default definePublicHandler(async (event) => {
  const body = await readBody<{
    account?: unknown;
    code?: unknown;
    newPassword?: unknown;
  }>(event);

  const account = typeof body?.account === 'string' ? body.account.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!account) throw new ApiError('请输入账号');
  if (!new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`).test(code)) throw new ApiError('验证码为 6 位数字');
  if (newPassword.length < PASSWORD_MIN) throw new ApiError(`密码不能少于 ${PASSWORD_MIN} 位`);

  // 数据库是主来源；内存表只作为「MySQL 没起时演示流程仍可跑」的兜底。
  const admin = await findAdminByUsername(account).catch(() => undefined);
  if (!admin && !hasUser(account)) throw new ApiError('该账号不存在', 404);

  const status = consumeResetCode(account, code);
  if (status !== 'ok') throw new ApiError(CODE_ERROR[status]);

  if (admin) {
    const password = await hashPassword(newPassword);
    const pool = getPool();
    const ts = Math.floor(Date.now() / 1000);
    await pool.query('UPDATE `user` SET `password` = ?, `salt` = \'\', `login_failure` = 0, `update_time` = ? WHERE `id` = ?', [
      password,
      ts,
      admin.id,
    ]);
    await pool.query('DELETE FROM `token` WHERE `user_id` = ? AND `type` IN (?,?)', [
      admin.id,
      'admin',
      'admin_refresh',
    ]);
    // 兜底：如果这个账号同时存在于内存演示表里，也一并同步，避免两套密码不一致。
    if (hasUser(account)) updatePassword(account, newPassword);
  } else {
    updatePassword(account, newPassword);
  }

  return { code: 200, msg: 'ok', data: { userName: account } };
});
