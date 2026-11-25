/**
 * 剧情预览面板（16:9）。
 *
 * 播放逻辑全在 core/preview.ts，这里只负责：
 *   - 把「当前状态」画成画面（背景 / 立绘 / 台词 / 选项 / 延时提示）
 *   - 按日志增量播放音效（**允许多条同时响**，结束预览 / 重播时一次全停）
 *   - 自动播放、上一句、重播、继续下一段、指令日志、锁定到对话
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
  previewActiveLineUid,
  previewSpeakerName,
  previewTextBoxOf,
  restartGroup,
  startPreview,
  stepBack,
  type PreviewCharacterState,
  type PreviewStart,
  type PreviewState,
} from '../core/preview';
import { characterAssetOf, imageAssetOf, soundAssetOf } from '../core/preview-assets';
import { CANVAS_HEIGHT, CANVAS_WIDTH, REVEAL_PUNCTUATION } from '../core/textbox';
import type { LangKey, LocalizedText, Project, TextBoxControl, TextBoxRow } from '../core/types';
import { blobOf, canPreviewImage, mimeOf } from './asset-blob';
import { registerAudioStopper } from './audio-registry';
import { SoundPlayer } from './sound-player';
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
  /** 从当前段落开始播（空态按钮） */
  onPickStart: (groupUid: string, lineUid?: string) => void;
  /** 收起时只留标题栏，标题栏里还能再展开 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 结束预览：清空播放状态（音频由本组件停掉） */
  onStop: () => void;
  /** 锁定到对话：开的时候对话列表会跟着滚 */
  locked: boolean;
  onToggleLocked: (locked: boolean) => void;
  /** 当前停在哪一行 / 哪个段落（对话列表高亮 + 自动滚动用） */
  onActiveLine: (lineUid: string, groupUid: string) => void;
}

