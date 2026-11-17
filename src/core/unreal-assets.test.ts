import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface AssetCore {
  IMAGE_EXTENSIONS: string[];
  SOUND_EXTENSIONS: string[];
  allowedExtensions: (kind: 'image' | 'sound') => string[];
  baseNameOf: (fileName: string) => string;
  kindOfFile: (fileName: string) => 'image' | 'sound' | null;
  listAssetFiles: (
    folder: string,
  ) => Promise<Array<{ filePath: string; fileName: string; baseName: string; kind: string }>>;
  removeAssetFile: (filePath: string) => Promise<{ ok: boolean; message?: string }>;
  uploadAssetFile: (options: {
    folder: string;
    id: string;
    kind: 'image' | 'sound';
    sourceFile: string;
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
    expect(assets.kindOfFile('a.mp3')).toBeNull();
    expect(assets.kindOfFile('a.txt')).toBeNull();
    expect(assets.kindOfFile('没有扩展名')).toBeNull();
  });

  it('给文件选择框的扩展名列表不带点', () => {
    expect(assets.allowedExtensions('image')).toEqual(['png', 'jpg', 'jpeg', 'tga']);
    expect(assets.allowedExtensions('sound')).toEqual(['wav', 'ogg', 'flac']);
  });

  it('去掉扩展名时不影响带点的文件夹名', () => {
    expect(assets.baseNameOf('SCE_Black.png')).toBe('SCE_Black');
    expect(assets.baseNameOf('S_dididi.wav')).toBe('S_dididi');
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
    expect(result.filePath).toBe(join(dir, 'SCE_Black.jpeg'));
    expect(existsSync(join(dir, 'SCE_Black.jpeg'))).toBe(true);
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
    writeFileSync(join(dir, 'SCE_Black.png'), '旧图');
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
    expect(existsSync(join(dir, 'SCE_Black.png'))).toBe(false);
    expect(existsSync(join(dir, 'SCE_Black.jpg'))).toBe(true);
  });

  it('不替换时不动别的扩展名', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'SCE_Black.png'), '旧图');
    const source = join(dir, '新图.jpg');
    writeFileSync(source, '新图');

    await assets.uploadAssetFile({
      folder: dir,
      id: 'SCE_Black',
      kind: 'image',
      sourceFile: source,
      replace: false,
    });

    expect(existsSync(join(dir, 'SCE_Black.png'))).toBe(true);
    expect(existsSync(join(dir, 'SCE_Black.jpg'))).toBe(true);
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
