/**
 * 发送重置密码验证码。
 *
 * ## 这次修复了什么
 *
 * 旧版为了「演示闭环」，把验证码直接放进响应（`data.devCode`），而且不校验投递通道。
 * 结果是：任何能访问 `/api/auth/password-code` 的人，对**任意账号名**请求一次，
 * 就能拿到该账号的重置码，再调 `/api/auth/password-reset` 把密码改掉 —— 完整的接管链路，
 * 连邮箱都不需要。这已经不是「演示便利」，而是一个 CVSS 9.8 的认证绕过。
 *
 * 现在的规则：
 *
 *   1. **验证码只经由投递通道离开服务端**。响应体里永远没有 `code` 字段，
 *      没有 dev 分支、没有开关 —— 这种口子一旦存在，迟早会在生产配置下被打开。
 *   2. **投递目标是库里已绑定的邮箱**，不接受请求体里的地址。否则这个接口就成了
 *      「向任意邮箱发任意内容」的垃圾邮件发射器。
 *      账号字段既接受登录名、也接受绑定邮箱（`findAdminByAccount`）：只认登录名时，
 *      填邮箱的用户会拿到「已发送」却永远收不到信 —— 防枚举把一次错误变成了静默失败。
 *   3. **没有配置 SMTP 时直接关闭自助找回**（返回 503，提示联系管理员重置）。
 *      这比「发不出去但仍回成功」诚实，也比「回退到把码显示在页面上」安全。
 *      开发环境例外：码打到服务端控制台，本地开发仍能跑完闭环，但它永远不出网络。
 *   4. **账号类错误给出明确提示**（产品要求）：登录名不存在 → 404；邮箱没绑用户 → 441；
 *      账号没绑邮箱 → 440。防枚举在这里让位于「别让用户对着假的成功提示干等」，
 *      代价由按 IP 限流（第 5 条）和统一验证码策略承担。已停用 / 冷却期内仍回成功，
 *      避免泄露「这个账号刚发过码」「这个账号被停用了」。
 *   5. **按 IP 限流**：同账号 60 秒冷却只能防轰炸，防不住「换账号名各发一次」，
 *      所以再加一层来源 IP 的窗口限制。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { findAdminByAccount } from '../../utils/auth/session';
import { BusinessCode, fail, ok } from '../../utils/http';
import { isMailConfigured, MailError, sendMail } from '../../utils/mail';
import { renderResetCodeMail } from '../../utils/mail-template';
import { consumeRateLimit } from '../../utils/rate-limit';
import { clientIpOf } from '../../utils/request-ip';
import {
  discardResetCode,
  getResendCooldownLeft,
  issueResetCode,
  RESET_CODE_COOLDOWN_MS,
  RESET_CODE_TTL_MS,
} from '../../utils/reset-codes';
import { loadSystemConfig } from '../../utils/system-config';

// 服务端独立复核，不信任前端校验。数值与 app/utils/forget-password.ts 保持一致，
// 由 test/forget-password.spec.ts 断言同步。
const ACCOUNT_MIN = 3;
/** 上限跟 `user.email` 的 varchar(100) 对齐：找回密码允许填邮箱，比登录名长得多。 */
const ACCOUNT_MAX = 100;

