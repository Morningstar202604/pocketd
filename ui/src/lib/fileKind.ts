/** 文件类型判定与预览地址构造。集中在一处，避免扩展名列表散落各文件。 */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
const MARKDOWN_EXT = new Set(['md', 'markdown']);
const HTML_EXT = new Set(['html', 'htm']);

export type FileKind = 'image' | 'markdown' | 'html' | 'text';

export function extOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(path: string): FileKind {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (HTML_EXT.has(ext)) return 'html';
  return 'text';
}

/** 二进制/图片类文件不能按文本读取 */
export function isBinaryPreview(path: string): boolean {
  return fileKind(path) === 'image';
}

/** 原始字节地址：图片预览、下载都用它 */
export function rawFileUrl(path: string): string {
  return `/api/file/raw?path=${encodeURIComponent(path)}`;
}

/** 工作区预览地址：按静态站点的方式访问工作区里的文件 */
export function previewUrl(path = ''): string {
  const clean = path.replace(/^\/+/, '');
  return clean ? `/preview/${clean.split('/').map(encodeURIComponent).join('/')}` : '/preview/';
}
