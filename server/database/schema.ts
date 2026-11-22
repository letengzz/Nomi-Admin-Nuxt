/**
 * 数据表结构（PowerDesigner 式的「一份 DDL 就是全部真相」）。
 *
 * 表名与「功能」对齐，不再沿用 BuildAdmin 的 `admin_*` 前缀：
 *
 *   user              账号
 *   role              角色（权限载体）
 *   user_role         账号 ↔ 角色
 *   department        部门（组织树）
 *   permission_rule   菜单与权限节点（同源一棵树）
 *   operation_log     操作日志
 *   token             登录令牌（只存摘要）
 *   schema_migration  一次性迁移记账
 *
 * 全部是 `CREATE TABLE IF NOT EXISTS`：
 *   · 首次启动（库和表都不存在）→ 建库、建表、灌种子数据；
 *   · 之后每次启动 → 逐条执行，命中已存在的表直接跳过，零副作用；
 *   · 不做 ALTER。加字段 / 改表名请写显式迁移（见 ./migrations.ts）。
 */

export const SCHEMA_STATEMENTS: readonly string[] = [
  // 通知公告。分类/通知方式/通知范围用枚举字符串存（白名单在 notice-service.ts），
  // 避免数字 id 依赖种子顺序；publishTime 是秒级时间戳，<= 当前时间才对通知中心可见。
  `CREATE TABLE IF NOT EXISTS \`announcement\` (
    \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
    \`title\` varchar(200) NOT NULL DEFAULT '' COMMENT '公告标题',
    \`category\` varchar(20) NOT NULL DEFAULT 'notice' COMMENT '分类：notice 通知 / bulletin 公告 / activity 活动',
    \`content\` mediumtext COMMENT '正文内容（富文本 HTML）',
    \`publish_time\` bigint NOT NULL DEFAULT 0 COMMENT '定时发布时间（秒），0 或过去时间 = 立即发布',
    \`is_top\` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 置顶',
    \`notify_method\` varchar(20) NOT NULL DEFAULT 'internal' COMMENT '通知方式：internal 站内信 / email 邮件 / sms 短信',
    \`notify_scope\` varchar(20) NOT NULL DEFAULT 'all' COMMENT '通知范围：all 全部 / department 指定部门 / role 指定角色',
    \`scope_ids\` varchar(500) NOT NULL DEFAULT '' COMMENT '范围目标 id，逗号分隔；all 时为空',
    \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
    \`creator_id\` int unsigned NOT NULL DEFAULT 0 COMMENT '发布人 id',
    \`creator_name\` varchar(50) NOT NULL DEFAULT '' COMMENT '发布人名称',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`idx_publish_time\` (\`publish_time\`),
    KEY \`idx_category\` (\`category\`),
    KEY \`idx_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知公告表'`,

  // 部门（组织树）。功能权限仍由角色决定；部门额外承担「数据范围」：
  // 非超管只看本部门 + 子部门（见 department-scope.ts），范围判定只查 pid，
  // 不需要 path/level 字段，组织调整后范围自动跟着变。
  `CREATE TABLE IF NOT EXISTS \`department\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`pid\` int unsigned NOT NULL DEFAULT 0 COMMENT '上级部门，0 = 一级部门',
    \`name\` varchar(100) NOT NULL DEFAULT '',
    \`leader\` varchar(50) NOT NULL DEFAULT '' COMMENT '负责人',
    \`phone\` varchar(30) NOT NULL DEFAULT '' COMMENT '联系电话',
    \`weigh\` int NOT NULL DEFAULT 0 COMMENT '排序权重，越大越前',
    \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`idx_pid\` (\`pid\`),
    KEY \`idx_name\` (\`name\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表'`,

  // 账号表。**不再有「账号类型」字段**：一个人和后台的关系只有「他有哪些角色」。
  // 角色本身就能表达「只读」「普通员工」「管理员」，多一个 type 字段等于两套真相。
  //
  // status 用 enable/disable 字符串（与 BuildAdmin v2.2.2 之后一致），
  // 不用 tinyint：调接口时 'enable' 比 1 更不容易被前端误判真假。
  `CREATE TABLE IF NOT EXISTS \`user\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`username\` varchar(20) NOT NULL COMMENT '登录账号，唯一凭据',
    \`department_id\` int unsigned NOT NULL DEFAULT 0 COMMENT '所属部门 department.id，0 = 未分配',
    \`nickname\` varchar(50) NOT NULL DEFAULT '' COMMENT '显示名',
    \`avatar\` varchar(255) NOT NULL DEFAULT '',
    \`email\` varchar(100) NOT NULL DEFAULT '',
    \`mobile\` varchar(20) NOT NULL DEFAULT '',
    \`motto\` varchar(255) NOT NULL DEFAULT '',
    \`gender\` varchar(10) NOT NULL DEFAULT 'unknown' COMMENT '性别：unknown 保密 / male 男 / female 女',
    \`password\` varchar(255) NOT NULL COMMENT 'scrypt 哈希，明文永不落库',
    \`salt\` varchar(30) NOT NULL DEFAULT '' COMMENT '历史遗留字段，仅兼容旧密码',
    \`login_failure\` tinyint unsigned NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
    \`must_change_password\` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = 首次登录必须改密（初始/重置口令）',
    \`last_login_time\` bigint NOT NULL DEFAULT 0,
    \`last_login_ip\` varchar(50) NOT NULL DEFAULT '',
    \`status\` varchar(30) NOT NULL DEFAULT 'enable' COMMENT 'enable / disable',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_username\` (\`username\`),
    KEY \`idx_status\` (\`status\`),
    KEY \`idx_department\` (\`department_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号表'`,

  // 角色。pid 只用于展示上的分级，真正的上下级判定看权限集合包含关系
  // （见 server/utils/auth/data-scope.ts）。
  `CREATE TABLE IF NOT EXISTS \`role\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`pid\` int unsigned NOT NULL DEFAULT 0 COMMENT '上级角色，仅用于展示/数据权限',
    \`name\` varchar(100) NOT NULL DEFAULT '',
    \`code\` varchar(50) NOT NULL DEFAULT '' COMMENT '角色编码：代码/接口里引用的稳定标识',
    \`rules\` text COMMENT '权限载体："*" 或逗号分隔的 permission_rule.id',
    \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`idx_pid\` (\`pid\`),
    KEY \`idx_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表'`,

  // 账号 ↔ 角色 多对多。刻意不做主键，只加唯一键防止重复授权。
  `CREATE TABLE IF NOT EXISTS \`user_role\` (
    \`user_id\` int unsigned NOT NULL COMMENT 'user.id',
    \`role_id\` int unsigned NOT NULL COMMENT 'role.id',
    UNIQUE KEY \`uk_user_role\` (\`user_id\`, \`role_id\`),
    KEY \`idx_role\` (\`role_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号角色映射表'`,

  // 菜单与权限节点同源：一张表用 pid 组成树，type 区分目录/菜单/按钮。
  // name 是权限标识（如 system/role/add），path 是前端路由（如 /admin/system/roles）。
  `CREATE TABLE IF NOT EXISTS \`permission_rule\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`pid\` int unsigned NOT NULL DEFAULT 0,
    \`type\` enum('menu_dir','menu','button') NOT NULL DEFAULT 'menu',
    \`title\` varchar(100) NOT NULL DEFAULT '' COMMENT '显示名，可填 i18n key',
    \`name\` varchar(100) NOT NULL DEFAULT '' COMMENT '权限标识，大小写不敏感',
    \`path\` varchar(150) NOT NULL DEFAULT '' COMMENT '前端路由 path',
    \`icon\` varchar(50) NOT NULL DEFAULT '',
    \`menu_type\` varchar(20) NOT NULL DEFAULT '' COMMENT 'tab / link / iframe',
    \`url\` varchar(255) NOT NULL DEFAULT '',
    \`component\` varchar(150) NOT NULL DEFAULT '',
    \`keepalive\` tinyint(1) NOT NULL DEFAULT 1,
    \`extend\` varchar(20) NOT NULL DEFAULT 'none' COMMENT 'none / add_rules_only / add_menu_only',
    \`remark\` varchar(255) NOT NULL DEFAULT '',
    \`weigh\` int NOT NULL DEFAULT 0 COMMENT '排序权重，越大越前',
    \`status\` tinyint(1) NOT NULL DEFAULT 1,
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_name\` (\`name\`),
    KEY \`idx_pid\` (\`pid\`),
    KEY \`idx_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜单和权限规则表'`,

  // 操作日志。除了「谁在哪做了什么」，还带上一次请求的完整上下文：
  // trace_id 串起同一次调用、请求/响应头体用于排障、duration 记录耗时。
  // 响应体只存服务端拼好的业务包（脱敏后的请求体在 data 列）。
  `CREATE TABLE IF NOT EXISTS \`operation_log\` (
    \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
    \`user_id\` int unsigned NOT NULL DEFAULT 0,
    \`username\` varchar(50) NOT NULL DEFAULT '',
    \`url\` varchar(255) NOT NULL DEFAULT '' COMMENT '请求 URI',
    \`title\` varchar(100) NOT NULL DEFAULT '' COMMENT '操作内容（i18n key）',
    \`module\` varchar(50) NOT NULL DEFAULT '' COMMENT '所属模块（i18n key）',
    \`trace_id\` varchar(40) NOT NULL DEFAULT '',
    \`status\` varchar(16) NOT NULL DEFAULT 'success' COMMENT 'success / fail',
    \`duration\` int unsigned NOT NULL DEFAULT 0 COMMENT '耗时（毫秒）',
    \`error_msg\` varchar(255) NOT NULL DEFAULT '',
    \`data\` text COMMENT '请求体（脱敏）',
    \`request_headers\` text COMMENT '请求头（脱敏）',
    \`response_headers\` text COMMENT '响应头（脱敏）',
    \`response_body\` text COMMENT '响应体（截断）',
    \`ip\` varchar(50) NOT NULL DEFAULT '',
    \`ip_location\` varchar(120) NOT NULL DEFAULT '' COMMENT 'i18n key 或真实地名',
    \`browser\` varchar(60) NOT NULL DEFAULT '',
    \`os\` varchar(60) NOT NULL DEFAULT '',
    \`useragent\` varchar(255) NOT NULL DEFAULT '',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`idx_user\` (\`user_id\`),
    KEY \`idx_time\` (\`create_time\`),
    KEY \`idx_trace\` (\`trace_id\`),
    KEY \`idx_status\` (\`status\`),
    KEY \`idx_module\` (\`module\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号操作日志表'`,

  // 登录日志：登录/退出/失败/强退都记一行，与「谁在线」的会话表相互印证。
  `CREATE TABLE IF NOT EXISTS \`login_log\` (
    \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
    \`user_id\` int unsigned NOT NULL DEFAULT 0,
    \`username\` varchar(50) NOT NULL DEFAULT '',
    \`nickname\` varchar(50) NOT NULL DEFAULT '',
    \`behavior\` varchar(20) NOT NULL DEFAULT 'login' COMMENT 'login / logout / failed / locked / kick',
    \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 成功 / 0 失败',
    \`message\` varchar(255) NOT NULL DEFAULT '',
    \`ip\` varchar(50) NOT NULL DEFAULT '',
    \`ip_location\` varchar(120) NOT NULL DEFAULT '',
    \`browser\` varchar(60) NOT NULL DEFAULT '',
    \`os\` varchar(60) NOT NULL DEFAULT '',
    \`useragent\` varchar(255) NOT NULL DEFAULT '',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    KEY \`idx_user\` (\`user_id\`),
    KEY \`idx_time\` (\`create_time\`),
    KEY \`idx_behavior\` (\`behavior\`),
    KEY \`idx_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录日志表'`,

  // token 表存的是 HMAC 摘要，不是明文：库被拖走也不能直接拿去调用接口。
  // 过期记录**不立即删除**：必须先读到「已过期」才能返回业务码 409 触发续期。
  // 一行 access token = 一个在线会话：session_id 把它与配对的 refresh token 绑起来，
  // 续期复用同一个 session_id，所以「在线用户」不会因为刷新令牌多出一行。
  `CREATE TABLE IF NOT EXISTS \`token\` (
    \`token\` varchar(64) NOT NULL COMMENT 'HMAC-SHA256(token, TOKEN_SECRET)',
    \`type\` varchar(15) NOT NULL DEFAULT 'admin',
    \`user_id\` int unsigned NOT NULL DEFAULT 0,
    \`session_id\` varchar(40) NOT NULL DEFAULT '',
    \`create_time\` bigint NOT NULL DEFAULT 0 COMMENT '登录时间',
    \`expire_time\` bigint NOT NULL DEFAULT 0 COMMENT '预计失效',
    \`last_active_time\` bigint NOT NULL DEFAULT 0,
    \`last_refresh_time\` bigint NOT NULL DEFAULT 0,
    \`ip\` varchar(50) NOT NULL DEFAULT '',
    \`ip_location\` varchar(120) NOT NULL DEFAULT '',
    \`browser\` varchar(60) NOT NULL DEFAULT '',
    \`os\` varchar(60) NOT NULL DEFAULT '',
    \`useragent\` varchar(255) NOT NULL DEFAULT '',
    \`scope_department_id\` int unsigned NOT NULL DEFAULT 0 COMMENT '登录所选部门，作为本次会话的数据范围根；0 = 按账号所属部门',
    PRIMARY KEY (\`token\`),
    KEY \`idx_user\` (\`type\`,\`user_id\`),
    KEY \`idx_expire\` (\`expire_time\`),
    KEY \`idx_session\` (\`session_id\`),
    KEY \`idx_active\` (\`last_active_time\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='令牌表（只存摘要）'`,

  // 语言管理：语言 / 词条 / 译文三张表。
  // 译文按「行」存而不是给每种语言加一列：新增语言不需要 ALTER TABLE，
  // 未完成翻译的语言也能自然留下空行（完成度由此算得出来）。
  `CREATE TABLE IF NOT EXISTS \`language\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`code\` varchar(20) NOT NULL COMMENT '与 nuxt.config.ts 的 i18n.locales.code 一致',
    \`name\` varchar(50) NOT NULL DEFAULT '' COMMENT '显示名称',
    \`native_name\` varchar(50) NOT NULL DEFAULT '' COMMENT '本地名称',
    \`weigh\` int NOT NULL DEFAULT 0 COMMENT '排序权重，越大越前',
    \`status\` tinyint(1) NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_code\` (\`code\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语言表'`,

  `CREATE TABLE IF NOT EXISTS \`language_entry\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`key\` varchar(190) NOT NULL COMMENT '点分路径，如 auth.user.title',
    \`module\` varchar(50) NOT NULL DEFAULT '' COMMENT '第一段，用于分组筛选',
    \`type\` varchar(16) NOT NULL DEFAULT 'custom' COMMENT 'system = 内置语言文件导入 / custom = 后台新增',
    \`remark\` varchar(255) NOT NULL DEFAULT '',
    \`create_time\` bigint NOT NULL DEFAULT 0,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_key\` (\`key\`),
    KEY \`idx_module\` (\`module\`),
    KEY \`idx_type\` (\`type\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语言词条表'`,

  `CREATE TABLE IF NOT EXISTS \`language_value\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`entry_id\` int unsigned NOT NULL,
    \`lang_code\` varchar(20) NOT NULL,
    \`value\` text,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_entry_lang\` (\`entry_id\`,\`lang_code\`),
    KEY \`idx_lang\` (\`lang_code\`),
    KEY \`idx_value\` (\`value\`(64))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='语言译文表'`,

  // 系统配置：按「区块 + 键」存一行，不 JSON 大字段。保存时只动改过的键，
  // 恢复默认直接删掉该区块的行，剩下的值自动回落到 DEFAULT_CONFIG。
  `CREATE TABLE IF NOT EXISTS \`system_config\` (
    \`id\` int unsigned NOT NULL AUTO_INCREMENT,
    \`section\` varchar(32) NOT NULL COMMENT '配置区块：site/security/login/email/storage',
    \`config_key\` varchar(64) NOT NULL,
    \`config_value\` text NOT NULL,
    \`update_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`uk_section_key\` (\`section\`,\`config_key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表'`,

  // 一次性迁移的记账本。CREATE TABLE IF NOT EXISTS 只能表达「表不存在则建」，
  // 表达不了「给已有表加字段」「把菜单节点换个父级」。这类改动用具名迁移 + 这张
  // 表记录是否已执行，保证重启不会重复跑（详见 ./migrations.ts）。
  `CREATE TABLE IF NOT EXISTS \`schema_migration\` (
    \`name\` varchar(100) NOT NULL COMMENT '迁移标识，如 2026-11-15-drop-user-type',
    \`applied_time\` bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (\`name\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='一次性迁移记录表'`,
];
