/**
 * 登录页的公开配置：只需要「是否启用验证码」。
 *
 * 免登录接口，所以不能把站点安全策略、SMTP 账号这些一起吐出去；
 * 登录页拿不到时按「启用」处理，避免配置接口挂了就把验证绕过。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { loadLoginConfig } from '../../utils/system-config';

export default definePublicHandler(async () => {
  return await loadLoginConfig();
});
