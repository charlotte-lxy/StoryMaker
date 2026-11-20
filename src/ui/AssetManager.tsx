/**
 * 「素材管理」单元格：立绘和音效两张表里每行一个。
 *
 * 素材文件夹里按「文件名 = ID」找文件：
 *   没有   → 一个「上传素材」按钮，选完自动复制进素材文件夹并重命名
 *   有     → 图片给预览按钮、音效给播放器，都带删除和「…」重选
 *
 * 文件内容不走 file://，一律经主进程读成二进制再包 Blob，
 * 这样打包后的 file:// 页面也能预览和播放。
 */

import { useEffect, useRef, useState } from 'react';

import type { AssetFileInfo, HostApi } from '../core/host';
import {
  SOUND_PITCH_MAX,
  SOUND_PITCH_MIN,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  soundPitchOf,
  soundVolumeOf,
} from '../core/sound-export';
import type { LookupRow } from '../core/types';
import { playExclusive, releaseAudio } from './audio-exclusive';
import { blobOf, canPreviewImage, mimeOf } from './asset-blob';
import { ConfirmDialog } from './ConfirmDialog';
import { SoundPlayer } from './sound-player';
import type { AssetLibrary } from './use-asset-library';

/** 秒数 → mm:ss；不是有限数就显示 00:00 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

interface CellProps {
  /** 图片 ID / 音效 ID，也是素材文件名要匹配的东西 */
  id: string;
  library: AssetLibrary;
  /** 读文件内容用（预览图 / 播放音频） */
  host: HostApi | undefined;
}

/** 表格里那些「还不能管素材」的提示，统一走这里 */
function disabledNote(library: AssetLibrary) {
  if (!library.available) return <span className="hint">桌面版才能管素材</span>;
  if (library.folder.trim() === '') return <span className="hint">先在「设置」里选素材文件夹</span>;
  return null;
}

/** 上传 / 删除按钮组；两边共用，差别只在 kind 和文案 */
function useAssetActions(id: string, kind: 'image' | 'sound', library: AssetLibrary) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingRemove, setPendingRemove] = useState<AssetFileInfo | null>(null);

  const upload = async (replace: boolean): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await library.upload(id, kind, replace);
      if (!result.ok && result.message !== undefined) setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async (): Promise<void> => {
    const file = pendingRemove;
    setPendingRemove(null);
    if (file === null) return;
    setBusy(true);
    setError('');
    try {
      const result = await library.remove(file);
      if (!result.ok) setError(result.message ?? '删除失败');
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, pendingRemove, setPendingRemove, upload, confirmRemove };
}

