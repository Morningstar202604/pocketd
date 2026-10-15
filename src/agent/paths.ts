/**
 * 路径解析的唯一真相源。
 *
 * 单独成模块是为了打断循环依赖：runtime.ts 需要 ignore.ts（遍历时过滤），
 * ignore.ts 需要工作区路径。放在这里两边都只是单向依赖。
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { BRAND, envValue } from "./brand.js";

const USER_HOME = process.env.HOME || process.env.USERPROFILE || homedir() || "/tmp";

/**
 * 数据目录：新名字不存在但旧目录存在时，**沿用旧目录**。
 * 改名不该让已有用户的密钥、会话库、MCP 配置和工作区凭空消失。
 */
function resolveHomeDir(): string {
  const next = join(USER_HOME, BRAND.homeDirName);
  if (existsSync(next)) return next;
  const legacy = join(USER_HOME, BRAND.legacyHomeDirName);
  if (existsSync(legacy)) {
    console.log(`[提示] 沿用已有数据目录 ${legacy}（如需迁移请手动改名，或删除后重新启动）`);
    return legacy;
  }
  return next;
}

export const HOME_DIR = resolveHomeDir();

export const WORKSPACE = resolve(envValue("WORKSPACE")?.trim() || join(HOME_DIR, "workspace"));

/** 工作区内的回收站：新旧目录都会读取，不迁移文件本身 */
export const TRASH_DIR = join(WORKSPACE, BRAND.trashDirName);
export const TRASH_DIRS = [TRASH_DIR, join(WORKSPACE, BRAND.legacyTrashDirName)];
