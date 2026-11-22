/**
 * 邮件配置自检：用**已保存**的配置发一封测试邮件。
 *
 * 为什么需要它：找回密码失败时用户只会看到「已发送」，运维拿不到任何信号 ——
 * 究竟是 SMTP 拒绝、授权码过期，还是账号根本没绑邮箱？让管理员点一下按钮，
 * 就把「配置问题」和「账号问题」区分开了。
 *
 * 刻意**不接受**请求体里传 host / port / 账号密码：那等于给管理员一个
 * 「用任意服务器发任意邮件」的代理，既能把内网当成探测目标（SSRF），
 * 也能拿来当发信跳板。要测新配置，先保存再点。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { ApiError } from '../../../utils/http';
import { isMailConfigured, MailError, sendMail } from '../../../utils/mail';
import { renderTestMail } from '../../../utils/mail-template';
import { consumeRateLimit } from '../../../utils/rate-limit';
import { loadSystemConfig } from '../../../utils/system-config';

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** 同一管理员 5 分钟内最多 5 封：自检按钮不该变成发信器。 */
const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 5 * 60 * 1000;

export default defineAdminHandler(
  { node: 'system/settings/edit', log: '邮件配置自检' },
  async (event, context) => {
    const body = await readBody<{ to?: unknown }>(event);
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    if (!EMAIL_PATTERN.test(to)) throw new ApiError('收件地址格式不正确');

    const gate = consumeRateLimit(`mail-test:${context.admin.id}`, TEST_LIMIT, TEST_WINDOW_MS);
    if (!gate.allowed) {
      throw new ApiError(`操作过于频繁，请 ${Math.ceil(gate.retryAfterMs / 1000)} 秒后再试`, 429);
    }

    const config = await loadSystemConfig();
    if (!isMailConfigured(config.email)) {
      throw new ApiError('邮件服务未启用或配置不完整（发件邮箱、服务器、端口都必填）');
    }

    try {
      const mail = renderTestMail({
        brand: { name: config.site.name, logo: config.site.logo },
        host: config.email.host,
        port: config.email.port,
        encryption: config.email.encryption,
        fromAddress: config.email.fromAddress,
      });
      await sendMail(config.email, { to, ...mail });
    } catch (error) {
      const message = error instanceof MailError ? error.message : String(error);
      // 服务端留痕：状态码（如 535 认证失败）是排查的关键，前端只需看到结论。
      console.error(`[mail-test] ${context.admin.username} 自检失败：`, message);
      throw new ApiError(`发送失败：${message}`);
    }

    console.info(`[mail-test] ${context.admin.username} 自检成功 → ${to}`);
    return { to };
  },
);
