// pocketd 应用外壳缓存。
//
// 策略要点（踩过的坑都写在这里，避免以后又改回去）：
//
//   1. /api 与 /ws 一律不拦截：工作区内容必须实时。预览路由 /preview 同理。
//   2. 导航请求（打开页面）走**网络优先**，离线才回退缓存的外壳。这样
//      `npm run build` 之后刷新一次就能拿到新界面。
//   3. 只有**文件名带内容哈希**的产物才允许缓存优先 —— 它们的内容由文件名决定，
//      命中缓存永远是对的。
//   4. manifest 和图标这类**非哈希资源必须网络优先**。曾经它们是缓存优先，
//      后果是：改了图标或 manifest，已经安装到桌面的实例会一直显示旧的，
//      而且现象是「我明明改了」—— 极难排查。整个缓存名跟着版本走也救不了，
//      因为那要靠人去记得改名字。
//   5. 非哈希资源在网络优先失败后仍写缓存，所以离线照样能用。
//
// 升级本文件时把 CACHE 版本号 +1，activate 会清掉旧缓存。

const CACHE = 'pocketd-shell-v3';

/** 预缓存的外壳：离线时至少要能打开界面 */
const SHELL = ['/', '/manifest.webmanifest'];

/** Vite 产物：basename-XXXXXXXX.ext，内容由文件名决定，可长期缓存 */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function shouldBypass(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws/') ||
    url.pathname.startsWith('/preview')
  );
}

/** 网络优先：拿到就顺手更新缓存；网络失败则回退缓存 */
async function networkFirst(request, fallbackKey) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(fallbackKey ?? request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (shouldBypass(url)) return;

  // 打开页面：必须拿到最新的外壳
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, '/'));
    return;
  }

  // 带内容哈希的产物：文件名即版本，缓存优先
  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
    return;
  }

  // 其余（图标、manifest、robots 等）：网络优先，离线才用缓存
  event.respondWith(networkFirst(req));
});