/** 删除确认框：两个单元格共用一个写法 */
function RemoveConfirm({
  file,
  onCancel,
  onConfirm,
}: {
  file: AssetFileInfo | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (file === null) return null;
  return (
    <ConfirmDialog
      title="删除素材"
      message={`确定从素材文件夹里删掉「${file.fileName}」吗？删了之后这里会变回「上传素材」。`}
      confirmLabel="删除"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * 立绘的素材管理：一张图一个格子。
 *
 * 有文件时给「预览」，点开是弹窗大图；tga 浏览器显示不了，按钮禁用并说明原因。
 */
export function ImageAssetCell({ id, library, host }: CellProps) {
  const files = library.byId.get(id) ?? [];
  const [previewFile, setPreviewFile] = useState<AssetFileInfo | null>(null);
  const actions = useAssetActions(id, 'image', library);

  const disabled = disabledNote(library);
  if (disabled !== null) return disabled;

  const note = () => (
    <>
      {files.length > 1 && (
        <div className="field-error">有 {files.length} 个重复文件，导入时用第一个</div>
      )}
      {actions.error !== '' && <div className="field-error">{actions.error}</div>}
    </>
  );

  if (files.length === 0) {
    return (
      <div className="asset-cell">
        <button
          type="button"
          className="mini"
          disabled={actions.busy}
          onClick={() => void actions.upload(false)}
        >
          {actions.busy ? '上传中…' : '上传素材'}
        </button>
        {note()}
      </div>
    );
  }

  const file = files[0];
  const previewable = canPreviewImage(file.fileName);

  return (
    <div className="asset-cell">
      <span className="asset-name" title={file.filePath}>
        {file.fileName}
      </span>
      <button
        type="button"
        className="mini"
        disabled={!previewable}
        title={previewable ? '弹窗查看这张图' : 'tga 在界面里显示不了，导入后在 UE 里看'}
        onClick={() => setPreviewFile(file)}
      >
        预览
      </button>
      <button
        type="button"
        className="mini"
        disabled={actions.busy}
        title="重新选择素材（会替换掉同名的那张）"
        onClick={() => void actions.upload(true)}
      >
        …
      </button>
      <button
        type="button"
        className="mini danger"
        disabled={actions.busy}
        onClick={() => actions.setPendingRemove(file)}
      >
        删除
      </button>
      {note()}

      {previewFile !== null && (
        <ImagePreviewDialog
          file={previewFile}
          host={host}
          onClose={() => setPreviewFile(null)}
        />
      )}
      <RemoveConfirm
        file={actions.pendingRemove}
        onCancel={() => actions.setPendingRemove(null)}
        onConfirm={() => void actions.confirmRemove()}
      />
    </div>
  );
}

/** 图片预览弹窗：点遮罩或按 Esc 关闭 */
function ImagePreviewDialog({
  file,
  host,
  onClose,
}: {
  file: AssetFileInfo;
  host: HostApi | undefined;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let created = '';
    let canceled = false;
    void host?.unreal
      ?.readAsset(file.filePath)
      .then((result) => {
        if (canceled) return;
        if (!result.ok || result.data === undefined) {
          setError(result.message ?? '读不了这张图');
          return;
        }
        created = URL.createObjectURL(blobOf(result.data, mimeOf(file.fileName)));
        setUrl(created);
      })
      .catch((reason: unknown) => {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      canceled = true;
      if (created !== '') URL.revokeObjectURL(created);
    };
  }, [file.filePath, host]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal image-preview-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>{file.fileName}</header>
        <div className="modal-body">
          {error !== '' ? (
            <p className="field-error">{error}</p>
          ) : url === '' ? (
            <p className="hint">正在读取…</p>
          ) : (
            <img className="image-preview" src={url} alt={file.fileName} />
          )}
        </div>
        <footer>
          <button type="button" autoFocus onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * 音频编辑弹窗：音量 / 音调倍率，调完立刻写回音效行。
 *
 * 试听按当前音量 / 音调播；改数值时正响着的那声会停掉重播，
 * 这样拖滑块就能直接听出差别。
 */
function AudioEditDialog({
  row,
  library,
  host,
  onUpdate,
  onClose,
}: {
  row: LookupRow;
  library: AssetLibrary;
  host: HostApi | undefined;
  onUpdate: (patch: Partial<LookupRow>) => void;
  onClose: () => void;
}) {
  const files = library.byId.get(row.id) ?? [];
  const file = files[0];
  const volume = soundVolumeOf(row);
  const pitch = soundPitchOf(row);
  const playerRef = useRef<SoundPlayer | null>(null);
  const [auditioning, setAuditioning] = useState(false);

  // 关掉弹窗时把试听停掉
  useEffect(() => {
    return () => {
      playerRef.current?.stopAll();
    };
  }, []);

  // 勾上「试听」后按当前参数播；参数一变就停了重播（音量 / 音调立刻听得到）
  useEffect(() => {
    if (!auditioning || file === undefined) return;
    const player = playerRef.current ?? (playerRef.current = new SoundPlayer());
    void player.play(host, file, volume, pitch);
    return () => player.stopAll();
  }, [auditioning, file, volume, pitch, host]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal audio-edit-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>音频编辑：{row.id === '' ? '（还没有 ID）' : row.id}</header>
        <div className="modal-body">
          <p className="hint">
            音量 / 音调存在这一行上，跟着项目文件走。改过之后这条音频算「修改」，
            下次「导出到 UE」会重新导入，并把数值写到 SoundWave 资产的 Volume / Pitch 上。
          </p>

          <label className="audio-edit-row">
            <span className="audio-edit-label">音量</span>
            <input
              type="range"
              min={SOUND_VOLUME_MIN}
              max={SOUND_VOLUME_MAX}
              step={0.05}
              value={volume}
              onChange={(event) => onUpdate({ volume: Number(event.target.value) })}
            />
            <output>x{volume.toFixed(2)}</output>
          </label>

          <label className="audio-edit-row">
            <span className="audio-edit-label">音调</span>
            <input
              type="range"
              min={SOUND_PITCH_MIN}
              max={SOUND_PITCH_MAX}
              step={0.05}
              value={pitch}
              onChange={(event) => onUpdate({ pitch: Number(event.target.value) })}
            />
            <output>x{pitch.toFixed(2)}</output>
          </label>

          <div className="audio-edit-audition">
            <button
              type="button"
              className="mini"
              disabled={file === undefined}
              title={file === undefined ? '素材文件夹里还没有这条音频' : '按当前音量 / 音调试听'}
              onClick={() => setAuditioning((current) => !current)}
            >
              {auditioning ? '⏸ 停止试听' : '▶ 试听'}
            </button>
            {file === undefined && (
              <span className="hint">还没有素材文件；数值会等导入时一起生效。</span>
            )}
          </div>
        </div>
        <footer>
          <button type="button" onClick={() => onUpdate({ volume: 1, pitch: 1 })}>
            恢复默认
          </button>
          <button type="button" className="primary" autoFocus onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * 音效的素材管理：一条音效一个播放器。
 *
 * 播放 / 暂停、进度条（可拖动跳转）、当前时长 / 总时长，外加「编辑」（音量 / 音调）、
 * 删除与「…」重选。
 */
export function SoundAssetCell({
  row,
  library,
  host,
  onUpdate,
}: {
  row: LookupRow;
  library: AssetLibrary;
  host: HostApi | undefined;
  onUpdate: (patch: Partial<LookupRow>) => void;
}) {
  const id = row.id;
  const files = library.byId.get(id) ?? [];
  const actions = useAssetActions(id, 'sound', library);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState('');
  const [playError, setPlayError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [editing, setEditing] = useState(false);

  const file = files[0];

  // 卸载时把还在响的停掉，别让声音跟着跑到别的模块去
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio !== null) {
        audio.pause();
        releaseAudio(audio);
      }
    };
  }, []);

  useEffect(() => {
    if (file === undefined || host?.unreal === undefined) return;
    let created = '';
    let canceled = false;

    // 换了素材（哪怕文件名没变）就把旧声音停掉、进度归零，重新读文件
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      releaseAudio(audio);
    }
    setUrl('');
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setPlayError('');

    void host.unreal
      .readAsset(file.filePath)
      .then((result) => {
        if (canceled) return;
        if (!result.ok || result.data === undefined) {
          setPlayError(result.message ?? '读不了这条音频');
          return;
        }
        created = URL.createObjectURL(blobOf(result.data, mimeOf(file.fileName)));
        setUrl(created);
      })
      .catch((reason: unknown) => {
        if (!canceled) setPlayError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      canceled = true;
      if (created !== '') URL.revokeObjectURL(created);
    };
    // 指纹也算依赖：同一个 ID 重新选了素材，文件名可能不变，但大小/时间会变
  }, [file?.filePath, file?.size, file?.mtimeMs, host]);

  const disabled = disabledNote(library);
  if (disabled !== null) return disabled;

  if (file === undefined) {
    return (
      <div className="asset-cell">
        <button
          type="button"
          className="mini"
          disabled={actions.busy}
          onClick={() => void actions.upload(false)}
        >
          {actions.busy ? '上传中…' : '上传素材'}
        </button>
        <button
          type="button"
          className="mini"
          title="音量 / 音调（没有素材也能先设好，导入时一起生效）"
          onClick={() => setEditing(true)}
        >
          编辑
        </button>
        {actions.error !== '' && <div className="field-error">{actions.error}</div>}
        <RemoveConfirm
          file={actions.pendingRemove}
          onCancel={() => actions.setPendingRemove(null)}
          onConfirm={() => void actions.confirmRemove()}
        />
        {editing && (
          <AudioEditDialog
            row={row}
            library={library}
            host={host}
            onUpdate={onUpdate}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    );
  }

  const toggle = (): void => {
    const audio = audioRef.current;
    if (audio === null || url === '') return;
    if (audio.paused) {
      // 同一时刻只放一个：别的播放器还响着就先停掉它
      playExclusive(audio);
      void audio.play().catch(() => setPlayError('播放失败，文件可能损坏'));
    } else {
      audio.pause();
      releaseAudio(audio);
    }
  };

  const seek = (value: number): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    audio.currentTime = value;
    setCurrent(value);
  };

  return (
    <div className="asset-cell sound-cell">
      <button
        type="button"
        className="mini play-toggle"
        disabled={url === ''}
        title={url === '' ? '正在读取音频…' : playing ? '暂停' : '播放'}
        onClick={toggle}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <input
        className="sound-progress"
        type="range"
        min={0}
        max={Number.isFinite(duration) && duration > 0 ? duration : 0}
        step={0.01}
        value={Math.min(current, duration || 0)}
        disabled={url === ''}
        onChange={(event) => seek(Number(event.target.value))}
        title="拖动跳转"
      />
      <span className="sound-time">
        {formatTime(current)} / {formatTime(duration)}
      </span>
      <button
        type="button"
        className="mini"
        title={`音量 x${soundVolumeOf(row).toFixed(2)} / 音调 x${soundPitchOf(row).toFixed(2)}`}
        onClick={() => setEditing(true)}
      >
        编辑
      </button>
      <button
        type="button"
        className="mini"
        disabled={actions.busy}
        title="重新选择素材（会替换掉同名的那条）"
        onClick={() => void actions.upload(true)}
      >
        …
      </button>
      <button
        type="button"
        className="mini danger"
        disabled={actions.busy}
        onClick={() => actions.setPendingRemove(file)}
      >
        删除
      </button>

      <audio
        ref={audioRef}
        src={url === '' ? undefined : url}
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          setPlaying(false);
          releaseAudio(event.currentTarget);
        }}
        onEnded={(event) => {
          setPlaying(false);
          setCurrent(0);
          releaseAudio(event.currentTarget);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />
      {files.length > 1 && (
        <div className="field-error">有 {files.length} 个重复文件，导入时用第一个</div>
      )}
      {playError !== '' && <div className="field-error">{playError}</div>}
      {actions.error !== '' && <div className="field-error">{actions.error}</div>}
      <RemoveConfirm
        file={actions.pendingRemove}
        onCancel={() => actions.setPendingRemove(null)}
        onConfirm={() => void actions.confirmRemove()}
      />
      {editing && (
        <AudioEditDialog
          row={row}
          library={library}
          host={host}
          onUpdate={onUpdate}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
