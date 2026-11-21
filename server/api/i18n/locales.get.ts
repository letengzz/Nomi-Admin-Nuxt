/**
 * 前端可切换语言清单（免登录）。
 *
 * 数据源就是「语言管理」里启用的语言：新增/启用/停用/删除语言后，
 * 右上角切换器下一次拉取就是新的清单，不需要重新构建前端。
 * 登录页也要显示多语言，所以这个接口不能要求登录态。
 */
import { definePublicHandler } from '../../utils/auth/handler';
import { listEnabledLanguages } from '../../utils/auth/language-service';

export default definePublicHandler(async () => listEnabledLanguages());
