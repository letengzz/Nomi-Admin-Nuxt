/**
 * 后台骨架层 —— 叠加逻辑的**唯一实现**。
 *
 * 为什么单独一个文件，而不是留在 `scripts/admin-init.mjs` 里：
 * 同一套逻辑有两个消费者，而且它们必须产出**逐字节相同**的结果：
 *   ① 初始化引擎（`scripts/init.mjs`）的第 5 阶段 —— 用户点一次「初始化项目」，
 *      拿到手的就直接是后台工程，不需要再记得跑第二条命令；
 *   ② `scripts/admin-init.mjs` —— 换栈（`--ui`）、复核（`--check`）、回滚。
 * 两边各写一份的话，迟早出现「初始化叠出来的是 A 档、`--check` 按 B 档验」这类
 * 只在特定路径上出现的分叉。共享层里已经有一条同源纪律（`shared/wizard/plan.mjs`），
 * 这里照办。
 *
 * 零外部依赖：只用 `node:` 内置模块。引擎要在「依赖还没装好」的仓库里跑，
 * 这条纪律对两个消费者都成立。
 *
 * 四阶段：plan → snapshot → apply → verify（**没有 install**）
 * 叠加期不引入任何新依赖 —— 依赖一律由第 1 段的 install 阶段负责，
 * 于是没有「配置声明了模块、模块还没装」的危险窗口。如果某档确实需要额外包，
 * 它必须写进 `server/utils/wizard/options.json` 的 deps/devDeps，而不是在这里补装。
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

/** 档位 id —— 与 server/utils/wizard/options.json 的 ui 组一一对应，也等于 skeleton/ 下的目录名 */
export const UI_IDS = ['none', 'element-plus', 'ant-design-vue', 'nuxt-ui', 'vuetify'];

export const CONFIG_FILE = 'template.config.json';
export const RECORD_FILE = 'admin.config.json';
export const BACKUP_ROOT = '.init-backup';
export const ADMIN_TEMPLATE_VERSION = '1.1.0';

/**
 * 本层快照目录的后缀。
 *
 * 两个工具共用 `.init-backup/`，而**引擎的 `--rollback` 与 `verify` 的第 9 项
 * 都按「字典序最大的那个目录」取最近一次快照**。`…Z-admin` 的字典序**大于** `…Z`
 * （前缀相同、长者靠后），于是这两个只认「引擎快照」的地方会挑到本层的快照 ——
 * 那份清单里只有被覆盖的两个文件，回滚后仓库回不到初始化前，
 * 而 verify 的「与快照逐字节比对」会静默退化成哈希兜底。
 * 所以「谁属于引擎快照」这件事必须有一份共同定义，两个消费者都按它过滤。
 */
export const ADMIN_SNAPSHOT_SUFFIX = '-admin';

/**
 * 共享层从哪来：源目录 → 目标目录前缀 + 归属层。
 *
 * 为什么源目录叫 `overlay/` 而不是 `shared/`：
 * 第 1 段生成的 `.nuxt/tsconfig.shared.json` 把 `../shared/**\/*` 列进了 `include`，
 * 且 `~/*` 指向 `../app/*`。若把这些用 `~/…` 互相引用的 .ts 放进 `shared/`，
 * 模板仓库**自身**的 `pnpm typecheck` 会因解析不到 `~/config/env` 而变红。
 * `overlay/` 不被任何生成的 tsconfig 引用，也不在引导器白名单里，第 1 段不会碰它。
 */
export const SHARED_SOURCES = [
  { dir: 'overlay/app', prefix: 'app', layer: 'logic' }, // 公共逻辑层 + 与框架无关的共享组件
  { dir: 'overlay/server', prefix: 'server', layer: 'api' }, // 演示接口
];

/**
 * 「覆盖基线」的文件：不属于逻辑层，也不是视图层，而是**必须覆盖上游产物**的那几个。
 *
 * 为什么 `app/app.vue` 在这里：
 * 引导期的 `app.vue` 是 `<NuxtRouteAnnouncer /><NuxtPage />` —— **没有 `<NuxtLayout>`**，
 * 而 Nuxt 只在你调用 `<NuxtLayout>` 的地方应用布局。不覆盖它，五档布局会**完全不生效**，
 * 且页面正常渲染、控制台干净（正是 Layouts 页第 2 节列的第一个静默错误）。
 * 把它放在共享层（而不是每档一份）是因为它与 UI 框架无关：删掉任何组件库它照样编译。
 */
