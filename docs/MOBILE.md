# Mobile & Accessibility — pocketd

English | [中文](#移动适配与无障碍)

Mobile-first and inclusive by design.

---

## Layout Adaptations

### Bottom Tab Navigation

On viewports < 768px:
- Bottom 5-tab nav (Chat / Terminal / Git / Stats / Knowledge)
- Tab bar is fixed and respects `safe-area-inset-bottom`
- `MobileNav.tsx` handles tab switching + new-file action

### Panel Hiding

Right panel (chat/terminal/git/etc.) is hidden by default on mobile. Toggle via:
- `body.hide-right-panel` CSS class controls `.right-panel { display: none !important; }`
- Search panel has explicit "← 返回编辑器" button

### File Tree

On mobile the FilePanel is a toggleable slide-in overlay. TopBar hamburger button triggers `toggleFilesPanel()`.

## Touch Targets

All interactive elements meet **48×48dp minimum** per WCAG 2.5.8:

```css
/* Buttons, tab items, icon buttons */
min-height: 48px;
min-width: 48px;
```

The `MobileNav` tab bar items are 100% width × 48px height with centered icons.

## Safe Area

iOS notch / Android rounded corners handled via:

```css
body {
  padding-bottom: env(safe-area-inset-bottom, 0);
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
}
```

## Keyboard & Input

- `<textarea>` for chat input — no virtual keyboard issues
- `capture="environment"` attribute on camera input → opens rear camera
- `Ctrl+S` save, `Ctrl+K` command palette work with external keyboard on tablets

## Accessibility (WCAG AA)

### ARIA Attributes

All core interactive components carry ARIA:

| Component | Roles / Attributes |
|-----------|-------------------|
| `SettingsModal` | `role="dialog"`, `aria-modal` |
| `RightPanel` tabs | `role="tablist"`, `role="tab"`, `aria-selected` |
| `ModelDrop` | `role="combobox"`, `aria-expanded` |
| `CommandPalette` | `role="listbox"`, `role="option"` |
| `Toast` | `role="status"`, `aria-live="polite"` |
| `ChatPanel` log | `role="log"`, `aria-live="polite"` |
| `FilePanel` | `aria-label` on buttons |
| Quick prompts | `role="toolbar"` |

### Motion

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### Color Contrast

Theme variables (`--fg`, `--bg`, `--fg-muted`, `--fg-dim`) both tested for WCAG AA contrast ratios (≥4.5:1 for normal text, ≥3:1 for large text) against their respective backgrounds.

## Browser-Specific Notes

| Platform | Behavior |
|----------|----------|
| iOS Safari | `viewport-fit=cover` + `safe-area-inset-*` for notch/home-bar |
| Android Chrome | Full-screen PWA capable with `apple-mobile-web-app-capable` meta |
| Samsung Internet | Tested for compatibility |
| Desktop Chrome | Falls back to desktop layout (> 768px) |

## Performance Tips

1. **Monaco Editor** — single instance per tab, unloads on tab close
2. **SSE streaming** — no polling, only push
3. **CSS transitions** — GPU-accelerated `transform` / `opacity`
4. **No CSS-in-JS runtime** — zero runtime overhead

---

# 移动适配与无障碍

[English](#mobile--accessibility--pocketd) | 中文

## 布局适配

### 底部标签导航

< 768px 视口切换为底部 5 标签导航（对话 / 终端 / Git / 监控 / 知识库），标签栏固定并在底部保留 `safe-area-inset-bottom`。

### 面板切换

移动端右侧面板默认隐藏，通过 `body.hide-right-panel` CSS 类控制 `.right-panel { display: none !important; }`。搜索面板有"← 返回编辑器"按钮。

### 文件树

移动端文件树为可切换的侧边栏，通过顶栏汉堡按钮 `toggleFilesPanel()` 开关。

## 触摸目标

所有可交互元素满足 WCAG 2.5.8 标准的最小 **48×48dp** 触摸区域：

```css
/* Buttons, tab items, icon buttons */
min-height: 48px;
min-width: 48px;
```

底部导航按钮采用 100% 宽度 × 48 高度居中图标设计。

## 安全区适配

iOS 刘海 / 安卓圆角屏通过 `env(safe-area-inset-*)` 处理：

```css
body {
  padding-bottom: env(safe-area-inset-bottom, 0);
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
}
```

## 键盘与输入

- 聊天输入使用 `<textarea>` — 无虚拟键盘异常
- `capture="environment"` 属性触发后置摄像头
- `Ctrl+S` / `Ctrl+K` 外接键盘快捷键在平板上可用

## 无障碍 (WCAG AA)

### ARIA 属性

所有核心组件都标注 ARIA 语义：

| 组件 | Roles / 属性 |
|------|-------------|
| `SettingsModal` | `role="dialog"`, `aria-modal` |
| `RightPanel` tabs | `role="tablist"`, `role="tab"`, `aria-selected` |
| `ModelDrop` | `role="combobox"`, `aria-expanded` |
| `CommandPalette` | `role="listbox"`, `role="option"` |
| `Toast` | `role="status"`, `aria-live="polite"` |
| `ChatPanel` log | `role="log"`, `aria-live="polite"` |
| `FilePanel` | 按钮 `aria-label` |
| 快捷指令 | `role="toolbar"` |

### 动效

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 色彩对比度

主题变量（`--fg`, `--bg`, `--fg-muted`, `--fg-dim`）经过 WCAG AA 对比度校验（正常文本 ≥4.5:1，大文本 ≥3:1）。

## 性能要点

1. **Monaco Editor** — 每个标签页一个实例，关闭时卸载
2. **SSE 推送** — 无轮询，纯事件驱动
3. **CSS 过渡** — `transform` / `opacity` GPU 加速
4. **无 CSS-in-JS** — 零运行时开销
