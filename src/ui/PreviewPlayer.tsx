/**
 * 剧情预览面板（16:9）。
 *
 * 播放逻辑全在 core/preview.ts，这里只负责：
 *   - 把「当前状态」画成画面（背景 / 立绘 / 台词 / 选项 / 延时提示）
 *   - 按日志增量播放音效（一句台词可能先后触发好几条音效指令）
 *   - 自动播放、上一句、重播、继续下一段、指令日志
 *
 * 素材按「文件名 = 条目 ID」从素材文件夹读；读不到就画占位框，
 * 不报错也不白屏——策划看到占位框就知道是该补素材，而不是软件坏了。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { AssetFileInfo, HostApi } from '../core/host';
import {
  advance,
  chooseOption,
  continueToNextGroup,
  describeCommand,
  previewPositionName,
  previewSpeakerName,
  restartGroup,
  startPreview,
  stepBack,
  type PreviewCharacterState,
  type PreviewStart,
  type PreviewState,
} from '../core/preview';
import { characterAssetOf, imageAssetOf, soundAssetOf } from '../core/preview-assets';
import type { Project } from '../core/types';
import { blobOf, canPreviewImage, mimeOf } from './asset-blob';
import { playExclusive, releaseAudio } from './audio-exclusive';
import type { AssetLibrary } from './use-asset-library';

/** 自动播放时每句台词停多久（毫秒） */
const AUTO_ADVANCE_MS = 1500;

interface Props {
  project: Project;
  /** 播放起点；null 表示还没开始，面板显示空态 */
  start: PreviewStart | null;
  /** 当前打开的段落：空态里「从当前段落开始」用它 */
  activeGroupUid: string;
  assets: { library: AssetLibrary; host: HostApi | undefined };
  /** 换起点 / 从当前段落开始：由 App 统一改起点并打开对应段落 */
  onPickStart: (groupUid: string, lineUid?: string) => void;
  onCollapse: () => void;
}

/** 读一个素材文件，包成 Blob URL；读不到或浏览器显示不了时返回空串 */
function useAssetUrl(host: HostApi | undefined, file: AssetFileInfo | undefined): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    setUrl('');
    if (host?.unreal === undefined || file === undefined) return;
    if (!canPreviewImage(file.fileName)) return;

    let created = '';
    let canceled = false;
    void host.unreal
      .readAsset(file.filePath)
      .then((result) => {
        if (canceled || !result.ok || result.data === undefined) return;
        created = URL.createObjectURL(blobOf(result.data, mimeOf(file.fileName)));
        setUrl(created);
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
      if (created !== '') URL.revokeObjectURL(created);
    };
  }, [host, file?.filePath, file?.fileName]);

  return url;
}

/** 图片层：背景图（读不到就显示图片 ID 的占位） */
function BackgroundLayer({
  project,
  byId,
  host,
  imageUid,
}: {
  project: Project;
  byId: Map<string, AssetFileInfo[]>;
  host: HostApi | undefined;
  imageUid: string;
}) {
  const asset = imageAssetOf(project, byId, imageUid);
  const url = useAssetUrl(host, asset?.file);

  if (url !== '') {
    return <img className="preview-background" src={url} alt="" />;
  }
  return (
    <div className="preview-background preview-placeholder">
      <span>{asset?.id ?? imageUid}</span>
      <span className="hint">
        {asset === undefined
          ? '图片不在图片表里'
          : asset.file === undefined
            ? '素材文件夹里没有这张图'
            : 'tga 在界面里显示不了'}
      </span>
    </div>
  );
}

