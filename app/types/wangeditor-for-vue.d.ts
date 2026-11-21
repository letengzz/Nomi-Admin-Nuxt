/**
 * @wangeditor/editor-for-vue 的类型补丁。
 *
 * 包里其实带了 .d.ts（dist/src/index.d.ts），但它的 package.json "exports"
 * 没有把 types 暴露出来，`moduleResolution: bundler` 下 TS 找不到，
 * 于是 NomiRichEditor.vue 的 import 变成 any 并报 TS7016。
 *
 * 这里按包的真实导出补一份最小声明：只声明我们用到的 Editor / Toolbar。
 * 不用 `declare module '@wangeditor/editor-for-vue'` 整包 any —— 那样连
 * 组件 props 都不校验，写错 v-model 也不会报错。
 */
declare module '@wangeditor/editor-for-vue' {
  import type { DefineComponent } from 'vue';

  /** 编辑器主体。v-model 绑定 HTML 字符串，其余配置走 editorConfig / defaultConfig。 */
  export const Editor: DefineComponent<Record<string, unknown>>;
  /** 工具栏。需要 editor 实例（shallowRef）配合 defaultConfig 使用。 */
  export const Toolbar: DefineComponent<Record<string, unknown>>;
}
