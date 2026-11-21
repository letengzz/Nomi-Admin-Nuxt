import {
  getResendCooldownLeft,
  issueResetCode,
  RESET_CODE_COOLDOWN_MS,
  RESET_CODE_TTL_MS,
} from '../../utils/reset-codes';

// 服务端独立复核，不信任前端校验。数值与 app/utils/forget-password.ts 保持一致，
// 由 test/forget-password.spec.ts 断言同步。
const ACCOUNT_MIN = 3;
const ACCOUNT_MAX = 20;

/**
 * 发送重置密码验证码。
 *
 * 演示环境没有邮件 / 短信网关，所以把验证码放在响应里（仅 dev 下返回 devCode），
 * 前端会在验证码输入框下方提示出来，保证「拿得到码 → 改得了密码」的闭环可跑。
 * 生产环境必须删掉 devCode 分支，改为调用邮件服务，并且**无论账号是否存在都返回 200**，
 * 否则接口会变成账号枚举器。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ account?: unknown }>(event);
  const account = typeof body?.account === 'string' ? body.account.trim() : '';

  const reject = (statusCode: number, msg: string): never => {
    throw createError({ statusCode, message: msg, data: { code: statusCode, msg } });
  };

  if (account.length < ACCOUNT_MIN || account.length > ACCOUNT_MAX) {
    reject(422, '账号格式不正确');
  }

  // 节流：前端有 60s 倒计时，这一层挡的是多标签页 / 直接打接口的情况。
  const left = getResendCooldownLeft(account);
  if (left > 0) reject(429, `请求过于频繁，请 ${Math.ceil(left / 1000)} 秒后再试`);

  const state = issueResetCode(account);

  return {
    code: 200,
    msg: 'ok',
    data: {
      expiresIn: Math.floor(RESET_CODE_TTL_MS / 1000),
      cooldown: Math.floor(RESET_CODE_COOLDOWN_MS / 1000),
      // 只在开发环境回传，构建产物里连这个分支都会被摇掉。
      devCode: import.meta.dev ? state.code : undefined,
    },
  };
});
