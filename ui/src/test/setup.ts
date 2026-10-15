import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom 不实现这些浏览器 API，组件里有真实依赖，补上最小可用替身
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom 不实现滚动 API，而聊天面板每次渲染都会滚到底部
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// dialog 的 showModal/close 在 jsdom 里也缺失（若将来用原生 <dialog>）
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}

// fetch 默认替身：测试各自覆盖；未覆盖时返回 404，避免误连真实服务
if (!globalThis.fetch || !('mockImplementation' in (globalThis.fetch as object))) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ error: '测试未设置 fetch 替身' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}
