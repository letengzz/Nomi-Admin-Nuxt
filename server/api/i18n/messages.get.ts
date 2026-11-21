/**
 * 前端运行时译文（免登录）。
 *
 * 只返回「启用语言 + 非空译文」，客户端用 mergeLocaleMessage 深度合并：
 * 数据库里没有的 key 继续用项目内置的 zh/en.json，不会出现裸露的 key。
 * 登录页也要显示多语言，所以这个接口不能要求登录态。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { getRuntimeMessages } from '../../utils/auth/language-service';

export default definePublicHandler(async () => ({
  messages: await getRuntimeMessages(),
}));
