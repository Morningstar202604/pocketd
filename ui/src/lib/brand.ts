/**
 * 品牌标识的唯一真相源（界面侧）。
 * 服务端侧对应 src/agent/brand.ts；两边关键的共享值有测试断言一致。
 */
export const BRAND = {
  id: 'pocketd',
  name: 'pocketd',
  nameZh: '口袋守护',
  tagline: '口袋里的编码 agent',
  /** 版本号仅用于展示 */
  version: '1.0.0',
} as const;

/**
 * localStorage 键的统一入口：优先新键，缺失时读旧键并迁移。
 * 不做这一步，老用户的会话历史、主题、设置会在改名的瞬间全部看起来「消失」。
 */
const KEY_PREFIX = BRAND.id;
const LEGACY_PREFIX = 'zcode';

function legacyKey(key: string): string {
  return key.replace(KEY_PREFIX, LEGACY_PREFIX);
}

export function readStored(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey(key));
    if (legacy === null) return null;
    // 迁移一次：写回新键，之后不再依赖旧键
    localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式或配额满：不影响本次会话 */
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
    localStorage.removeItem(legacyKey(key));
  } catch {
    /* 同上 */
  }
}

/** 集中定义所有键，避免各处硬编码字符串 */
export const STORAGE_KEYS = {
  theme: `${KEY_PREFIX}-theme`,
  sessions: `${KEY_PREFIX}-sessions`,
  activeRun: `${KEY_PREFIX}-active-run`,
  config: `${KEY_PREFIX}-config`,
  usage: `${KEY_PREFIX}-usage`,
  onboarded: `${KEY_PREFIX}-onboarded`,
  showHidden: `${KEY_PREFIX}-show-hidden`,
} as const;
