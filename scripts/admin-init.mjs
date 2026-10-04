#!/usr/bin/env node
/**
 * 后台管理系统模板 · 第二层叠加引擎
 *
 * 位置：跑在 NuxtTemplate 的五阶段初始化**之后**。第一段（`pnpm dev` → `/setup`）
 * 产出干净的基线工程与 `template.config.json`；本脚本按其中的 `selection.ui`
 * 挑一套视图层，与公共逻辑层一起叠加进产物。
 *
 * 四阶段：plan → snapshot → apply → verify
 * （**没有 install**：本模板不引入任何新依赖，依赖变更一律交给 NuxtTemplate。
 *   没有依赖变更就没有「配置声明了模块、模块还没装」的危险窗口。）
 *
 * 与第一段的三条关键差异：
 *   ① 不改任何配置文件 —— 本模板写的全是「整份属于自己的文件」；
 *      没有 marker 区间，幂等就是「同名覆盖后逐字节相同」，极简单。
 *   ② 源目录结构 == 目标结构（`skeleton/<ui>/app/layouts/default.vue` → `app/layouts/default.vue`），
 *      没有映射表，少一层映射就少一个「表里写了、目录忘了建」的静默失败点。
 *   ③ 内容未变的文件**不写**。这是「换栈只动视图层 6 个文件」这条判据（V4）能
 *      用 `git status --short` 直接验收的前提。
 *
 * CLI：
 *   node scripts/admin-init.mjs --dry-run          只打印计划，不落盘
 *   node scripts/admin-init.mjs                    叠加（按 template.config.json 的档位）
 *   node scripts/admin-init.mjs --ui <id>          用指定档位覆盖（中途换栈，不动依赖）
 *   node scripts/admin-init.mjs --check            四项断言（CI 门禁）
 *   附加：--root <dir>、--json-lines、--rollback、--help
 *
 * 自测友好性沿用第一段的约定：导出 runCli(argv) 返回退出码而**不自己 process.exit**，
 * 这样可以用同一个进程直接驱动它（受限环境里 spawnSync 常直接失败）。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

/** 档位 id —— 与 server/utils/wizard/options.json 的 ui 组一一对应，也等于 skeleton/ 下的目录名 */
const UI_IDS = ['none', 'element-plus', 'ant-design-vue', 'nuxt-ui', 'vuetify'];

const CONFIG_FILE = 'template.config.json';
const RECORD_FILE = 'admin.config.json';
const BACKUP_ROOT = '.init-backup';

/**
 * 共享层从哪来：源目录 → 目标目录前缀 + 归属层。
 *
 * 为什么源目录叫 `overlay/` 而不是 `shared/`：
 * 第一段生成的 `.nuxt/tsconfig.shared.json` 把 `../shared/**\/*` 列进了 `include`，
 * 且 `~/*` 指向 `../app/*`。若把这 10 个用 `~/…` 互相引用的 .ts 放进 `shared/`，
 * 模板仓库**自身**的 `pnpm typecheck` 会因解析不到 `~/config/env` 而变红。
 * `overlay/` 不被任何生成的 tsconfig 引用，也不在引导器白名单里，第一段不会碰它。
 */
