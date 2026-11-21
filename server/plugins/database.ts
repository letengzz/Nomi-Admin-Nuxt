/**
 * 启动期数据库初始化。
 *
 * 「一开始的时候如果没数据库表则自动创建」就落在这一行上：Nitro 启动时
 * 建库、建表、灌种子，而不是等某个接口被调用时才懒加载。
 *
 * 用 void + catch 而不是 await：MySQL 没起的时候应用仍然要能启动 ——
 * 否则容器编排会一直重启，日志里看到的永远是「连接失败」而看不到原因。
 * 失败后每个接口在被调用时还会再试一次（ensureDatabase 内部会清缓存）。
 */
import { closePool } from '../database/pool';
import { ensureDatabase } from '../database/init';

export default defineNitroPlugin((nitroApp) => {
  void ensureDatabase().catch(() => undefined);

  nitroApp.hooks.hook('close', () => {
    void closePool();
  });
});
