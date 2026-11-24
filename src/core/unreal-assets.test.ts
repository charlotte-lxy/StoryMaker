import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface AssetCore {
  IMAGE_EXTENSIONS: string[];
  SOUND_EXTENSIONS: string[];
  FONT_EXTENSIONS: string[];
  KIND_FOLDERS: Record<'image' | 'sound' | 'font', string>;
  UPLOAD_IMAGE_EXTENSIONS: string[];
  allowedExtensions: (kind: 'image' | 'sound' | 'font') => string[];
  baseNameOf: (fileName: string) => string;
  kindOfFile: (fileName: string) => 'image' | 'sound' | 'font' | null;
  listAssetFiles: (
    folder: string,
  ) => Promise<Array<{ filePath: string; fileName: string; baseName: string; kind: string }>>;
  removeAssetFile: (filePath: string) => Promise<{ ok: boolean; message?: string }>;
  renameAssetFile: (options: {
    folder: string;
    oldId: string;
    newId: string;
    kind: 'image' | 'sound' | 'font';
  }) => Promise<{ ok: boolean; filePath?: string; message?: string }>;
  uploadAssetFile: (options: {
    folder: string;
    id: string;
    kind: 'image' | 'sound' | 'font';
    sourceFile: string;
    replace?: boolean;
  }) => Promise<{
    ok: boolean;
    filePath?: string;
    message?: string;
    requiresConversion?: boolean;
    sourcePath?: string;
  }>;
  writeAssetFile: (options: {
    folder: string;
    id: string;
    kind: 'image' | 'sound' | 'font';
    extension: string;
    data: Uint8Array;
    replace?: boolean;
  }) => Promise<{ ok: boolean; filePath?: string; message?: string }>;
}

const assets = require('../../electron/unreal-assets.cjs') as AssetCore;

/** 每个用例一个临时「素材文件夹」，跑完删掉 */
const created: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'smk-assets-test-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('素材文件的格式判断', () => {
  it('图片和音效各认自己的扩展名，大小写不敏感', () => {
    expect(assets.kindOfFile('a.PNG')).toBe('image');
    expect(assets.kindOfFile('a.jpg')).toBe('image');
    expect(assets.kindOfFile('a.wav')).toBe('sound');
    expect(assets.kindOfFile('a.ogg')).toBe('sound');
    // webp 只在「上传时可选」，素材文件夹里不算合法格式
    expect(assets.kindOfFile('a.webp')).toBeNull();
    expect(assets.kindOfFile('a.mp3')).toBeNull();
    expect(assets.kindOfFile('a.txt')).toBeNull();
    expect(assets.kindOfFile('没有扩展名')).toBeNull();
  });

  it('给文件选择框的扩展名列表不带点，图片多一个 webp', () => {
    expect(assets.allowedExtensions('image')).toEqual(['png', 'jpg', 'jpeg', 'tga', 'webp']);
    expect(assets.allowedExtensions('sound')).toEqual(['wav', 'ogg', 'flac']);
  });

  it('去掉扩展名时不影响带点的文件夹名', () => {
    expect(assets.baseNameOf('SCE_Black.png')).toBe('SCE_Black');
    expect(assets.baseNameOf('S_dididi.wav')).toBe('S_dididi');
  });

  it('字体认 ttf / otf，放进 Fonts 子文件夹', () => {
    expect(assets.kindOfFile('a.ttf')).toBe('font');
    expect(assets.kindOfFile('a.OTF')).toBe('font');
    expect(assets.allowedExtensions('font')).toEqual(['ttf', 'otf']);
    expect(assets.KIND_FOLDERS).toEqual({ image: 'Image', sound: 'Sound', font: 'Fonts' });
  });
});

describe('列素材文件夹', () => {
  it('递归扫子文件夹，只收图片与音效', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'SCE_Black.png'), 'x');
    writeFileSync(join(dir, 'S_dididi.wav'), 'x');
    writeFileSync(join(dir, '说明.txt'), 'x');
    mkdirSync(join(dir, '子文件夹'));
    writeFileSync(join(dir, '子文件夹', 'PIC_WEA_01.png'), 'x');

    const files = await assets.listAssetFiles(dir);
    expect(files.map((file) => file.fileName).sort()).toEqual([
      'PIC_WEA_01.png',
      'SCE_Black.png',
      'S_dididi.wav',
    ]);
    expect(files.find((file) => file.fileName === 'SCE_Black.png')?.kind).toBe('image');
    expect(files.find((file) => file.fileName === 'S_dididi.wav')?.kind).toBe('sound');
  });

  it('文件夹不存在或没配时给空列表，不抛错', async () => {
    expect(await assets.listAssetFiles('')).toEqual([]);
    expect(await assets.listAssetFiles(join(tmpdir(), '不存在的目录-smk'))).toEqual([]);
  });
});

