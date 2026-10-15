// 自托管 Monaco：默认实现会从 cdn.jsdelivr.net 拉编辑器内核，
// 这与"全部本地运行 / 零外部域名请求"的承诺冲突，且手机断网时编辑器直接加载不出来。
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json': return new jsonWorker();
      case 'css': case 'scss': case 'less': return new cssWorker();
      case 'html': case 'handlebars': case 'razor': return new htmlWorker();
      case 'typescript': case 'javascript': return new tsWorker();
      default: return new editorWorker();
    }
  },
};

loader.config({ monaco });