/** 读一个素材文件，包成 Blob URL；读不到或浏览器显示不了时返回空串 */
export function useAssetUrl(host: HostApi | undefined, file: AssetFileInfo | undefined): string {
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

/** 立绘弹窗里的一张立绘：填满它所在的那一格 */
function PortraitSprite({
  project,
  byId,
  host,
  character,
  language,
}: {
  project: Project;
  byId: Map<string, AssetFileInfo[]>;
  host: HostApi | undefined;
  character: PreviewCharacterState;
  language: LangKey;
}) {
  const asset = characterAssetOf(project, byId, character.characterUid, character.expression);
  const url = useAssetUrl(host, asset?.file);
  const name = previewTextOf(previewSpeakerName(project, character.characterUid, ''), language);

  return (
    <div className="preview-portrait" data-character={character.characterUid}>
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

/** 一个控件自己的背景图：没图片时什么都不画（背景「无」= 全透明） */
function ControlBackground({
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
  const asset = imageUid === '' ? undefined : imageAssetOf(project, byId, imageUid);
  const url = useAssetUrl(host, asset?.file);
  if (url === '') return null;
  return <img className="preview-textbox-bg" src={url} alt="" />;
}

/** 设计稿像素 → 绝对定位样式 */
function rectStyle(rect: { x: number; y: number; w: number; h: number }): React.CSSProperties {
  return {
    left: rect.x * CANVAS_WIDTH,
    top: rect.y * CANVAS_HEIGHT,
    width: rect.w * CANVAS_WIDTH,
    height: rect.h * CANVAS_HEIGHT,
  };
}

/** 文字控件的行内样式：字体、字号、颜色、对齐、行距 */
function controlTextStyle(control: TextBoxControl): React.CSSProperties {
  return {
    fontFamily: control.fontFamily === '' ? undefined : `"${control.fontFamily}", sans-serif`,
    fontSize: control.fontSize,
    color: control.color,
    textAlign: control.align,
    lineHeight: control.lineHeight,
    display: 'flex',
    flexDirection: 'column',
    justifyContent:
      control.verticalAlign === 'middle'
        ? 'center'
        : control.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start',
  };
}

/** 一句台词 / 名字按语言取：没填那种语言就退回中文，中文也没有再退回其它语言 */
function previewTextOf(text: LocalizedText, language: LangKey = 'zh'): string {
  const pick = (key: LangKey): string => text[key] ?? '';
  if (language === 'en') {
    return pick('en').trim() !== '' ? pick('en') : pick('zh').trim() !== '' ? pick('zh') : pick('ja');
  }
  if (language === 'ja') {
    return pick('ja').trim() !== '' ? pick('ja') : pick('zh').trim() !== '' ? pick('zh') : pick('en');
  }
  return pick('zh').trim() !== '' ? pick('zh') : pick('en').trim() !== '' ? pick('en') : pick('ja');
}

/**
 * 台词的出现效果：立即 / 淡入淡出 / 逐字。
 *
 * 淡入淡出：先把旧文字淡出，再换上新文字淡入；淡出过程中点下一句就直接隐藏、
 * 换文字、直接淡入；淡入过程中点一下则立刻显示整段。
 * 逐字：按字数一个个露出来，遇到标点多停一下；点一下直接显示整行。
 */
function RevealText({
  lines,
  control,
  registerFinish,
}: {
  lines: string[];
  control: TextBoxControl;
  registerFinish?: (finish: (() => void) | null) => void;
}) {
  const [shown, setShown] = useState<string[]>([]);
  const [opacity, setOpacity] = useState(1);
  /** 逐字时最后一行露出几个字；null 表示整行都在 */
  const [revealed, setRevealed] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'out' | 'in' | 'typing'>('idle');

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const targetRef = useRef(lines);
  targetRef.current = lines;
  const opacityRef = useRef(1);
  opacityRef.current = opacity;
  const rafRef = useRef(0);
  const timerRef = useRef(0);
  const keyRef = useRef('');

  const cancelAnimation = useCallback((): void => {
    if (rafRef.current !== 0) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const cancelTimer = useCallback((): void => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimation();
      cancelTimer();
    };
  }, [cancelAnimation, cancelTimer]);

  /** 用 rAF 把不透明度从 from 走到 to */
  const fadeTo = useCallback(
    (from: number, to: number, durationMs: number, done: () => void): void => {
      cancelAnimation();
      setOpacity(from);
      if (durationMs <= 0) {
        setOpacity(to);
        done();
        return;
      }
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / durationMs);
        setOpacity(from + (to - from) * t);
        if (t >= 1) done();
        else rafRef.current = window.requestAnimationFrame(step);
      };
      rafRef.current = window.requestAnimationFrame(step);
    },
    [cancelAnimation],
  );

  const startFadeIn = useCallback(
    (from: number): void => {
      setPhase('in');
      fadeTo(from, 1, Math.max(0, control.fadeIn) * 1000, () => setPhase('idle'));
    },
    [control.fadeIn, fadeTo],
  );

  const startTyping = useCallback(
    (target: string[]): void => {
      cancelTimer();
      setShown(target);
      const last = target[target.length - 1] ?? '';
      if (last === '') {
        setRevealed(null);
        setPhase('idle');
        return;
      }
      setRevealed(0);
      setPhase('typing');
      const base = 1000 / Math.max(1, control.typeSpeed);
      const pause = control.punctuationPause * 1000;
      let index = 0;
      const step = (): void => {
        index += 1;
        setRevealed(index);
        if (index >= last.length) {
          setRevealed(null);
          setPhase('idle');
          return;
        }
        const extra = REVEAL_PUNCTUATION.includes(last[index - 1] ?? '') ? pause : 0;
        timerRef.current = window.setTimeout(step, base + extra);
      };
      timerRef.current = window.setTimeout(step, base);
    },
    [cancelTimer, control.punctuationPause, control.typeSpeed],
  );

  // 内容变了：按出现效果演一遍
  useEffect(() => {
    const key = lines.join('\u0001');
    if (key === keyRef.current) return;
    keyRef.current = key;
    const mode = control.reveal;

    if (mode === 'instant') {
      cancelAnimation();
      cancelTimer();
      setShown(lines);
      setOpacity(1);
      setRevealed(null);
      setPhase('idle');
      return;
    }

    if (mode === 'fade') {
      if (phaseRef.current === 'out') {
        // 淡出还没完就又来下一句：直接隐藏、换文字、直接淡入
        setShown(lines);
        startFadeIn(0);
        return;
      }
      if (phaseRef.current === 'in') {
        // 淡入中途来下一句：文字直接显示，再重新走一遍
        cancelAnimation();
        setShown(lines);
        setOpacity(1);
        setPhase('idle');
        return;
      }
    }

    if (mode === 'typewriter') {
      cancelAnimation();
      setOpacity(1);
      startTyping(lines);
      return;
    }

    // 正常：先把当前文字淡出，再换新的淡入
    setPhase('out');
    fadeTo(opacityRef.current, 0, Math.max(0, control.fadeOut) * 1000, () => {
      setShown(lines);
      startFadeIn(0);
    });
    return;
  }, [lines, control, cancelAnimation, cancelTimer, fadeTo, startFadeIn, startTyping]);

  // 点一下（或自动播放到下一拍）时调这个：正在演就先补完，不推进剧情
  const finish = useCallback((): void => {
    if (phaseRef.current === 'out') {
      cancelAnimation();
      setShown(targetRef.current);
      startFadeIn(0);
      return;
    }
    if (phaseRef.current === 'in') {
      cancelAnimation();
      setOpacity(1);
      setPhase('idle');
      return;
    }
    if (phaseRef.current === 'typing') {
      cancelTimer();
      setRevealed(null);
      setPhase('idle');
    }
  }, [cancelAnimation, cancelTimer, startFadeIn]);

  useEffect(() => {
    if (registerFinish === undefined) return undefined;
    if (phase === 'idle') {
      registerFinish(null);
      return undefined;
    }
    registerFinish(finish);
    return () => registerFinish(null);
  }, [phase, finish, registerFinish]);

  const full = shown.join('\n');
  let body = full;
  if (revealed !== null && shown.length > 0) {
    const head = shown.slice(0, -1).join('\n');
    const last = shown[shown.length - 1].slice(0, revealed);
    body = head === '' ? last : `${head}\n${last}`;
  }

  return (
    <span className="preview-textbox-reveal" style={{ opacity }}>
      {body}
    </span>
  );
}

/** 一帧文本框图层：控件按自己的设计稿像素摆，外层整体缩放 */
function TextBoxLayer({
  project,
  byId,
  host,
  box,
  scale,
  speaker,
  lines,
  characters,
  language,
  registerFinish,
}: {
  project: Project;
  byId: Map<string, AssetFileInfo[]>;
  host: HostApi | undefined;
  box: TextBoxRow;
  scale: number;
  speaker: string;
  lines: string[];
  characters: PreviewCharacterState[];
  language: LangKey;
  registerFinish?: (finish: (() => void) | null) => void;
}) {
  return (
    <div
      className="preview-textbox"
      data-textbox-name={box.name}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        zIndex: box.layer,
      }}
    >
      {box.controls.map((control) => {
        if (control.kind === 'image') {
          return (
            <div
              key={control.uid}
              className="preview-textbox-image"
              style={rectStyle(control.rect)}
            >
              <ControlBackground
                project={project}
                byId={byId}
                host={host}
                imageUid={control.imageUid}
              />
            </div>
          );
        }
        if (control.kind === 'portrait') {
          // 单张：只画最后上场的那一个（新立绘盖掉旧的）；多张：所有上场的立绘平分这一格
          const shown =
            control.portraitMode === 'single' ? characters.slice(-1) : characters;
          if (shown.length === 0) return null;
          return (
            <div
              key={control.uid}
              className="preview-portrait-row"
              data-mode={control.portraitMode}
              data-layout={control.portraitLayout}
              data-limit={control.portraitLimit ? 'true' : 'false'}
              style={rectStyle(control.rect)}
            >
              {shown.map((character) => (
                <PortraitSprite
                  key={character.characterUid}
                  project={project}
                  byId={byId}
                  host={host}
                  character={character}
                  language={language}
                />
              ))}
            </div>
          );
        }
        const text = control.content === 'speaker' ? speaker : lines.join('\n');
        if (text === '') return null;
        return (
          <div
            key={control.uid}
            className="preview-textbox-text"
            data-kind={control.kind}
            data-content={control.content}
            style={{ ...rectStyle(control.rect), ...controlTextStyle(control) }}
          >
            <RevealText
              lines={control.content === 'speaker' ? [speaker] : lines}
              control={control}
              registerFinish={registerFinish}
            />
          </div>
        );
      })}
    </div>
  );
}

