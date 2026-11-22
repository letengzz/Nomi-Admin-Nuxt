/**
 * 后台初始化接口：登录后的第一件事。
 *
 * 一次返回三样东西，它们**同源**（都来自同一份 `permission_rule` 授权结果）：
 *   · menus     → 侧边栏 + 面包屑 + 可达页面
 *   · authNode  → 路由 path → 该页可用动作（按钮显隐）
 *   · authNames → 有权节点名清单（`can('system/role/add')`）
 *
 * 对应文档 8.3「后台初始化：登录检查与菜单拉取」。
 *
 * 与文档的一处有意偏离：文档要求 `permission_rule.name === permission_rule.path`，
 * 因为它的 authNode 用规则名做 key，而前端拿路由 path 去查。这里由服务端
 * 直接输出「path → 动作名」，把那条隐式约定变成显式契约 —— 页面挂在
 * `/admin/system/permissions`、节点叫 `system/role` 也能正常工作。
 */
import { defineAdminHandler } from '../../utils/auth/handler';
import { buildAuthNode, buildMenuTree } from '../../utils/auth/rbac';
import { toProfile } from '../../utils/auth/session';

// 维护模式下也必须先拿到权限数据：前端要靠 isSuper 判断该放行超管还是跳维护页。
// 同理，「还没改初始密码」时也要放行 —— 改密页本身挂在后台布局里，没有菜单就渲染不出来。
export default defineAdminHandler(
  { log: false, bypassMaintenance: true, bypassPasswordChange: true },
  async (_event, context) => {
    const { admin, rules, isSuper, roles, ruleIds } = context;

    const byName = buildAuthNode(rules);
    const authNode: Record<string, string[]> = {};
    for (const rule of rules) {
      if (rule.type === 'button' || !rule.path || rule.path.startsWith('#')) continue;
      const prefix = `${rule.name.toLowerCase()}/`;
      authNode[rule.path] = (byName[rule.name.toLowerCase()] ?? []).map((name) =>
        name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name,
      );
    }

    return {
      adminInfo: {
        ...toProfile(admin),
        super: isSuper,
        /** 数据范围只由服务端判定；这里下发的 departmentId 仅供 UI 提示 */
        departmentId: Number(admin.department_id ?? 0),
        // 规则 id 给前端做「授权树裁剪」，不是安全边界
        rules: ruleIds,
        roles: roles.map((role) => ({ id: role.id, name: role.name })),
      },
      menus: buildMenuTree(rules),
      authNode,
      /** 有权节点的扁平清单：`can('system/role/add')` 的兜底 */
      authNames: rules.map((rule) => rule.name),
    };
  },
);