/** 立绘层：按上场顺序摆左 / 中 / 右，第 4 个起在右侧叠放错开 */
function CharacterSprite({
  project,
  byId,
  host,
  character,
}: {
  project: Project;
  byId: Map<string, AssetFileInfo[]>;
  host: HostApi | undefined;
  character: PreviewCharacterState;
}) {
  const asset = characterAssetOf(project, byId, character.characterUid, character.expression);
  const url = useAssetUrl(host, asset?.file);
  const name = previewSpeakerName(project, character.characterUid, '');
  const side = character.slot >= 3 ? 'right' : ['left', 'center', 'right'][character.slot];
  const style =
    side === 'right' ? { right: `${4 + Math.max(0, character.slot - 2) * 7}%` } : undefined;

  return (
    <div className={`preview-character slot-${side ?? 'left'}`} style={style}>
      {url !== '' ? (
        <img src={url} alt={name} />
      ) : (
        <div className="preview-character-placeholder">
          <span className="preview-character-name">{name === '' ? '（没选角色）' : name}</span>
          <span className="hint">{character.expression === '' ? '默认立绘' : character.expression}</span>
          {asset === undefined ? (
            <span className="hint">角色不在角色表里</span>
          ) : asset.file === undefined ? (
            <span className="hint">没有素材：{asset.id}</span>
          ) : (
            <span className="hint">tga 在界面里显示不了</span>
          )}
        </div>
      )}
    </div>
  );
}