export const BASELINE_FILES = ['app/app.vue'];

/**
 * C2 的框架指纹。
 *
 * `hit` 的语义是「本档特征」，`miss` 的语义是「其它档特征」。
 * 只断言「有 el-」是不够的：一个文件里同时留着 `el-menu` 与 `a-table`
 * 恰恰是最危险的状态（改到一半换栈），所以判据是
 * 「**本档特征命中 > 0 且其他档特征命中 = 0**」。
 *
 * `none` 档的 `hit` 用 `<style scoped>` 而不是「没有任何标签」——
 * 纯 CSS 档的特征正是「把样式写进组件里」。
 */
export const SIGNATURE = {
  'element-plus': { hit: /<(?:el-|ElMessage)/, miss: /<(?:a-|v-|U[A-Z])/ },
  'ant-design-vue': { hit: /<(?:a-|message\b)/, miss: /<(?:el-|v-|U[A-Z])/ },
  'nuxt-ui': { hit: /<U[A-Z]|useToast\(/, miss: /<(?:el-|a-|v-)/ },
  vuetify: { hit: /<v-/, miss: /<(?:el-|a-|U[A-Z])/ },
  none: { hit: /<style scoped>/, miss: /<(?:el-|a-|v-|U[A-Z])/ },
};

/**
 * C3 的扫描面。
 *
 * 这一层只该放**与框架无关的代码**。没有把 `app/components` 放进来是因为它不该出现在
 * 这一层：视图层组件按定义就会 import 组件库，C3 在这里报红属于误伤。
 * 真正要盯住的是「共享逻辑有没有偷偷依赖某个 UI 库」——那会让换栈从
 * 「覆盖 6 个文件」变成「还得去改 10 个看不出来的文件」。
 */
export const LOGIC_DIRS = [
  'app/config',
  'app/composables',
  'app/middleware',
  'app/utils',
  'app/types',
];

/** C3 的 UI 依赖关键词。五档视图层用到的库都在这张表里。 */
const UI_IMPORT_RE = /(?:from\s*['"](?:element-plus|@element-plus\/[^'"]+|ant-design-vue|@ant-design\/[^'"]+|@nuxt\/ui|vuetify|vuetify-nuxt-module)['"])|(?:require\(\s*['"](?:element-plus|ant-design-vue|@nuxt\/ui|vuetify)['"])/;

/**
 * 框架自带的包，不算「视图层的第三方依赖」。
 *
 * 它们由 Nuxt 自己提供（`vue` / `vue-router` 是 nuxt 的传递依赖，`h3` / `ofetch` 由 Nitro 提供），
 * 因此**不该**出现在 `template.config.json` 的 deps 里 —— 把它们也要求一遍，
 * 等于逼着每个项目重复声明框架的依赖。白名单是刻意逐条列出的，与仓库里其他清单同一种风格。
 */
const FRAMEWORK_PKGS = new Set([
  'vue',
  'vue-router',
  'vue/server-renderer',
  'nuxt',
  'h3',
  'ofetch',
  'ufo',
  'defu',
  'consola',
  'nitropack',
]);

/** 从一行里抠出 import/export/require/动态 import 的模块说明符 */
const SPECIFIER_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * 各档视图层用到、但**在源码里 import 不出来**的运行时资源。
 *
 * 它们按名字生效，而不是按 import：`<UIcon name="i-lucide-home" />` 与 `v-icon` 的
 * 默认图标集都不会在文件里留下一行 import。于是「C5 靠扫 import 发现他」这条路走不通，
 * 只能显式列出来。
 *
 * 列表里的每一条都必须在 `server/utils/wizard/options.json` 对应档位声明过依赖 ——
 * 这正是 C5 的核心不变量：**视图层依赖的任何第三方包，都必须是本次选择声明过的依赖**。
 * 依赖只有一个入口（初始化），才不会出现「代码是一档、依赖是另一档」。
 */
