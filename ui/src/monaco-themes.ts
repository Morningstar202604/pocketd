/**
 * Monaco 主题定义。Monaco 不读 CSS 变量，必须用 JS 定义者；
 * 这里的色值对应 index.css 里的 token，改一处需同步另一处。
 */
export const MONACO_DARK = 'pocketd-dark';
export const MONACO_LIGHT = 'pocketd-light';

interface MonacoLike {
  editor: {
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
  };
}

export function definePocketdThemes(monaco: MonacoLike): void {
  monaco.editor.defineTheme(MONACO_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff7b72' },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'type', foreground: 'ffa657' },
      { token: 'function', foreground: 'd2a8ff' },
      { token: 'variable', foreground: '7ee787' },
    ],
    colors: {
      'editor.background': '#17181b',
      'editor.foreground': '#e8e8ea',
      'editorLineNumber.foreground': '#5b5d63',
      'editorLineNumber.activeForeground': '#b8b8bd',
      'editor.lineHighlightBackground': '#222327',
      'editor.selectionBackground': '#1d4ed880',
      'editorCursor.foreground': '#4f8cff',
      'editorIndentGuide.background1': '#2a2c31',
      'editorIndentGuide.activeBackground1': '#474a51',
      'editorWidget.background': '#1e1f23',
      'editorWidget.border': '#33363b',
      'editorSuggestWidget.selectedBackground': '#2a2c31',
      'scrollbarSlider.background': '#474a5180',
      'scrollbarSlider.hoverBackground': '#5a5d65c0',
      'editorBracketMatch.background': '#4f8cff30',
      'editorBracketMatch.border': '#4f8cff',
    },
  });

  monaco.editor.defineTheme(MONACO_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf222e' },
      { token: 'string', foreground: '0a3069' },
      { token: 'number', foreground: '0550ae' },
      { token: 'type', foreground: '953800' },
      { token: 'function', foreground: '8250df' },
      { token: 'variable', foreground: '116329' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#16171a',
      'editorLineNumber.foreground': '#8c8e94',
      'editorLineNumber.activeForeground': '#4a4c52',
      'editor.lineHighlightBackground': '#f4f5f7',
      'editor.selectionBackground': '#cce0ff',
      'editorCursor.foreground': '#1e5ede',
      'editorIndentGuide.background1': '#e2e5ea',
      'editorIndentGuide.activeBackground1': '#bcbfc7',
      'editorWidget.background': '#f4f5f7',
      'editorWidget.border': '#d5d9e0',
      'editorSuggestWidget.selectedBackground': '#e2e5ea',
      'scrollbarSlider.background': '#bcbfc780',
      'scrollbarSlider.hoverBackground': '#8a8c94c0',
      'editorBracketMatch.background': '#1e5ede25',
      'editorBracketMatch.border': '#1e5ede',
    },
  });
}
