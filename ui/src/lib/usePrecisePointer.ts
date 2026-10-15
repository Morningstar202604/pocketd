import { useEffect, useState } from 'react';

/**
 * 是否有精确指针（鼠标/触控板）+ 悬停能力。
 *
 * 用途：手机上没有 ⌘/Ctrl 键，界面上到处显示「⌘S」「⌘K」是在误导用户。
 * 快捷键本身仍然生效（接上蓝牙键盘时可用），只是不在触屏上做宣传。
 */
const QUERY = '(hover: hover) and (pointer: fine)';

function read(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function usePrecisePointer(): boolean {
  const [has, setHas] = useState(read);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setHas(mql.matches);
    // 外接键盘/鼠标会改变判定，所以监听而不只在挂载时读一次
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return has;
}
