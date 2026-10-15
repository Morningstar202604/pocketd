/**
 * 品牌标识的唯一真相源（服务端侧）。
 *
 * 换名前这些字符串散落在 20 多个文件里，改名要全文搜索、容易漏。
 * 现在改这里即可 —— 界面侧对应的是 ui/src/lib/brand.ts，两边关键的共享值
 * 有测试断言一致（见 tests/brand-assets.test.ts）。
 */

export const BRAND = {
  /** 英文名：同时用作包名、环境变量前缀、目录名 */
  id: "pocketd",
  /** 展示名 */
  name: "pocketd",
  /** 中文名 */
  nameZh: "口袋守护",
  /** 一句话说明 */
  tagline: "口袋里的编码 agent",
  /** 环境变量前缀（旧前缀 ZCODE_ 仍会被读取，见 envValue） */
  envPrefix: "POCKETD",
  /** 旧前缀：用于无损回退 */
  legacyEnvPrefix: "ZCODE",
  /** 数据目录名（旧目录 .zcode 仍会被沿用，见 resolveHomeDir） */
  homeDirName: ".pocketd",
  legacyHomeDirName: ".zcode",
  /** 工作区内回收站目录（新旧都会读取） */
  trashDirName: ".pocketd-trash",
  legacyTrashDirName: ".zcode-trash",
  /** 工作区忽略规则文件名（.gitignore 始终会被读取，见 ignore.ts） */
  ignoreFileName: ".pocketdignore",
  legacyIgnoreFileName: ".zcodeignore",
  /** 访问令牌的 Cookie 名（旧名仍会被接受一次，避免局域网用户被迫重新认证） */
  tokenCookie: "pocketd_token",
  legacyTokenCookie: "zcode_token",
  /** 运行 id 的响应头 */
  runIdHeader: "x-pocketd-run-id",
  /** 仓库地址（发布前请替换 your-org） */
  repoUrl: "https://github.com/your-org/pocketd",
  license: "MIT",
} as const;

/**
 * 读取配置：优先新前缀，回退旧前缀。
 * 这样已经在用 ZCODE_* 的环境变量的人不需要改任何东西。
 */
export function envValue(key: string): string | undefined {
  const next = process.env[`${BRAND.envPrefix}_${key}`];
  if (next !== undefined && next !== "") return next;
  const legacy = process.env[`${BRAND.legacyEnvPrefix}_${key}`];
  return legacy !== undefined && legacy !== "" ? legacy : undefined;
}