/** 登录名口径（与注册页一致）或邮箱口径，二者取一。 */
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** 邮箱只留首字符 + 域名，进日志时够定位、又不至于把用户联系方式写满磁盘。 */
function maskRecipient(address: string): string {
  const at = address.indexOf('@');
  if (at <= 0) return '***';
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** 同一 IP 的发送频率：10 分钟 5 次。够正常用户重试两三次，不够拿去做轰炸。 */
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;

export default definePublicHandler(async (event) => {
  const body = await readBody<{ account?: unknown }>(event);
  const account = typeof body?.account === 'string' ? body.account.trim() : '';

  const malformed =
    account.length < ACCOUNT_MIN ||
    account.length > ACCOUNT_MAX ||
    !(USERNAME_PATTERN.test(account) || EMAIL_PATTERN.test(account));
  if (malformed) {
    return fail('请输入正确的用户名或邮箱', 422);
  }

  const gate = consumeRateLimit(`reset-code:${clientIpOf(event)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!gate.allowed) {
    return fail(`请求过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试`, 429);
  }

  const config = await loadSystemConfig();
  const mailReady = isMailConfigured(config.email);

  // 没有投递通道就不能开这个口子：否则「发不出去的码」只有两种结局 ——
  // 要么显示在页面上（=漏洞），要么永远没人能重置（=骗用户）。
  // 这个判断只跟站点配置有关，与账号是否存在无关，不构成枚举信号。
  if (!mailReady && !import.meta.dev) {
    return fail('当前未配置邮件服务，无法自助找回密码，请联系管理员重置', 503);
  }

  // 三种分支共用一个响应体：有效期、冷却、投递方式。
  // 注意没有 `code` 字段，将来也不许加。
  const receipt = {
    expiresIn: Math.floor(RESET_CODE_TTL_MS / 1000),
    cooldown: Math.floor(RESET_CODE_COOLDOWN_MS / 1000),
    delivery: mailReady ? ('email' as const) : ('console' as const),
  };

  // 不吞数据库错误：吞了会把「库连不上」误报成「账号不存在」，用户按提示改账号永远改不对。
  const user = await findAdminByAccount(account);
  const isEmailInput = EMAIL_PATTERN.test(account);

  // 输入的是邮箱却查不到人 → 邮箱没绑用户；输入的是登录名却查不到人 → 账号不存在。
  // 两种情况都直接告诉用户，别让他对着「已发送」等一封永远不会来的信。
  if (!user) {
    console.info(
      `[password-reset] 未投递（${isEmailInput ? '邮箱未绑定用户' : '账号不存在'}）：${account}`,
    );
    return fail(
      isEmailInput ? '该邮箱未绑定用户，请检查后重试' : '该账号不存在，请检查后重试',
      isEmailInput ? BusinessCode.EMAIL_NOT_FOUND : BusinessCode.ACCOUNT_NOT_FOUND,
    );
  }

  // 账号存在但没绑邮箱：验证码根本没有投递目标，必须明说。
  if (!user.email) {
    console.info(`[password-reset] 未投递（账号未绑定邮箱）：${account}`);
    return fail('该账号未绑定邮箱，无法发送验证码，请联系管理员', BusinessCode.EMAIL_NOT_BOUND);
  }

  // 账号停用仍回成功：这条只说明「当前不能登录」，与「收不收得到信」无关，
  // 露出它会让接口变成账号状态查询器。留日志给管理员排查。
  if (user.status !== 'enable') {
    console.info(`[password-reset] 未投递（账号已停用）：${account}`);
    return ok(receipt);
  }

  // 冷却期内不重发、也不报错：上一枚码仍然有效（TTL 5 分钟 > 冷却 60 秒），
  // 报 429 反而等于承认「这个账号刚发过验证码」。
  if (getResendCooldownLeft(account) > 0) {
    console.info(`[password-reset] 未投递（冷却期内）：${account}`);
    return ok(receipt);
  }

  const issued = issueResetCode(account);

  // 故意不 await：await 会让「存在的账号」比「不存在的账号」慢几百毫秒到几秒，
  // 那是一个比报错更好用的枚举信号。这里交给后台完成，响应耗时与账号无关。
  if (mailReady) {
    // 站点名 / logo 取后台配置：改个站名，邮件抬头跟着变，不用回来改代码。
    const mail = renderResetCodeMail({
      brand: { name: config.site.name, logo: config.site.logo },
      recipient: user.nickname || user.username,
      account: user.username,
      code: issued.code,
      minutes: Math.floor(RESET_CODE_TTL_MS / 60_000),
    });

    void sendMail(config.email, { to: user.email, ...mail })
      .then(() => {
        console.info(
          `[password-reset] 已投递：${account} → ${maskRecipient(user.email)}（SMTP ${config.email.host}:${config.email.port}）`,
        );
      })
      .catch((error: unknown) => {
        // 没送达的码不留在表里：否则用户收不到邮件，表里却挂着一个能用的码。
        discardResetCode(account);
        console.error(
          '[password-reset] 验证码投递失败：',
          error instanceof MailError ? error.message : error,
        );
      });
  } else {
    // 仅开发环境走到这里。打在服务端控制台，绝不回到 HTTP 响应 ——
    // 「方便调试」正是旧版把 devCode 塞进响应的理由，也是这次漏洞的成因。
    console.info(`[password-reset] ${account} 的验证码：${issued.code}（仅开发环境输出）`);
  }

  return ok(receipt);
});
