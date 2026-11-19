/**
 * 素材文件 → Blob 的两个小工具。
 *
 * 素材管理（立绘 / 音效表）和剧情预览都要把主进程读回来的字节包成带类型的 Blob，
 * 放在这里共用一份扩展名表，免得两处各写一遍、哪天只改了一边。
 */

/** 按扩展名给 MIME：Blob 不带类型的话，浏览器对 tga 之类会直接拒掉 */
export function mimeOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const extension = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    default:
      return '';
  }
}

/** 浏览器显示不了 tga，只能提示去 UE 里看 */
export function canPreviewImage(fileName: string): boolean {
  return /\.(png|jpe?g)$/i.test(fileName);
}

/** 把 IPC 传回来的字节包成带类型的 Blob；复制一份是为了拿到确定的 ArrayBuffer */
export function blobOf(data: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}