describe('上传素材', () => {
  it('复制进素材文件夹并按 ID 重命名，保留原扩展名', async () => {
    const dir = tempDir();
    const source = join(dir, '随便起的名字.jpeg');
    writeFileSync(source, '图片内容');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: 'SCE_Black',
      kind: 'image',
      sourceFile: source,
    });

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(join(dir, 'Image', 'SCE_Black.jpeg'));
    expect(existsSync(join(dir, 'Image', 'SCE_Black.jpeg'))).toBe(true);
  });

  it('格式对不上直接拒绝，不往里复制', async () => {
    const dir = tempDir();
    const source = join(dir, 'a.mp3');
    writeFileSync(source, 'x');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: 'S_test',
      kind: 'sound',
      sourceFile: source,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('不支持的文件格式');
    expect(existsSync(join(dir, 'S_test.mp3'))).toBe(false);
  });

  it('类别对不上也拒绝：给音效传图片', async () => {
    const dir = tempDir();
    const source = join(dir, 'a.png');
    writeFileSync(source, 'x');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: 'S_test',
      kind: 'sound',
      sourceFile: source,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('.wav');
  });

  it('ID 空着不让传', async () => {
    const dir = tempDir();
    const source = join(dir, 'a.png');
    writeFileSync(source, 'x');
    const result = await assets.uploadAssetFile({
      folder: dir,
      id: '   ',
      kind: 'image',
      sourceFile: source,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('先填 ID');
  });

  it('没配素材文件夹时提示去设置里选', async () => {
    const dir = tempDir();
    const source = join(dir, 'a.png');
    writeFileSync(source, 'x');
    const result = await assets.uploadAssetFile({
      folder: '',
      id: 'X',
      kind: 'image',
      sourceFile: source,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('素材文件夹');
  });

  it('重新选择素材时把同一 ID 的旧文件删掉', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'Image'));
    writeFileSync(join(dir, 'Image', 'SCE_Black.png'), '旧图');
    const source = join(dir, '新图.jpg');
    writeFileSync(source, '新图');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: 'SCE_Black',
      kind: 'image',
      sourceFile: source,
      replace: true,
    });

    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'Image', 'SCE_Black.png'))).toBe(false);
    expect(existsSync(join(dir, 'Image', 'SCE_Black.jpg'))).toBe(true);
  });

  it('不替换时不动别的扩展名', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'Image'));
    writeFileSync(join(dir, 'Image', 'SCE_Black.png'), '旧图');
    const source = join(dir, '新图.jpg');
    writeFileSync(source, '新图');

    await assets.uploadAssetFile({
      folder: dir,
      id: 'SCE_Black',
      kind: 'image',
      sourceFile: source,
      replace: false,
    });

    expect(existsSync(join(dir, 'Image', 'SCE_Black.png'))).toBe(true);
    expect(existsSync(join(dir, 'Image', 'SCE_Black.jpg'))).toBe(true);
  });

  it('字体保留原文件名，放进 Fonts 子文件夹', async () => {
    const dir = tempDir();
    const source = join(dir, '思源黑体-Regular.ttf');
    writeFileSync(source, 'font');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: '',
      kind: 'font',
      sourceFile: source,
    });

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(join(dir, 'Fonts', '思源黑体-Regular.ttf'));
    expect(existsSync(join(dir, 'Fonts', '思源黑体-Regular.ttf'))).toBe(true);
  });
});

