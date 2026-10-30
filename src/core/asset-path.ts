/**
 * 资源引用路径的拼法（图片 / 音频都要用）。
 *
 *   /Script/Engine.Texture2D'<文件夹>/<文件名>.<文件名>'
 *   /Script/Engine.SoundWave'<文件夹>/<文件名>.<文件名>'
 *
 * 图片与音频两张子表的路径规则一样，只是对象类型不同；文件名目前都等于行名。
 */
export function assetRefPath(className: string, folder: string, fileName: string): string {
  const dir = folder.trim().replace(/\/+$/, '');
  const name = fileName.trim();
  if (dir === '' || name === '') return '';
  return `/Script/Engine.${className}'${dir}/${name}.${name}'`;
}

/** 图片：Texture2D */
export function texturePath(folder: string, fileName: string): string {
  return assetRefPath('Texture2D', folder, fileName);
}
