/**
 * 启动期数据库初始化。
 *
 * 「一开始的时候如果没数据库表则自动创建」就落在这一行上：Nitro 启动时
 * 建库、建表、灌种子，而不是等某个接口被调用时才懒加载。
 *
 * 用 void + catch 而不是 await：MySQL 没起的时候应用仍然要能启动 ——
 * 否则容器编排会一直重启，日志里看到的永远是「连接失败」而看不到原因。
 * 失败后每个接口在被调用时还会再试一次（ensureDatabase 内部会清缓存）。
 *
 * **演示构建不连库**（NUXT_PUBLIC_DEMO=1）：`nuxt generate` 会把 Nitro 跑一遍
 * 用于预渲染，但产出的静态目录里根本没有服务端，建表灌种子既没有意义，
 * 连接池还会一直挂在那里 —— 本机能连上库时进程退不掉，CI 上连不上库时
 * 要么等超时、要么真的把数据写进了不该写的库。两件事都不该由一次「出静态包」
 * 的构建来触发，所以这里直接短路。
 */
import { closePool } from '../database/pool';
import { ensureDatabase } from '../database/init';

/** 与 nuxt.config.ts 的 runtimeConfig.public.demo 同一个开关。 */
const DEMO_BUILD = process.env.NUXT_PUBLIC_DEMO === '1';

export default defineNitroPlugin((nitroApp) => {
  if (DEMO_BUILD) return;

  void ensureDatabase().catch(() => undefined);

  nitroApp.hooks.hook('close', () => {
    void closePool();
  });
});
