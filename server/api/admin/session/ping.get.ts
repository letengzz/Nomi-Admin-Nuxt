/**
 * 会话心跳：只回答「这个 token 现在还认不认」。
 *
 * 用途是强制下线能**立刻**生效：被管理员强退的会话，令牌行已被删除，
 * 但只要那个人不点任何东西，前端就不会发现 —— 他停在原页面继续看，
 * 直到下一次真实请求才被弹回登录页。前端定时打这个接口，被踢的人
 * 最多一个心跳周期就会被送回登录页。
 *
 * 两个刻意的选择：
 *   · `touch: false` —— 心跳不是用户操作，不该把「最后活跃」往前推，
 *     否则在线用户页里「离开」状态永远不会出现；
 *   · 不挂权限节点 —— 任何登录用户都能问「我还活着吗」，与角色无关。
 *
 * 令牌失效时由守卫直接回 303，前端 `apiFetch` 收到后清登录态并跳登录页。
 */
import { defineAdminHandler } from '../../../utils/auth/handler';
import { nowSeconds } from '../../../utils/auth/token';

export default defineAdminHandler(
  { log: false, touch: false, bypassMaintenance: true, bypassPasswordChange: true },
  (_event, context) => ({
    userId: context.admin.id,
    serverTime: nowSeconds(),
  }),
);