const SHARED_SOURCES = [
  { dir: 'overlay/app', prefix: 'app', layer: 'logic' }, // 公共逻辑层 10 个
  { dir: 'overlay/server', prefix: 'server', layer: 'api' }, // 演示接口 6 个
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
const BASELINE_FILES = ['app/app.vue'];

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
const SIGNATURE = {
  'element-plus': { hit: /<(?:el-|ElMessage)/, miss: /<(?:a-|v-|U[A-Z])/ },
  'ant-design-vue': { hit: /<(?:a-|message\b)/, miss: /<(?:el-|v-|U[A-Z])/ },
  'nuxt-ui': { hit: /<U[A-Z]|useToast\(/, miss: /<(?:el-|a-|v-)/ },
  vuetify: { hit: /<v-/, miss: /<(?:el-|a-|U[A-Z])/ },
  none: { hit: /<style scoped>/, miss: /<(?:el-|a-|v-|U[A-Z])/ },
};

/** C3 的扫描面：逻辑层目录（`app/app.vue` 不在这些目录里，它也没有 import） */
const LOGIC_DIRS = [
  'app/config',
  'app/composables',
  'app/middleware',
  'app/utils',
  'app/types',
];

/** C3 的 UI 依赖关键词。与 Architecture 第 4 节的「额外依赖」一一对应。 */
const UI_IMPORT_RE = /(?:from\s*['"](?:element-plus|@element-plus\/[^'"]+|ant-design-vue|@ant-design\/[^'"]+|@nuxt\/ui|vuetify|vuetify-nuxt-module)['"])|(?:require\(\s*['"](?:element-plus|ant-design-vue|@nuxt\/ui|vuetify)['"])/;

/**
 * 各档视图层用到、但**不在 NuxtTemplate 依赖映射表里**的包。
 * 引擎只提示、不安装：这些不是「初始化的选择」，而是「后续按需加的」。
 */
const EXTRA_DEPS = {
  none: [],
  'element-plus': [
    { pkg: '@element-plus/icons-vue', dev: true, why: '视图层的 el-icon 用它', required: false },
  ],
  'ant-design-vue': [
    { pkg: '@ant-design/icons-vue', dev: true, why: '菜单/按钮图标', required: false },
  ],
  'nuxt-ui': [
    { pkg: '@iconify-json/lucide', dev: true, why: 'UIcon 的图标来源', required: false },
  ],
  vuetify: [
    { pkg: '@mdi/font', dev: false, why: 'Vuetify 默认图标集是 mdi，不装 v-icon 显示为空白', required: true },
    { pkg: 'vuetify-nuxt-module', dev: true, why: '第一段已装；此处仅提醒它仍是 rc 线', required: false },
  ],
};

const ADMIN_TEMPLATE_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// 基础设施
// ─────────────────────────────────────────────────────────────────────────────

const EOL_RE = /\r\n|\n|\r/;
const splitLines = text => text.split(EOL_RE);

/** 仓库内前缀校验：越界一律抛错（与第一段的 safeJoin 同源，两处都要防越界） */
function safeJoin(root, rel) {
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
 * 注意与 Bootstrap 页里那份节选的差异：这里多一个 `prefix` 参数。
 * 因为 `overlay/app/` 的**内容**要落到产物的 `app/` 下（源目录里没有 app/ 这一层），
 * 若按「相对源目录」取键，会得到 `config/env.ts` 这种丢掉 `app/` 前缀的错路径。
 * 有了 prefix 之后两条规则仍然成立：
 *   · 源目录结构 == 目标结构（prefix 之下的部分）
 *   · 想加一档只需建目录，不需要改任何映射表
 */
function expand(root, srcDir, prefix = '') {
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
 *   ② 没有它，用户可能在引导器自删前就跑了本脚本，之后第一段的 apply
 *      会把 `app/pages/index.vue` 覆盖回引导期版本，把守卫的入口换掉。
 *   ③ 没有它，`skeleton/<非法值>/` 不存在，报错信息里只有路径、没有「你该选哪一档」。
 */
function precondition(root) {
  const problems = [];

  const cfgAbs = safeJoin(root, CONFIG_FILE);
  if (!existsSync(cfgAbs)) {
    problems.push(`缺少 ${CONFIG_FILE} —— 请先完成 NuxtTemplate 初始化（pnpm dev → /setup）`);
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
    problems.push(`template.config.json 的 ui 取值非法：「${ui}」（合法值：${UI_IDS.join(' / ')}）`);
  }

  return { problems, cfg };
}

// ─────────────────────────────────────────────────────────────────────────────
// plan
// ─────────────────────────────────────────────────────────────────────────────

function plan(root, requestedUi) {
  const { problems, cfg } = precondition(root);
  if (problems.length) {
    const err = new Error(problems.join('\n  '));
    err.problems = problems;
    throw err;
  }

  const ui = requestedUi ?? cfg.selection.ui;
  if (!UI_IDS.includes(ui)) throw new Error(`未知 UI 档位：${ui}（合法值：${UI_IDS.join(' / ')}）`);

  const buckets = { baseline: new Map() };
  for (const src of SHARED_SOURCES) buckets[src.layer] = expand(root, src.dir, src.prefix);

  // 把「覆盖基线」从逻辑层里摘出来：它要单独计数，才说得清「逻辑层 10 个」这句话
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

  const overwritten = willWrite.filter(rel => existsSync(safeJoin(root, rel)));

  return { ui, upstreamUi: cfg.selection.ui, buckets, files, content, willWrite, skipped, overwritten };
}

// ─────────────────────────────────────────────────────────────────────────────
// snapshot
// ─────────────────────────────────────────────────────────────────────────────

/** 只快照将被覆盖的文件：新增文件回滚时直接删即可，不必先复制一份 */
function snapshot(root, overwritten) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = safeJoin(root, `${BACKUP_ROOT}/${stamp}-admin`);
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

// ─────────────────────────────────────────────────────────────────────────────
// apply
// ─────────────────────────────────────────────────────────────────────────────

/** 逐文件写入：先写临时文件再改名，避免写一半被中断留下半截文件 */
function apply(root, content, willWrite, report) {
  for (const rel of willWrite) {
    const abs = safeJoin(root, rel);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.admintmp`;
      writeFileSync(tmp, content.get(rel), 'utf8');
      rmIfExists(abs); // unlinkSync，不用 rm(recursive)
      renameSync(tmp, abs);
      report.written.push(rel);
    }
    catch (err) {
      report.failed.push({ path: rel, reason: err.code ?? err.message });
    }
  }
}

function rmIfExists(abs) {
  if (existsSync(abs)) unlinkSync(abs);
}

/** 收尾：写产物记录。它是 --check 的唯一输入，也是「这批文件是谁写的」的凭证。 */
function writeRecord(root, planResult, report, backupDir) {
  const config = {
    schemaVersion: '1.0.0',
    adminTemplateVersion: ADMIN_TEMPLATE_VERSION,
    appliedAt: new Date().toISOString(),
    ui: planResult.ui, // 本次实际生效的档位
    upstreamSelectionUi: planResult.upstreamUi, // 上游选择页选的档位，用于检测两者不一致
    layer: {
      logic: [...planResult.buckets.logic.keys()].sort(),
      api: [...planResult.buckets.api.keys()].sort(),
      view: [...planResult.buckets.view.keys()].sort(),
      baseline: [...planResult.buckets.baseline.keys()].sort(),
    },
    overwritten: report.written.filter(rel => report.existedBefore.includes(rel)),
    skipped: [...report.skipped].sort(),
    backup: backupDir ? relative(root, backupDir).split('\\').join('/') : null,
  };
  writeFileSync(safeJoin(root, RECORD_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// verify（--check）
// ─────────────────────────────────────────────────────────────────────────────

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return (text.match(g) ?? []).length;
}

/** C3：逻辑层不许 import 任何 UI 库 */
function scanLogicUiImports(root) {
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

function verify(root) {
  const results = [];
  const recordAbs = safeJoin(root, RECORD_FILE);

  // ── 准备：没有产物记录就没法验 ──────────────────────────────────────────
  if (!existsSync(recordAbs)) {
    results.push({ id: 1, ok: false, label: '文件齐全', detail: `缺少 ${RECORD_FILE} —— 请先跑 node scripts/admin-init.mjs` });
    results.push({ id: 2, ok: false, label: '框架标签一致', detail: '跳过（无产物记录）' });
    results.push({ id: 3, ok: false, label: '逻辑层无 UI 依赖', detail: '跳过（无产物记录）' });
    results.push({ id: 4, ok: false, label: '档位与上游一致', detail: '跳过（无产物记录）' });
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

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────────────

function makeSink(argv) {
  const jsonLines = argv.includes('--json-lines');
  return {
    jsonLines,
    emit(type, payload) {
      if (jsonLines) console.log(JSON.stringify({ type, ...payload }));
      else if (type === 'text') console.log(payload.text);
    },
    text(text = '') {
      this.emit('text', { text });
    },
  };
}

function printExtraDeps(sink, ui) {
  const deps = EXTRA_DEPS[ui] ?? [];
  if (!deps.length) return;
  for (const d of deps) {
    const flag = d.required ? '（必需）' : '';
    sink.text(`  NOTE  该档视图层用到 ${d.pkg}${flag}：${d.why}`);
    sink.text(`        pnpm add ${d.dev ? '-D ' : ''}${d.pkg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runCli
// ─────────────────────────────────────────────────────────────────────────────

export function runCli(argv = process.argv.slice(2)) {
  const sink = makeSink(argv);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : process.cwd();

  if (argv.includes('--help') || argv.includes('-h')) {
    sink.text('');
    sink.text('  node scripts/admin-init.mjs [选项]');
    sink.text('');
    sink.text('  --dry-run          只打印计划，不写任何文件');
    sink.text('  --ui <id>          用指定档位覆盖（中途换栈，不动依赖）');
    sink.text('  --check            跑 C1~C4 四项断言（CI 门禁）');
    sink.text('  --rollback         从最近一次 -admin 快照还原');
    sink.text('  --root <dir>       指定仓库根目录（缺省为当前工作目录）');
    sink.text('  --json-lines       每行一条 JSON 事件');
    sink.text(`  档位取值：${UI_IDS.join(' / ')}`);
    sink.text('');
    return 0;
  }

  // ── --check ─────────────────────────────────────────────────────────────
  if (argv.includes('--check')) {
    const results = verify(root);
    for (const r of results) {
      sink.text(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.label}（${r.detail}）`);
    }
    const passed = results.filter(r => r.ok).length;
    sink.text(`admin-init: ${passed}/${results.length} 通过`);
    return passed === results.length ? 0 : 1;
  }

  // ── plan ────────────────────────────────────────────────────────────────
  const uiIdx = argv.indexOf('--ui');
  const requestedUi = uiIdx >= 0 ? argv[uiIdx + 1] : undefined;
  const dryRun = argv.includes('--dry-run');

  let planned;
  try {
    planned = plan(root, requestedUi);
  }
  catch (err) {
    sink.text('admin-init: 计划失败');
    for (const p of err.problems ?? [err.message]) sink.text(`  ${p}`);
    return 1;
  }

  const totalBytes = [...planned.content.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
  sink.text(`plan: 逻辑层 ${planned.buckets.logic.size} / 服务端 ${planned.buckets.api.size} / 视图层 ${planned.buckets.view.size} / 覆盖基线 ${planned.buckets.baseline.size}（ui=${planned.ui}，合计 ${totalBytes} 字节）`);
  if (planned.willWrite.length) {
    sink.text('  将写入：');
    for (const rel of planned.willWrite) sink.text(`    ${rel}`);
  }
  if (planned.overwritten.length) {
    sink.text(`  overwritten: ${planned.overwritten.join('、')}`);
  }
  if (planned.skipped.length) {
    sink.text(`  跳过（内容未变）：${planned.skipped.length} 个`);
  }
  printExtraDeps(sink, planned.ui);

  if (dryRun) {
    sink.text('admin-init: --dry-run 结束，未写任何文件');
    return 0;
  }

  // ── snapshot ────────────────────────────────────────────────────────────
  let backupDir = null;
  try {
    backupDir = snapshot(root, planned.overwritten);
  }
  catch (err) {
    sink.text(`admin-init: 快照失败：${err.message}`);
    return 1;
  }

  // ── apply ───────────────────────────────────────────────────────────────
  const report = {
    written: [],
    failed: [],
    skipped: [...planned.skipped],
    existedBefore: [...planned.overwritten],
  };
  apply(root, planned.content, planned.willWrite, report);

  // ── 收尾 ────────────────────────────────────────────────────────────────
  let record = null;
  try {
    record = writeRecord(root, planned, report, backupDir);
  }
  catch (err) {
    sink.text(`admin-init: 写 ${RECORD_FILE} 失败：${err.message}`);
    return 1;
  }

  const overwrittenNote = report.written.length
    ? `覆盖 ${record.overwritten.length} 个${record.overwritten.length ? `（${record.overwritten.join('、')}）` : ''}`
    : '覆盖 0 个';
  sink.text(`admin-init: 写入 ${report.written.length} 个文件 / ${overwrittenNote} / 跳过 ${report.skipped.length} 个 / 失败 ${report.failed.length}`);
  if (backupDir) sink.text(`  快照：${relative(root, backupDir).split('\\').join('/')}`);
  if (report.failed.length) {
    for (const f of report.failed) sink.text(`  FAIL  ${f.path}（${f.reason}）`);
    return 1;
  }
  sink.text('  下一步：node scripts/admin-init.mjs --check');
  sink.text('          pnpm dev  →  http://localhost:3000/ 被守卫带到 /login');
  return 0;
}

/** 从最近一次 `*-admin` 快照还原（只还原快照里记过的文件） */
export function rollback(root = process.cwd()) {
  const base = safeJoin(root, BACKUP_ROOT);
  if (!existsSync(base)) throw new Error(`没有快照目录：${BACKUP_ROOT}`);

  const candidates = readdirSync(base).filter(n => n.endsWith('-admin')).sort();
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

/** 只删「读起来是空的」目录 —— 递归删除会带走用户临时放的草稿 */
function pruneEmptyDirs(dir) {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

// ─────────────────────────────────────────────────────────────────────────────
// 直接运行
// ─────────────────────────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  if (process.argv.includes('--rollback')) {
    try {
      const r = rollback();
      console.log(`admin-init: 已从快照 ${r.snapshot} 还原 ${r.restored.length} 个文件`);
      for (const p of r.restored) console.log(`  ${p}`);
      process.exitCode = 0;
    }
    catch (err) {
      console.error(`admin-init: 回滚失败：${err.message}`);
      process.exitCode = 1;
    }
  }
  else {
    process.exitCode = runCli();
  }
}
