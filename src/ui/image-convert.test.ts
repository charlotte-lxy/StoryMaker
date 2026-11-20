// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { convertImageToPng } from './image-convert';

describe('convertImageToPng', () => {
  it('没有 createImageBitmap 的环境里返回 null，不抛错', async () => {
    expect(await convertImageToPng(new Uint8Array([1, 2, 3]), 'image/webp')).toBeNull();
  });
});
