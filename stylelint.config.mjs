/**
 * Stylelint 配置。
 *
 * 这一个文件被 Sass 与 Less 两个选项共用 —— 引擎按所选预处理器把 extends 里的
 * 生态配置换成对应的那一项（stylelint-config-standard-scss / -standard-less）。
 * 没有这一层就得维护两个只差一行的文件，而「只差一行」正是最容易漂移的那种重复。
 *
 * 注意本配置只覆盖独立的样式文件（.css/.scss/.less）。要连 .vue 里的
 * <style> 一起检查，需要额外装 postcss-html 并在这里加 customSyntax ——
 * 那是另一件事，模板不替你决定。
 */
export default {
  extends: ['stylelint-config-standard', 'stylelint-config-standard-scss'],
  rules: {
    // 令牌层故意用空行与注释分隔变量分组，这些规则会与它冲突
    'custom-property-empty-line-before': null,
    'scss/dollar-variable-empty-line-before': null,
    'scss/comment-no-empty': null,
    // Vue 的 :deep() / :slotted() 会被默认规则误判为未知伪类
    'selector-pseudo-class-no-unknown': [
      true,
      {
        ignorePseudoClasses: ['deep', 'slotted', 'global'],
      },
    ],
    // 空文件里的注释块不该报错
    'no-empty-source': null,
    // WebKit 的文本缩放控制需要保留前缀，否则 iOS Safari 不生效
    'property-no-vendor-prefix': [
      true,
      {
        ignoreProperties: ['-webkit-text-size-adjust'],
      },
    ],
    // 类名用 BEM：`.nomi-grid--4`（修饰符）与 `.el-input__wrapper`（元素）
    // 都会被默认的 kebab-case 判错，而后者是 Element Plus 自己的命名，改不了。
    // 这条规则仍然在管「别写 .FooBar / .foo_bar」，只是把 `__` `--` 放行。
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$',
      { resolveNestedSelectors: true },
    ],
    // 断点继续写 `max-width`：区间写法 (width <= 1180px) 要 Safari 16.4+，
    // 旧 iPad 会把整条媒体查询当未知语法丢掉 —— 布局全崩，比写法「过时」严重。
    'media-feature-range-notation': 'prefix',
    // Vue 的动画类按「一行一个状态」排（enter-from / leave-to 对照着看），
    // 拆成多行会让 4 行状态机变成 16 行，反而看不出配对关系。
    'declaration-block-single-line-max-declarations': null,
  },
  ignoreFiles: [
    '**/node_modules/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/dist/**',
    // 初始化引擎的源模板包含 {{占位符}}，不能作为当前应用配置或样式解析
    '**/scripts/templates/**',
  ],
};