export function PreviewPlayer({
  project,
  start,
  activeGroupUid,
  assets,
  onPickStart,
  onCollapse,
}: Props) {
  const [state, setState] = useState<PreviewState | null>(null);
  /** 播放期间读这一份快照，编辑不影响正在播的内容；重播时换成最新项目 */
  const snapshotRef = useRef<Project>(project);
  const [auto, setAuto] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  /** 已经播到第几条日志：音效按新增的那几条播，回退时重置 */
  const playedLogRef = useRef(0);
  const soundsRef = useRef<Set<HTMLAudioElement>>(new Set());

  // 起点变了 = 开一场新的：拿这一刻的项目当快照
  useEffect(() => {
    if (start === null) {
      setState(null);
      playedLogRef.current = 0;
      return;
    }
    snapshotRef.current = project;
    setState(startPreview(project, start));
    playedLogRef.current = 0;
    // project 故意不进依赖：快照只在这一刻取
  }, [start]);

  // 面板关掉（组件卸载）时把还在响的音效停掉
  useEffect(() => {
    const sounds = soundsRef.current;
    return () => {
      for (const audio of sounds) {
        audio.pause();
        releaseAudio(audio);
      }
      sounds.clear();
    };
  }, []);

  const playSound = useCallback(
    async (soundUid: string): Promise<void> => {
      const host = assets.host;
      if (host?.unreal === undefined) return;

      const asset = soundAssetOf(snapshotRef.current, assets.library.byId, soundUid);
      if (asset?.file === undefined) return;

      const result = await host.unreal.readAsset(asset.file.filePath).catch(() => undefined);
      if (result === undefined || !result.ok || result.data === undefined) return;

      const url = URL.createObjectURL(blobOf(result.data, mimeOf(asset.file.fileName)));
      const audio = new Audio(url);
      soundsRef.current.add(audio);
      playExclusive(audio);
      audio.addEventListener('ended', () => {
        soundsRef.current.delete(audio);
        releaseAudio(audio);
        URL.revokeObjectURL(url);
      });
      await audio.play().catch(() => undefined);
    },
    [assets.host, assets.library.byId],
  );

  // 音效：只播这次新推进出来的那几条（「上一句」退回时日志变短，直接重置）
  useEffect(() => {
    if (state === null) {
      playedLogRef.current = 0;
      return;
    }
    if (state.log.length < playedLogRef.current) {
      playedLogRef.current = state.log.length;
      return;
    }
    const fresh = state.log.slice(playedLogRef.current);
    playedLogRef.current = state.log.length;
    for (const entry of fresh) {
      if (entry.soundUid !== undefined) void playSound(entry.soundUid);
    }
  }, [state, playSound]);

  const advanceNow = useCallback(() => {
    setState((current) => {
      if (current === null) return null;
      if (current.status !== 'line' && current.status !== 'delay') return current;
      return advance(snapshotRef.current, current);
    });
  }, []);

  // 自动播放：延时按秒数等，「强制自动播放」的台词按固定间隔走，选项永远等玩家
  useEffect(() => {
    if (!auto || state === null) return;
    const tick = (): void => {
      setState((current) => (current === null ? null : advance(snapshotRef.current, current)));
    };
    if (state.status === 'delay') {
      const timer = window.setTimeout(tick, Math.max(0, state.delaySeconds) * 1000);
      return () => window.clearTimeout(timer);
    }
    if (state.status === 'line' && state.current?.autoAdvance === true) {
      const timer = window.setTimeout(tick, AUTO_ADVANCE_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [auto, state]);

  // 指令日志打开时滚到最新一条
  useEffect(() => {
    if (!logOpen) return;
    const node = logRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [logOpen, state?.log.length]);

  const choose = (optionUid: string): void => {
    setState((current) =>
      current === null ? null : chooseOption(snapshotRef.current, current, optionUid),
    );
  };

  const back = (): void => {
    setState((current) => (current === null ? null : stepBack(current)));
  };

  const restart = (): void => {
    snapshotRef.current = project;
    setState((current) => (current === null ? null : restartGroup(project, current)));
  };

  const nextGroup = (): void => {
    setState((current) =>
      current === null ? null : continueToNextGroup(snapshotRef.current, current),
    );
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    // 下拉、输入框、按钮里的键盘操作留给它们自己
    if (event.key !== 'Escape' && target.closest('input, select, textarea, button') !== null) return;

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      advanceNow();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCollapse();
    }
  };

  const groups = useMemo(
    () =>
      project.chapters.flatMap((chapter) =>
        chapter.groups.map((group) => ({
          uid: group.uid,
          label: `${chapter.title.trim() === '' ? chapter.id : chapter.title} · ${
            group.title.trim() === '' ? group.id : group.title
          }`,
        })),
      ),
    [project],
  );

  const groupUid = state?.cursor.groupUid ?? start?.groupUid ?? activeGroupUid;
  const group = useMemo(() => {
    for (const chapter of project.chapters) {
      const found = chapter.groups.find((item) => item.uid === groupUid);
      if (found !== undefined) return found;
    }
    return undefined;
  }, [project, groupUid]);

  const lineUid = start?.lineUid ?? '';
  const canAdvance = state !== null && (state.status === 'line' || state.status === 'delay');
  const assetsReady = assets.library.available && assets.library.folder.trim() !== '';

  const current = state?.current ?? null;
  const speaker = current === null ? '' : previewSpeakerName(project, current.characterUid, current.aliasUid);
  const positionName = current === null ? '' : previewPositionName(project, current.playPositionUid);
  const centered = positionName.includes('屏幕');
  const lineText =
    current === null
      ? ''
      : current.text.zh.trim() !== ''
        ? current.text.zh
        : current.text.en.trim() !== ''
          ? current.text.en
          : current.text.ja;

  return (
    <div
      className="preview-pane"
      ref={panelRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="剧情预览"
    >
      <div className="preview-head">
        <select
          className="preview-group-select"
          value={groupUid}
          title="预览从哪个段落开始"
          onChange={(event) => {
            if (event.target.value !== '') onPickStart(event.target.value);
          }}
        >
          {groups.length === 0 && <option value="">还没有段落</option>}
          {groups.map((item) => (
            <option key={item.uid} value={item.uid}>
              {item.label}
            </option>
          ))}
        </select>

        <select
          className="preview-line-select"
          value={lineUid}
          title="从这一行开始（默认第一行）"
          onChange={(event) => {
            if (groupUid === '') return;
            onPickStart(groupUid, event.target.value === '' ? undefined : event.target.value);
          }}
          disabled={group === undefined}
        >
          <option value="">（第一行）</option>
          {(group?.lines ?? []).map((line) => (
            <option key={line.uid} value={line.uid}>
              {line.readableId}
              {line.kind === '对话' && line.text.zh.trim() !== '' ? ` · ${line.text.zh.trim()}` : ''}
            </option>
          ))}
        </select>

        <span className="spacer" />
        <button
          type="button"
          className="mini"
          title="收起预览面板，给对话列表让出地方"
          onClick={onCollapse}
        >
          收起 ⏵
        </button>
      </div>

      {state === null ? (
        <div className="preview-empty">
          <p>还没有开始预览。</p>
          <p className="hint">点「章节 / 段落」里段落行旁的 ▶，或直接从这里开始：</p>
          <button
            type="button"
            className="primary"
            disabled={activeGroupUid === ''}
            onClick={() => onPickStart(activeGroupUid)}
          >
            ▶ 从当前段落开始
          </button>
        </div>
      ) : (
        <>
          <div className="preview-stage">
            <div className="preview-frame">
              {state.stage.backgroundImageUid !== '' && (
                <BackgroundLayer
                  project={project}
                  byId={assets.library.byId}
                  host={assets.host}
                  imageUid={state.stage.backgroundImageUid}
                />
              )}

              {state.stage.cgId !== '' && (
                <div className="preview-cg">
                  <span>CG</span>
                  <strong>{state.stage.cgId}</strong>
                  <span className="hint">预览只显示这个号</span>
                </div>
              )}

              {state.stage.characters
                .filter((character) => character.entered)
                .map((character) => (
                  <CharacterSprite
                    key={character.characterUid}
                    project={project}
                    byId={assets.library.byId}
                    host={assets.host}
                    character={character}
                  />
                ))}

              {current !== null && (
                <div className={`preview-dialogue${centered ? ' center' : ''}`}>
                  {speaker !== '' && <span className="preview-speaker">{speaker}</span>}
                  <p className="preview-text">{lineText === '' ? '（这一句还没填台词）' : lineText}</p>
                  {positionName !== '' && <span className="preview-position">{positionName}</span>}
                </div>
              )}

              {state.status === 'options' && (
                <div className="preview-options">
                  {state.options.map((option) => (
                    <button
                      key={option.optionUid}
                      type="button"
                      className="preview-option"
                      onClick={() => choose(option.optionUid)}
                    >
                      <span className="preview-option-text">
                        {option.text.zh.trim() !== ''
                          ? option.text.zh
                          : option.text.en.trim() !== ''
                            ? option.text.en
                            : '（没填选项文本）'}
                      </span>
                      {(option.appearConditions.length > 0 ||
                        option.enableConditions.length > 0) && (
                        <span className="preview-option-conditions">
                          {option.appearConditions.length > 0 && (
                            <span>
                              出现：
                              {option.appearConditions
                                .map((text) => describeCommand(project, text, '条件'))
                                .join('；')}
                            </span>
                          )}
                          {option.enableConditions.length > 0 && (
                            <span>
                              可用：
                              {option.enableConditions
                                .map((text) => describeCommand(project, text, '条件'))
                                .join('；')}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {state.status === 'delay' && (
                <div className="preview-delay">延时 {state.delaySeconds} 秒…</div>
              )}
              {state.status === 'finished' && <div className="preview-finished">本段结束</div>}
              {state.status === 'blocked' && (
                <div className="preview-finished warn">播放已停下（跳转可能成环）</div>
              )}
            </div>
          </div>

          <div className="preview-controls">
            <button type="button" onClick={back} disabled={state.history.length === 0}>
              ◀ 上一句
            </button>
            <button type="button" onClick={restart}>
              重播本段
            </button>
            <button type="button" className="primary" onClick={advanceNow} disabled={!canAdvance}>
              继续 ▶
            </button>
            <label className="preview-auto" title="按「强制自动播放」与延时指令自动往下走">
              <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
              自动播放
            </label>
            <button
              type="button"
              className="mini"
              onClick={() => setLogOpen((currentValue) => !currentValue)}
            >
              指令日志 {state.log.length}
            </button>
            {state.status === 'finished' && (
              <button
                type="button"
                onClick={nextGroup}
                disabled={state.nextGroupUid === ''}
                title={
                  state.nextGroupUid === ''
                    ? '本章没有下一段了'
                    : '接着播下一段，角色和背景保留'
                }
              >
                继续下一段 ▶
              </button>
            )}
          </div>

          {!assetsReady && (
            <div className="preview-hint">
              桌面版 + 设置里选好素材文件夹，才能看到真实画面、听到音效；现在是占位。
            </div>
          )}

          {logOpen && (
            <div className="preview-log" ref={logRef}>
              {state.log.length === 0 && <div className="hint">还没有执行到指令</div>}
              {state.log.map((entry, index) => (
                <div key={index} className={`preview-log-row ${entry.level}`}>
                  {entry.text}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