export function PreviewPlayer({
  project,
  start,
  activeGroupUid,
  assets,
  onPickStart,
  collapsed,
  onToggleCollapsed,
  onStop,
  locked,
  onToggleLocked,
  onActiveLine,
}: Props) {
  const [state, setState] = useState<PreviewState | null>(null);
  /** 播放期间读这一份快照，编辑不影响正在播的内容；重播时换成最新项目 */
  const snapshotRef = useRef<Project>(project);
  const [auto, setAuto] = useState(false);
  /** 预览语言：台词 / 选项 / 说话人名字都按它取 */
  const [language, setLanguage] = useState<LangKey>('zh');
  /** 预览里的音效音量（0–1），只影响这个面板 */
  const [volume, setVolume] = useState(1);
  const [logOpen, setLogOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  /** 文本框图层按 1920×1080 的设计稿画，用这个比例整体缩放 */
  const [frameScale, setFrameScale] = useState(1);
  /** 已经播到第几条日志：音效按新增的那几条播，回退时重置 */
  const playedLogRef = useRef(0);
  /** 预览里音效可以叠着响，结束 / 重播时一次全停 */
  const playerRef = useRef<SoundPlayer | null>(null);
  /** 回调可能每次渲染都换，用 ref 兜住，effect 只跟着「当前行」走 */
  const activeLineCallback = useRef(onActiveLine);
  activeLineCallback.current = onActiveLine;

  const stopAllSound = useCallback((): void => {
    playerRef.current?.stopAll();
  }, []);

  // 别处开始试听 / 播放时，把预览里的音效一起停掉
  useEffect(() => registerAudioStopper(stopAllSound), [stopAllSound]);

  // 收起时看不见画面，声音也别继续响（进度保留，展开后接着播）
  useEffect(() => {
    if (collapsed) stopAllSound();
  }, [collapsed, stopAllSound]);

  // 起点变了 = 开一场新的：拿这一刻的项目当快照，旧声音全停
  useEffect(() => {
    playerRef.current?.stopAll();
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

  // 面板关掉（组件卸载）时把还在响的停掉
  useEffect(() => {
    return () => {
      playerRef.current?.stopAll();
    };
  }, []);

  // 画面比例：文本框按 1920×1080 设计稿摆，窗口变了跟着缩
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const measure = (): void => {
      const width = frame.getBoundingClientRect().width;
      if (width > 0) setFrameScale(width / CANVAS_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [collapsed, state !== null]);

  const playSound = useCallback(
    async (soundUid: string): Promise<void> => {
      const asset = soundAssetOf(snapshotRef.current, assets.library.byId, soundUid);
      if (asset?.file === undefined) return;

      const player = playerRef.current ?? (playerRef.current = new SoundPlayer());
      await player.play(assets.host, asset.file, (asset.volume ?? 1) * volume, asset.pitch ?? 1);
    },
    [assets.host, assets.library.byId, volume],
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

  /** 出现效果演到一半时，点一下先把它演完，不推进剧情 */
  const revealFinishRef = useRef<(() => void) | null>(null);

  const advanceOrFinish = useCallback(() => {
    if (revealFinishRef.current !== null) {
      revealFinishRef.current();
      return;
    }
    advanceNow();
  }, [advanceNow]);

  const registerRevealFinish = useCallback((finish: (() => void) | null) => {
    revealFinishRef.current = finish;
  }, []);

  // 自动播放：延时按秒数等，「强制自动播放」的台词按固定间隔走，选项永远等玩家
  useEffect(() => {
    if (!auto || state === null) return;
    const tick = (): void => {
      // 演到一半先补完，下一拍再推进
      if (revealFinishRef.current !== null) {
        revealFinishRef.current();
        return;
      }
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

  /** 当前停住的那一行：给对话列表高亮 / 滚动用 */
  const activeLineUid = useMemo(
    () => (state === null ? '' : previewActiveLineUid(snapshotRef.current, state)),
    [state],
  );
  const activeGroupUidOfLine = state?.cursor.groupUid ?? '';

  useEffect(() => {
    activeLineCallback.current(activeLineUid, activeGroupUidOfLine);
  }, [activeLineUid, activeGroupUidOfLine]);

  const stopPreview = (): void => {
    stopAllSound();
    playedLogRef.current = 0;
    setState(null);
    onStop();
  };

  const choose = (optionUid: string): void => {
    setState((current) =>
      current === null ? null : chooseOption(snapshotRef.current, current, optionUid),
    );
  };

  const back = (): void => {
    stopAllSound();
    setState((current) => (current === null ? null : stepBack(current)));
  };

  const restart = (): void => {
    // 重播 = 从头再来：先停掉上一轮还在响的音效，再按最新项目重跑本段
    stopAllSound();
    playedLogRef.current = 0;
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
      advanceOrFinish();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onToggleCollapsed();
    }
  };

  const canAdvance = state !== null && (state.status === 'line' || state.status === 'delay');
  const assetsReady = assets.library.available && assets.library.folder.trim() !== '';

  const current = state?.current ?? null;
  const enteredCharacters = (state?.stage.characters ?? []).filter((character) => character.entered);
  /** 层级高的画在上层：DOM 顺序靠后的盖住前面的 */
  const visibleTextBoxes = (state?.stage.textBoxes ?? [])
    .filter((item) => item.visible)
    .slice()
    .sort((a, b) => {
      const boxA = previewTextBoxOf(project, a.textBoxUid);
      const boxB = previewTextBoxOf(project, b.textBoxUid);
      return (boxA?.layer ?? 0) - (boxB?.layer ?? 0);
    });

  return (
    <div
      className="preview-pane"
      ref={panelRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="剧情预览"
    >
      <div className="preview-head">
        <h3 className="preview-title">剧情预览</h3>
        <span className="spacer" />
        {!collapsed && (
          <button
            type="button"
            className="mini"
            disabled={state === null}
            title="停止播放、清空预览（所有正在响的音效一起停）"
            onClick={stopPreview}
          >
            结束预览
          </button>
        )}
        <button
          type="button"
          className="mini"
          title={collapsed ? '展开预览' : '收起预览面板，把地方让给流程图'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '展开 ⏷' : '收起 ⏶'}
        </button>
      </div>

      {!collapsed && (state === null ? (
        <div className="preview-empty">
          <p>还没有开始预览。</p>
          <p className="hint">点对话列表里某一行的「预览」，或从当前段落开始：</p>
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
            <div className="preview-frame" ref={frameRef}>
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

              {visibleTextBoxes.map((item) => {
                const box = previewTextBoxOf(project, item.textBoxUid);
                if (box === undefined) return null;
                const mine = current !== null && current.textBoxUid === box.uid;
                return (
                  <TextBoxLayer
                    key={box.uid}
                    project={project}
                    byId={assets.library.byId}
                    host={assets.host}
                    box={box}
                    scale={frameScale}
                    speaker={previewTextOf(item.speaker, language)}
                    lines={item.lines.map((line) => previewTextOf(line, language))}
                    characters={enteredCharacters.filter(
                      (character) =>
                        project.characters.find((row) => row.uid === character.characterUid)
                          ?.textBoxUid === box.uid,
                    )}
                    language={language}
                    registerFinish={mine ? registerRevealFinish : undefined}
                  />
                );
              })}

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
                        {previewTextOf(option.text, language).trim() !== ''
                          ? previewTextOf(option.text, language)
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
            <button type="button" className="primary" onClick={advanceOrFinish} disabled={!canAdvance}>
              继续 ▶
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

          <div className="preview-toggles">
            <label className="preview-toggle" title="按「强制自动播放」与延时指令自动往下走">
              <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
              自动播放
            </label>
            <label
              className="preview-toggle"
              title="勾上后对话列表会自动滚动，让当前播放的那一行停在列表中间"
            >
              <input
                type="checkbox"
                checked={locked}
                onChange={(event) => onToggleLocked(event.target.checked)}
              />
              锁定到对话
            </label>
            <label className="preview-field preview-select">
              语言
              <select
                value={language}
                aria-label="预览语言"
                onChange={(event) => setLanguage(event.target.value as LangKey)}
              >
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="ja">日文</option>
              </select>
            </label>
            <label className="preview-field preview-volume">
              音量
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                aria-label="预览音量"
                onChange={(event) => setVolume(Number(event.target.value) / 100)}
              />
              <span className="preview-volume-value">{Math.round(volume * 100)}%</span>
            </label>
          </div>

          <div className="preview-log-bar">
            <button
              type="button"
              className="mini"
              onClick={() => setLogOpen((currentValue) => !currentValue)}
            >
              指令日志 {state.log.length}
            </button>
            {!assetsReady && (
              <span className="hint">桌面版 + 设置里选好素材文件夹才有真实画面与音效</span>
            )}
          </div>

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
      ))}
    </div>
  );
}
