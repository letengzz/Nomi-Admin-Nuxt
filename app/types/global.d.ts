/**
 * 编译期常量声明。
 *
 * 值由 nuxt.config.ts 的 `vite.define` 注入，属于 Vite 的 define 替换：
 * 源码里出现 `__APP_VERSION__` 的地方会在打包时被替换成字面量，
 * 所以这里必须用 `declare const`，不能写成可赋值的 let。
 */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
