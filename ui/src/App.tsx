import { useEffect, useCallback } from 'react';
import { useStore } from './store';
import { TopBar } from './components/TopBar';
import { FilePanel } from './components/FilePanel';
import { EditorArea } from './components/EditorArea';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { ModelDrop } from './components/ModelDrop';
import { Onboarding } from './components/Onboarding';
import { MobileNav } from './components/MobileNav';
import { Toast } from './components/Toast';
import { DialogHost } from './components/Dialog';
import { isDialogOpen } from './lib/dialog';
import { readStored, STORAGE_KEYS } from './lib/brand';

export default function App() {
  const store = useStore();
  const { init, apiConfig, onboardOpen, setOnboard, cmdPalOpen, modelDropOpen,
    setCmdPal, setSettings, saveActive, toggleFilesPanel, setRightTab,
    newSession, showToast, settingsOpen, setModelDrop, mobileView, theme, createFile } = store;

  useEffect(() => { init(); }, [init]);

  /* ── 主题色同步：浏览器 UI（地址栏/状态栏）跟随应用主题 ── */
  useEffect(() => {
    const color = theme === 'light' ? '#ffffff' : '#17181b';
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', color);
      // 去掉 media 限定，避免系统主题与应用主题不一致时被媒体查询覆盖
      meta.removeAttribute('media');
    }
  }, [theme]);

  /* ── Android 硬件返回键处理 ── */
  useEffect(() => {
    const handleBack = () => {
      // 优先关闭弹窗/面板，最后才让系统处理返回
      if (isDialogOpen()) return;
      if (cmdPalOpen) { setCmdPal(false); return; }
      if (modelDropOpen) { setModelDrop(false); return; }
      if (settingsOpen) { setSettings(false); return; }
      if (onboardOpen) { setOnboard(false); return; }
    };
    window.addEventListener('androidback', handleBack);
    return () => window.removeEventListener('androidback', handleBack);
  }, [cmdPalOpen, modelDropOpen, settingsOpen, onboardOpen, setCmdPal, setModelDrop, setSettings, setOnboard]);

  useEffect(() => {
    if (!readStored(STORAGE_KEYS.onboarded) && !apiConfig.apiKey) {
      const timer = setTimeout(() => setOnboard(true), 800);
      return () => clearTimeout(timer);
    }
  }, [apiConfig.apiKey, setOnboard]);

  /* ── 全局快捷键 ── */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const k = e.key.toLowerCase();
    // 对话框打开时吞掉快捷键，避免"确认弹窗里按 ⌘S"这类串扰
    if (isDialogOpen()) return;
    // 不要让快捷键在输入框中触发
    const tag = (e.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

    if (k === 'k') { e.preventDefault(); if (!inInput) setCmdPal(!cmdPalOpen); }
    else if (k === 's') { e.preventDefault(); if (!inInput) saveActive(); }
    else if (k === 'b') { e.preventDefault(); if (!inInput) toggleFilesPanel(); }
    else if (k === 'j') { e.preventDefault(); if (!inInput) setRightTab('terminal'); }
    else if (k === 't' && !e.shiftKey) { e.preventDefault(); if (!inInput) newSession(); }
    else if (k === 'f' && e.shiftKey) { e.preventDefault(); if (!inInput) setRightTab('search'); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); if (!inInput) createFile(); }
    else if (k === 'escape') {
      setCmdPal(false);
      setModelDrop(false);
      // 窄屏的文件抽屉也用 Escape 关，和弹层保持一致的键盘习惯
      if (useStore.getState().filesPanelOpen && typeof window !== 'undefined' && window.innerWidth <= 768) {
        toggleFilesPanel();
      }
    }
  }, [cmdPalOpen, setCmdPal, saveActive, toggleFilesPanel, setRightTab, newSession, setModelDrop, createFile]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  /* ── 网络断连检测 + 恢复提示 ── */
  useEffect(() => {
    const onOffline = () => showToast('⚠ 已离线，部分功能不可用', 'warning');
    const onOnline = () => showToast('✓ 网络已恢复', 'ok');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, [showToast]);

  /* ── 自动保存: 关屏/杀进程前紧急保存 (防数据丢失) ── */
  useEffect(() => {
    const save = () => useStore.getState().saveActive();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('app-pause-sync', save); // Capacitor App 插件
    window.addEventListener('pagehide', save);       // 关闭/切换应用
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('app-pause-sync', save);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /* ── 点击空白关闭 ModelDrop ── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (modelDropOpen && !target.closest('[data-model-drop]') && !target.closest('[data-model-chip]')) {
        setModelDrop(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [modelDropOpen, setModelDrop]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: "var(--bg)" }}>
      <TopBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }} data-mobile-view={mobileView}>
        <FilePanel />
        <EditorArea />
        <RightPanel />
      </div>
      <MobileNav />
      {cmdPalOpen && <CommandPalette />}
      {modelDropOpen && <ModelDrop />}
      {onboardOpen && <Onboarding />}
      <SettingsModal />
      <DialogHost />
      <Toast />
    </div>
  );
}