describe('webp 上传与写入 PNG', () => {
  it('选到 webp 时不复制，交回源路径让界面转 PNG', async () => {
    const dir = tempDir();
    const source = join(dir, 'a.webp');
    writeFileSync(source, 'RIFF....WEBP');

    const result = await assets.uploadAssetFile({
      folder: dir,
      id: 'PIC_X',
      kind: 'image',
      sourceFile: source,
    });

    expect(result).toMatchObject({ ok: false, requiresConversion: true, sourcePath: source });
    expect(existsSync(join(dir, 'PIC_X.webp'))).toBe(false);
  });

  it('界面转好的 PNG 字节能写进素材文件夹', async () => {
    const dir = tempDir();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const result = await assets.writeAssetFile({
      folder: dir,
      id: 'PIC_X',
      kind: 'image',
      extension: 'png',
      data: png,
    });

    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(join(dir, 'Image', 'PIC_X.png'));
    expect([...readFileSync(join(dir, 'Image', 'PIC_X.png'))]).toEqual([...png]);
  });

  it('replace 时把同一 ID 的旧扩展名清掉', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'Image'));
    writeFileSync(join(dir, 'Image', 'PIC_X.jpg'), '旧的');

    await assets.writeAssetFile({
      folder: dir,
      id: 'PIC_X',
      kind: 'image',
      extension: '.png',
      data: new Uint8Array([1, 2, 3]),
      replace: true,
    });

    expect(existsSync(join(dir, 'Image', 'PIC_X.jpg'))).toBe(false);
    expect(existsSync(join(dir, 'Image', 'PIC_X.png'))).toBe(true);
  });

  it('不允许写 webp、空内容、空 ID', async () => {
    const dir = tempDir();

    expect(
      (
        await assets.writeAssetFile({
          folder: dir,
          id: 'PIC_X',
          kind: 'image',
          extension: 'webp',
          data: new Uint8Array([1]),
        })
      ).ok,
    ).toBe(false);

    expect(
      (
        await assets.writeAssetFile({
          folder: dir,
          id: 'PIC_X',
          kind: 'image',
          extension: 'png',
          data: new Uint8Array(),
        })
      ).ok,
    ).toBe(false);

    expect(
      (
        await assets.writeAssetFile({
          folder: dir,
          id: '  ',
          kind: 'image',
          extension: 'png',
          data: new Uint8Array([1]),
        })
      ).ok,
    ).toBe(false);
  });
});

describe('删除素材', () => {
  it('删掉文件；文件本来就不在也算成功', async () => {
    const dir = tempDir();
    const file = join(dir, 'SCE_Black.png');
    writeFileSync(file, 'x');

    expect(await assets.removeAssetFile(file)).toEqual({ ok: true });
    expect(existsSync(file)).toBe(false);
    expect((await assets.removeAssetFile(file)).ok).toBe(true);
  });
});

describe('素材改名', () => {
  it('条目改了 ID，文件跟着改名，内容不动', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'SCE_Old.png'), '图');

    const result = await assets.renameAssetFile({
      folder: dir,
      oldId: 'SCE_Old',
      newId: 'SCE_New',
      kind: 'image',
    });

    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'SCE_New.png'))).toBe(true);
    expect(existsSync(join(dir, 'SCE_Old.png'))).toBe(false);
  });

  it('目标文件名已经被占用时拒绝，不覆盖别人的文件', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'SCE_Old.png'), '旧');
    writeFileSync(join(dir, 'SCE_New.png'), '别人的');

    const result = await assets.renameAssetFile({
      folder: dir,
      oldId: 'SCE_Old',
      newId: 'SCE_New',
      kind: 'image',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('SCE_New.png');
    expect(existsSync(join(dir, 'SCE_Old.png'))).toBe(true);
  });

  it('没有对应文件时什么也不做，也算成功', async () => {
    const dir = tempDir();
    const result = await assets.renameAssetFile({
      folder: dir,
      oldId: '不存在',
      newId: '随便',
      kind: 'image',
    });
    expect(result.ok).toBe(true);
  });

  it('只动同一类文件：改图片名不会碰同名的音频', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'X.wav'), '音频');

    const result = await assets.renameAssetFile({
      folder: dir,
      oldId: 'X',
      newId: 'Y',
      kind: 'image',
    });

    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'X.wav'))).toBe(true);
  });

  it('ID 空着时拒绝', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'X.png'), '图');
    const result = await assets.renameAssetFile({
      folder: dir,
      oldId: 'X',
      newId: '  ',
      kind: 'image',
    });
    expect(result.ok).toBe(false);
  });
});