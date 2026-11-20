/**
 * webp → PNG。
 *
 * UE 不认 webp（硬把 .webp 改名成 .png 会报「纹理拥有零宽度或高度」），
 * 所以素材文件夹里只该有 PNG。上传时选到 webp，就在渲染进程里解码
 * （渲染进程就是 Chromium，能解 webp）再画到 canvas 导出 PNG。
 *
 * 没有 canvas / createImageBitmap 的环境（比如测试用的 jsdom）返回 null，
 * 由调用方给出「转不了」的提示，不会静默失败。
 */

export async function convertImageToPng(
  data: Uint8Array,
  mime: string,
): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

  const blob = new Blob([data.slice().buffer], { type: mime });
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (bitmap === null) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (png === null) return null;

    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close?.();
  }
}