export const EXTRA_DEPS = {
  none: [],
  'element-plus': [],
  'ant-design-vue': [],
  'nuxt-ui': [
    {
      pkg: '@iconify-json/lucide',
      dev: true,
      required: true,
      why: 'UIcon 按图标名取数据，不体现在 import 里；缺了图标位是空白',
    },
  ],
  vuetify: [
    {
      pkg: '@mdi/font',
      dev: false,
      required: true,
      why: 'Vuetify 默认图标集是 mdi，v-icon 靠这份字体文件；不体现在 import 里',
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 基础设施
// ─────────────────────────────────────────────────────────────────────────────

const EOL_RE = /\r\n|\n|\r/;
const splitLines = (text) => text.split(EOL_RE);

/** 仓库内前缀校验：越界一律抛错（与第 1 段的 safeJoin 同源，两处都要防越界） */
export function safeJoin(root, rel) {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`路径越界：${rel}`);
  }
  return abs;
}

/**
 * 把 `<root>/<srcDir>` 下的文件展开成「目标相对路径 → 源绝对路径」。
 *
 * `prefix` 的存在理由：`overlay/app/` 的**内容**要落到产物的 `app/` 下
 * （源目录里没有 `app/` 这一层），若按「相对源目录」取键，会得到
 * `config/env.ts` 这种丢掉 `app/` 前缀的错路径。有了 prefix 之后两条规则仍然成立：
 *   · 源目录结构 == 目标结构（prefix 之下的部分）
 *   · 想加一档只需建目录，不需要改任何映射表
 */
export function expand(root, srcDir, prefix = '') {
  const dir = safeJoin(root, srcDir);
  if (!existsSync(dir)) throw new Error(`源目录不存在：${srcDir}`);

  const out = new Map();
  const walk = (cur) => {
    for (const name of readdirSync(cur)) {
      const abs = resolve(cur, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const rel = relative(dir, abs).split('\\').join('/');
        out.set(prefix ? `${prefix}/${rel}` : rel, abs);
      }
    }
  };
  walk(dir);
  return out;
}

function sameContent(abs, text) {
  if (!existsSync(abs)) return false;
  try {
    return readFileSync(abs, 'utf8') === text;
  }
  catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 前置条件
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 三条前置检查缺一条都会得到一个「看起来正常」的坏产物：
 *   ① 没有它，脚本只能猜档位 —— 猜错的后果是「用 Element Plus 的依赖配了
 *      Ant Design Vue 的代码」，编译期报的是「组件 a-layout 未解析」。
 *   ② 没有它，用户可能在引导器自删前就跑了本模块，之后第 1 段的 apply
 *      会把 `app/pages/index.vue` 覆盖回引导期版本，把守卫的入口换掉。
 *   ③ 没有它，`skeleton/<非法值>/` 不存在，报错信息里只有路径、没有「你该选哪一档」。
 *
 * 从初始化引擎里调用时 ①②③ 都已由上游阶段保证（apply 之后、锁还在手里），
 * 所以引擎走的是显式传参的分支，不重复前置检查。
 */
export function precondition(root) {
  const problems = [];

  const cfgAbs = safeJoin(root, CONFIG_FILE);
  if (!existsSync(cfgAbs)) {
    problems.push(`缺少 ${CONFIG_FILE} —— 请先完成初始化（pnpm dev → /setup）`);
    return { problems, cfg: null };
  }

  for (const rel of ['app/pages/setup', 'server/api/wizard']) {
    if (existsSync(safeJoin(root, rel))) problems.push(`引导器未清理：${rel} —— 请先跑 pnpm verify`);
  }

  let cfg = null;
  try {
    cfg = JSON.parse(readFileSync(cfgAbs, 'utf8'));
  }
  catch (err) {
    problems.push(`${CONFIG_FILE} 不是合法 JSON：${err.message}`);
    return { problems, cfg: null };
  }

  const ui = cfg?.selection?.ui;
  if (!UI_IDS.includes(ui)) {
    problems.push(`${CONFIG_FILE} 的 ui 取值非法：「${ui}」（合法值：${UI_IDS.join(' / ')}）`);
  }

  return { problems, cfg };
}

// ─────────────────────────────────────────────────────────────────────────────
// plan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 由档位唯一确定的文件清单。
 *
 * @param {string} root
 * @param {{ ui?: string, upstreamUi?: string }} [options]
 *        `ui` 缺省时读 `template.config.json`；初始化引擎会**显式传入**
 *        （它此刻刚写完配置文件，而且不想再读一次盘上的同一个事实）。
 */
export function planAdmin(root, options = {}) {
  let upstreamUi = options.upstreamUi;
  let ui = options.ui;

  if (!ui || !upstreamUi) {
    const { problems, cfg } = precondition(root);
    if (problems.length) {
      const err = new Error(problems.join('\n  '));
      err.problems = problems;
      throw err;
    }
    upstreamUi = upstreamUi ?? cfg.selection.ui;
    ui = ui ?? cfg.selection.ui;
  }

  if (!UI_IDS.includes(ui)) throw new Error(`未知 UI 档位：${ui}（合法值：${UI_IDS.join(' / ')}）`);

  const buckets = { baseline: new Map() };
  for (const src of SHARED_SOURCES) buckets[src.layer] = expand(root, src.dir, src.prefix);

  // 把「覆盖基线」从逻辑层里摘出来：它要单独计数，才说得清「逻辑层 N 个」这句话
  for (const rel of BASELINE_FILES) {
    const src = buckets.logic.get(rel);
    if (src) {
      buckets.baseline.set(rel, src);
      buckets.logic.delete(rel);
    }
  }

  buckets.view = expand(root, `skeleton/${ui}`, '');

  // 目标相对路径 → 源绝对路径（后面的桶覆盖前面的：三者的路径空间不重叠，
  // 唯一可能重叠的是 app/pages/index.vue —— 它只属于 view 桶）
  const files = new Map();
  for (const bucket of ['baseline', 'logic', 'api', 'view']) {
    for (const [rel, abs] of buckets[bucket]) {
      if (files.has(rel)) throw new Error(`计划冲突：${rel} 同时来自多个层`);
      files.set(rel, abs);
    }
  }

  const content = new Map();
  for (const [rel, abs] of files) content.set(rel, readFileSync(abs, 'utf8'));

  const willWrite = [];
  const skipped = [];
  for (const [rel, text] of content) {
    if (sameContent(safeJoin(root, rel), text)) skipped.push(rel);
    else willWrite.push(rel);
  }
  willWrite.sort();
  skipped.sort();

  const overwritten = willWrite.filter((rel) => existsSync(safeJoin(root, rel)));

  return { ui, upstreamUi, buckets, files, content, willWrite, skipped, overwritten };
}

/** plan 的一行人话总结（引擎日志与 CLI 共用，避免两处措辞漂移） */
export function planSummary(planned) {
  return `逻辑层 ${planned.buckets.logic.size} / 服务端 ${planned.buckets.api.size} / 视图层 ${planned.buckets.view.size} / 覆盖基线 ${planned.buckets.baseline.size}（ui=${planned.ui}）`;
}

// ─────────────────────────────────────────────────────────────────────────────
// snapshot / apply
// ─────────────────────────────────────────────────────────────────────────────

/** 只快照将被覆盖的文件：新增文件回滚时直接删即可，不必先复制一份 */
export function snapshotAdmin(root, overwritten) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = safeJoin(root, `${BACKUP_ROOT}/${stamp}${ADMIN_SNAPSHOT_SUFFIX}`);
  if (!overwritten.length) return null;

  mkdirSync(dir, { recursive: true });
  const manifest = [];
  for (const rel of overwritten) {
    const to = resolve(dir, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(safeJoin(root, rel), to);
    manifest.push({ path: rel, existed: true });
  }
  writeFileSync(
    resolve(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

function rmIfExists(abs) {
  if (existsSync(abs)) unlinkSync(abs);
}

/** 逐文件写入：先写临时文件再改名，避免写一半被中断留下半截文件 */
export function applyAdmin(root, planned, report) {
  for (const rel of planned.willWrite) {
    const abs = safeJoin(root, rel);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.admintmp`;
      writeFileSync(tmp, planned.content.get(rel), 'utf8');
      rmIfExists(abs); // unlinkSync，不用 rm(recursive)
      renameSync(tmp, abs);
      report.written.push(rel);
    }
    catch (err) {
      report.failed.push({ path: rel, reason: err.code ?? err.message });
    }
  }
}

/** 收尾：写产物记录。它是 --check 的唯一输入，也是「这批文件是谁写的」的凭证。 */
export function writeAdminRecord(root, planned, report, backupDir) {
  const config = {
    schemaVersion: '1.0.0',
    adminTemplateVersion: ADMIN_TEMPLATE_VERSION,
    appliedAt: new Date().toISOString(),
    ui: planned.ui, // 本次实际生效的档位
    upstreamSelectionUi: planned.upstreamUi, // 上游选择页选的档位，用于检测两者不一致
    layer: {
      logic: [...planned.buckets.logic.keys()].sort(),
      api: [...planned.buckets.api.keys()].sort(),
      view: [...planned.buckets.view.keys()].sort(),
      baseline: [...planned.buckets.baseline.keys()].sort(),
    },
    overwritten: report.written.filter((rel) => report.existedBefore.includes(rel)),
    skipped: [...report.skipped].sort(),
    backup: backupDir ? relative(root, backupDir).split('\\').join('/') : null,
  };
  writeFileSync(safeJoin(root, RECORD_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// verify（C1~C5）
// ─────────────────────────────────────────────────────────────────────────────

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return (text.match(g) ?? []).length;
}

/** C3：逻辑层不许 import 任何 UI 库 */
export function scanLogicUiImports(root) {
  const hits = [];
  for (const dir of LOGIC_DIRS) {
    const abs = safeJoin(root, dir);
    if (!existsSync(abs)) continue;
    const walk = (cur) => {
      for (const name of readdirSync(cur)) {
        const p = resolve(cur, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(?:ts|vue|mts|js)$/.test(name)) {
          const lines = splitLines(readFileSync(p, 'utf8'));
          lines.forEach((line, i) => {
            if (UI_IMPORT_RE.test(line)) {
              hits.push(`${relative(root, p).split('\\').join('/')}:${i + 1}`);
            }
          });
        }
      }
    };
    walk(abs);
  }
  return hits;
}

/** 把 `ant-design-vue/es/form` 归到包根 `ant-design-vue`，`@scope/x/sub` 归到 `@scope/x` */
function packageRoot(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

/** 依赖声明可以带版本范围（`typescript@5`），但落盘与比较都只认包名 */
function declaredName(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * 收集产物里**真正需要第三方包**的地方：四层的 import 说明符 + 本档「按名字生效」的资源。
 *
 * 只收裸包名 —— `~/utils/api`、`#imports`、`node:fs` 这些不是依赖，收进来只会制造噪音。
 */
export function collectRequiredPackages(root, config, ui) {
  const found = new Map(); // 包名 → 出现位置（用于报错时给人一个抓手）

  const add = (pkg, where) => {
    if (FRAMEWORK_PKGS.has(pkg)) return;
    if (!found.has(pkg)) found.set(pkg, where);
  };

  for (const bucket of ['baseline', 'logic', 'api', 'view']) {
    for (const rel of config.layer?.[bucket] ?? []) {
      const abs = safeJoin(root, rel);
      if (!existsSync(abs)) continue;
      if (!/\.(?:ts|vue|mts|js)$/.test(rel)) continue;
      for (const line of splitLines(readFileSync(abs, 'utf8'))) {
        for (const match of line.matchAll(SPECIFIER_RE)) {
          const specifier = match[1];
          if (!specifier) continue;
          // 相对路径、别名、协议前缀、Node 内置 —— 都不是第三方包
          if (/^[./]/.test(specifier) || /^[~#@]\//.test(specifier) || specifier.includes(':')) continue;
          add(packageRoot(specifier), `${rel} 的 import '${specifier}'`);
        }
      }
    }
  }

  for (const dep of EXTRA_DEPS[ui] ?? []) {
    if (dep.required) add(dep.pkg, dep.why);
  }

  return found;
}

/**
 * C5：**视图层依赖的每个第三方包，都必须是本次选择声明过的依赖，并且真的装上了。**
 *
 * 为什么这条不能靠「列一份清单逐个查」：
 * 硬编码清单只能守住你今天想到的那些包。而「视图层 import 了一个没声明的包」
 * 这件事是**随代码长出来的** —— 有人给用户列表加了个日期格式化，import 了 `dayjs`，
 * 于是 C1~C4 全绿、`pnpm dev` 一起就报 `NUXT_B7002` 或「组件未解析」。
 * 所以判据必须从**源码里的 import 反推**，而不是从清单正推：
 *
 *   ① 每个裸包名（除掉框架自带的）都要在 `template.config.json` 的 deps/devDeps 里
 *      —— 否则说明它绕过了初始化。依赖只有一个入口，`template.config.json` 才是唯一事实。
 *   ② 声明过的包要能被解析 —— 只有 `--skip-install` 时跳过，
 *      因为那时「没装」是用户的正常选择，不是缺陷。
 */
export function scanRequiredDeps(root, ui, options = {}) {
  const cfgPath = safeJoin(root, CONFIG_FILE);
  if (!existsSync(cfgPath)) return { undeclared: [], unresolved: [], checked: 0, declared: 0 };

  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const declared = new Set(
    [...(cfg.plan?.deps ?? []), ...(cfg.plan?.devDeps ?? [])].map(declaredName),
  );
  // 要扫哪些文件由 `admin.config.json` 的 layer 决定（那是本层真正写过的文件清单），
  // 「声明了哪些依赖」由 `template.config.json` 决定。两份记录各司其职，不互相代替。
  const required = collectRequiredPackages(root, readRecord(root), ui);

  const undeclared = [];
  const unresolved = [];
  const require = createRequire(resolve(root, 'noop.cjs'));

  for (const [pkg, where] of required) {
    if (!declared.has(pkg)) {
      undeclared.push({ pkg, where });
      continue;
    }
    if (options.skipDeps) continue;
    try {
      require.resolve(`${pkg}/package.json`, { paths: [root] });
    }
    catch {
      unresolved.push({ pkg, where });
    }
  }

  // 顺序稳定：报错文本会被 diff 与自测断言比对
  undeclared.sort((a, b) => a.pkg.localeCompare(b.pkg));
  unresolved.sort((a, b) => a.pkg.localeCompare(b.pkg));
  return { undeclared, unresolved, checked: required.size, declared: declared.size };
}

/** 读产物记录（C1 的输入）。没有记录时返回空对象，让上层去报「缺 admin.config.json」 */
function readRecord(root) {
  const abs = safeJoin(root, RECORD_FILE);
  if (!existsSync(abs)) return {};
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  }
  catch {
    return {};
  }
}

export function verifyAdmin(root, options = {}) {
  const results = [];
  const recordAbs = safeJoin(root, RECORD_FILE);

  // ── 准备：没有产物记录就没法验 ──────────────────────────────────────────
  if (!existsSync(recordAbs)) {
    results.push({ id: 1, ok: false, label: '文件齐全', detail: `缺少 ${RECORD_FILE} —— 请先跑 node scripts/admin-init.mjs` });
    results.push({ id: 2, ok: false, label: '框架标签一致', detail: '跳过（无产物记录）' });
    results.push({ id: 3, ok: false, label: '逻辑层无 UI 依赖', detail: '跳过（无产物记录）' });
    results.push({ id: 4, ok: false, label: '档位与上游一致', detail: '跳过（无产物记录）' });
    results.push({ id: 5, ok: false, label: '必需依赖可解析', detail: '跳过（无产物记录）' });
    return results;
  }

  const config = JSON.parse(readFileSync(recordAbs, 'utf8'));
  const ui = config.ui;

  // ── C1 文件齐全 ─────────────────────────────────────────────────────────
  const missing = [];
  for (const bucket of ['baseline', 'logic', 'api', 'view']) {
    for (const rel of config.layer?.[bucket] ?? []) {
      if (!existsSync(safeJoin(root, rel))) missing.push(rel);
    }
  }
  const counts = {
    logic: (config.layer?.logic ?? []).length,
    api: (config.layer?.api ?? []).length,
    view: (config.layer?.view ?? []).length,
    baseline: (config.layer?.baseline ?? []).length,
  };
  const totalCount = counts.logic + counts.api + counts.view + counts.baseline;
  results.push({
    id: 1,
    ok: missing.length === 0,
    label: '文件齐全',
    detail: missing.length
      ? `缺 ${missing.length} 个：${missing.join('、')}`
      : `逻辑层 ${counts.logic} / 服务端 ${counts.api} / 视图层 ${counts.view} / 覆盖基线 ${counts.baseline}，合计 ${totalCount} 个`,
  });

  // ── C2 框架标签与本档一致 ────────────────────────────────────────────────
  const sig = SIGNATURE[ui];
  if (!sig) {
    results.push({ id: 2, ok: false, label: '框架标签一致', detail: `未知档位：${ui}` });
  }
  else {
    const bad = [];
    let hits = 0;
    let missHits = 0;
    for (const rel of config.layer?.view ?? []) {
      const abs = safeJoin(root, rel);
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, 'utf8');
      const h = countMatches(text, sig.hit);
      const m = countMatches(text, sig.miss);
      hits += h;
      missHits += m;
      if (h === 0) bad.push(`${rel}（本档特征 0 命中）`);
      if (m > 0) bad.push(`${rel}（混入他档特征 ${m} 处）`);
    }
    results.push({
      id: 2,
      ok: bad.length === 0,
      label: '框架标签一致',
      detail: bad.length
        ? bad.join('；')
        : `ui=${ui}，本档命中 ${hits}、他档命中 ${missHits}`,
    });
  }

  // ── C3 逻辑层无 UI 依赖 ─────────────────────────────────────────────────
  const uiHits = scanLogicUiImports(root);
  results.push({
    id: 3,
    ok: uiHits.length === 0,
    label: '逻辑层无 UI 依赖',
    detail: uiHits.length ? uiHits.join('、') : `扫描 ${LOGIC_DIRS.length} 个目录，0 命中`,
  });

  // ── C4 档位与上游一致 ───────────────────────────────────────────────────
  const same = ui === config.upstreamSelectionUi;
  results.push({
    id: 4,
    ok: same,
    label: '档位与上游一致',
    detail: same
      ? ui
      : `ui=${ui} / upstream=${config.upstreamSelectionUi} —— 依赖与代码错配，请回去重跑初始化或手动调整依赖`,
  });

  // ── C5 必需依赖可解析 ───────────────────────────────────────────────────
  // `--skip-install` 时**跳过而不是失败**：依赖没装是用户自己的选择，
  // 把它报红会在一个正常用法上留下一个恒红的收尾（与第 1 段第 11 项的取舍同源）。
  const dep = options.skipDeps
    ? { undeclared: [], unresolved: [], checked: 0, declared: 0, skipped: true }
    : scanRequiredDeps(root, ui);
  const details = [];
  for (const item of dep.undeclared) {
    details.push(`${item.pkg} 没有出现在本次选择的依赖里（${item.where}）→ 请把它加进 server/utils/wizard/options.json 对应档位的 deps/devDeps，或改成不依赖它`);
  }
  for (const item of dep.unresolved) {
    details.push(`${item.pkg} 声明了但装不上（${item.where}）→ 在仓库根执行 pnpm add ${item.pkg}`);
  }
  results.push({
    id: 5,
    ok: dep.undeclared.length === 0 && dep.unresolved.length === 0,
    label: '视图层依赖与选择一致',
    detail: dep.skipped
      ? '跳过（--skip-install：依赖还没装）'
      : details.length
        ? details.join('；')
        : `扫出 ${dep.checked} 个第三方包，全部在本次选择的 ${dep.declared} 个依赖里且可解析`,
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 供 CLI 复用的小工具
// ─────────────────────────────────────────────────────────────────────────────

/** 只删「读起来是空的」目录 —— 递归删除会带走用户临时放的草稿 */
export function pruneEmptyDirs(dir) {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

/** 从最近一次 `*-admin` 快照还原（只还原快照里记过的文件） */
export function rollbackAdmin(root) {
  const base = safeJoin(root, BACKUP_ROOT);
  if (!existsSync(base)) throw new Error(`没有快照目录：${BACKUP_ROOT}`);

  const candidates = readdirSync(base).filter((n) => n.endsWith(ADMIN_SNAPSHOT_SUFFIX)).sort();
  const latest = candidates.at(-1);
  if (!latest) throw new Error(`没有 -admin 快照：${BACKUP_ROOT}`);

  const dir = resolve(base, latest);
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  const restored = [];
  for (const item of manifest) {
    const from = resolve(dir, item.path);
    if (!existsSync(from)) continue;
    const to = safeJoin(root, item.path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    restored.push(item.path);
  }
  pruneEmptyDirs(resolve(dir));
  return { snapshot: latest, restored };
}
