#!/usr/bin/env node
/**
 * 后台骨架层的命令行入口（薄壳）。
 *
 * 正常情况下**你不需要跑它**：初始化引擎的第 5 阶段会自动叠加后台骨架
 * （`pnpm dev` → 选技术栈 → 点「初始化项目」→ 直接落到后台登录页）。
 * 这个脚本存在的意义是另外三件事：
 *
 *   · `--check`    复核产物（C1~C5）—— CI 门禁与「刚才那次初始化到底对不对」
 *   · `--ui <id>`  中途换栈：同名覆盖视图层那几个文件（**依赖要自己换**，见 Verify 页）
 *   · `--rollback` 从最近一次 `*-admin` 快照还原
 *
 * 真正的逻辑在 `scripts/lib/admin-layer.mjs`：初始化引擎与这里读同一份代码，
 * 两处各写一份的话，迟早出现「初始化叠出来的是 A 档、`--check` 按 B 档验」。
 *
 * 自测友好性沿用第 1 段的约定：导出 runCli(argv) 返回退出码而**不自己 process.exit**，
 * 这样可以用同一个进程直接驱动它（受限环境里 spawnSync 常直接失败）。
 */
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXTRA_DEPS,
  RECORD_FILE,
  UI_IDS,
  applyAdmin,
  planAdmin,
  planSummary,
  rollbackAdmin,
  snapshotAdmin,
  verifyAdmin,
  writeAdminRecord,
} from './lib/admin-layer.mjs';

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
  const deps = (EXTRA_DEPS[ui] ?? []).filter((d) => d.required);
  for (const d of deps) {
    // 这里**不**打印 `pnpm add`：这些东西已经在 options.json 里声明过，
    // 由初始化的 install 阶段统一装。这里只是让「本档还有哪些按名字生效的资源」
    // 在日志里可见 —— 它们不出现在任何一行 import 里，出问题时最难联想到。
    sink.text(`  NOTE  ${ui} 档还用到 ${d.pkg}（不在 import 里，按名字生效）：${d.why}`);
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
    sink.text('  --check            跑 C1~C5 五项断言（CI 门禁）');
    sink.text('  --rollback         从最近一次 -admin 快照还原');
    sink.text('  --root <dir>       指定仓库根目录（缺省为当前工作目录）');
    sink.text('  --json-lines       每行一条 JSON 事件');
    sink.text(`  档位取值：${UI_IDS.join(' / ')}`);
    sink.text('');
    return 0;
  }

  // ── --check ─────────────────────────────────────────────────────────────
  if (argv.includes('--check')) {
    const results = verifyAdmin(root);
    for (const r of results) {
      sink.text(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.label}（${r.detail}）`);
    }
    const passed = results.filter((r) => r.ok).length;
    sink.text(`admin-init: ${passed}/${results.length} 通过`);
    return passed === results.length ? 0 : 1;
  }

  // ── plan ────────────────────────────────────────────────────────────────
  const uiIdx = argv.indexOf('--ui');
  const requestedUi = uiIdx >= 0 ? argv[uiIdx + 1] : undefined;
  const dryRun = argv.includes('--dry-run');

  let planned;
  try {
    planned = planAdmin(root, { ui: requestedUi });
  }
  catch (err) {
    sink.text('admin-init: 计划失败');
    for (const p of err.problems ?? [err.message]) sink.text(`  ${p}`);
    return 1;
  }

  const totalBytes = [...planned.content.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
  sink.text(`plan: ${planSummary(planned)}，合计 ${totalBytes} 字节`);
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
    backupDir = snapshotAdmin(root, planned.overwritten);
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
  applyAdmin(root, planned, report);

  // ── 收尾 ────────────────────────────────────────────────────────────────
  let record = null;
  try {
    record = writeAdminRecord(root, planned, report, backupDir);
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

// ─────────────────────────────────────────────────────────────────────────────
// 直接运行
// ─────────────────────────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  if (process.argv.includes('--rollback')) {
    const rootIdx = process.argv.indexOf('--root');
    const root = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : process.cwd();
    try {
      const r = rollbackAdmin(root);
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
