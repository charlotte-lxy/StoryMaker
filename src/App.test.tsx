// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Line } from './core/types';
import {
  clearFakeHost,
  renderApp,
  seedEmptyProject,
  seedProjectFile,
  type FakeHost,
} from './testing/app-harness';
import { createEmptyProject } from './state/operations';
import { resetViewMemory } from './ui/view-memory';

/** 当前用例的假宿主：一块"磁盘" + 上次打开的项目路径 */
let host: FakeHost;

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  // 界面上所有改动都直接写进项目文件，所以每个用例都得先有一个项目文件
  host = seedEmptyProject();
  // jsdom 没有实现 scrollIntoView，跳转测试里会用到
  Element.prototype.scrollIntoView = () => undefined;
  // jsdom 也没有 DragEvent / PointerEvent。用 MouseEvent 顶上，testing-library 才会把
  // clientY / clientX 一起塞进事件里——插入位置和分栏比例都是按指针坐标算的。
  (window as unknown as { DragEvent: typeof MouseEvent }).DragEvent = window.MouseEvent;
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent;
});

afterEach(() => {
  cleanup();
  clearFakeHost();
  // 主题写在 <html> 上，不清掉会串到下一个用例
  delete document.documentElement.dataset.theme;
  // 滚动位置与子页面选择记在模块级，用例之间也要清掉
  resetViewMemory();
});

/** 左侧模块导航 */
const rail = () => screen.getByRole('navigation');

/** 假 dataTransfer：jsdom 里没有真实拖拽 */
function blockTransfer(kind: '对话' | '选项' | '指令') {
  return {
    types: ['application/x-storymaker-block'],
    getData: () => kind,
    setData: () => undefined,
    effectAllowed: 'copy',
    dropEffect: 'copy',
  };
}

/**
 * 派发一次拖放事件。
 *
 * jsdom 没有 DragEvent（见 beforeEach 里补的替身），走 testing-library 的封装，
 * 它会额外把 dataTransfer 挂到事件上。
 */
function fireDrag(
  type: 'dragover' | 'drop',
  target: HTMLElement,
  dataTransfer: unknown,
  clientY = 0,
): void {
  const init = { dataTransfer, clientY };
  if (type === 'dragover') fireEvent.dragOver(target, init);
  else fireEvent.drop(target, init);
}

/** 从脚本块区拖一个块到列表里（默认丢在末尾的追加区） */
function dropBlock(kind: '对话' | '选项' | '指令', target?: HTMLElement): void {
  const dataTransfer = blockTransfer(kind);
  const zone = target ?? screen.getByTitle('拖到这里追加到末尾');
  fireDrag('dragover', zone, dataTransfer);
  fireDrag('drop', zone, dataTransfer);
}

/** 单击脚本块（按标题找，避免和行里的类型标签撞名） */
function clickBlock(kind: '对话' | '选项' | '指令'): void {
  fireEvent.click(screen.getByTitle(`拖到列表里插入「${kind}」，或单击直接加到最后一行`));
}

/** 行内拖动排序用的 dataTransfer：不带脚本块标记 */
function rowTransfer() {
  return {
    types: [],
    getData: () => '',
    setData: () => undefined,
    effectAllowed: 'move',
    dropEffect: 'move',
  };
}

/** 给行卡片造出堆叠的真实几何：第 i 行占 [i*100, i*100+100] */
function stubCardRects(container: HTMLElement): void {
  const cards = [...container.querySelectorAll('.line-card')] as HTMLElement[];
  cards.forEach((card, index) => {
    card.getBoundingClientRect = () =>
      ({
        top: index * 100,
        bottom: index * 100 + 100,
        height: 100,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: index * 100,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

describe('界面冒烟测试', () => {
  it('渲染主界面与三个模块入口', async () => {
    await renderApp();
    expect(screen.getByText(/StoryMaker/)).toBeTruthy();
    expect(within(rail()).getByText('剧情')).toBeTruthy();
    expect(within(rail()).getByText('角色')).toBeTruthy();
    expect(within(rail()).getByText('本地化')).toBeTruthy();
  });

  it('空项目能渲染出默认的第一行对话', async () => {
    const { container } = await renderApp();
    // 列表里不再显示完整对话 ID，只在条目左侧标段内序号
    expect(container.querySelectorAll('.line-card')).toHaveLength(1);
    const seq = container.querySelector('.line-seq');
    expect(seq?.textContent).toBe('1');
    expect(seq?.getAttribute('title')).toBe('对话 ID：Dia_ch01_001-1');
    // 序号挂在整行容器上、在对话块外面（最左侧一列）
    expect(seq?.parentElement?.className).toBe('line-row');
    expect(container.querySelector('.line-card .line-seq')).toBeNull();
  });

  it('新增选项后，跳转目标默认是「对话结束」（即导出留空）', async () => {
    await renderApp();
    // 选项列表现在挂在「选项」行上，行里默认就带一个选项
    dropBlock('选项');
    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    expect(groupSelect.value).toBe('');
    expect(screen.getByText('（对话结束）')).toBeTruthy();
    // 第二级在对话结束时禁用
    expect((screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it('跳转目标可以选到具体段落与对话，再切回对话结束', async () => {
    await renderApp();
    dropBlock('选项');

    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: groupSelect.options[1].value } });

    const lineSelect = screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement;
    expect(lineSelect.disabled).toBe(false);
    expect(lineSelect.value).not.toBe('');

    fireEvent.change(groupSelect, { target: { value: '' } });
    expect(
      (screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('能切换到角色模块', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('角色'));
    expect(screen.getByText(/还没有角色/)).toBeTruthy();
  });

  it('新增角色后出现默认的 ID 与名称', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(screen.getByText(/新增角色/));
    expect(screen.getByDisplayValue('CHA_角色1')).toBeTruthy();
    expect(screen.getByDisplayValue('角色1')).toBeTruthy();
  });

  it('能切换到本地化模块，并列出默认那行的文本 key', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('本地化'));
    expect(screen.getAllByText('TXT_Dia_ch01_001-1').length).toBeGreaterThan(0);
  });

  describe('本地化模块：剧情 / UI 两页', () => {
    /** 一条剧情台词 + 两条 UI 文案 */
    function seedLocaleProject(): void {
      const project = createEmptyProject();
      project.chapters[0].groups[0].lines[0].text = { zh: '第一句台词', en: '', ja: '' };
      project.uiTexts = [
        {
          uid: 'ui-1',
          key: 'TXT_Widget_开始游戏',
          text: { zh: '开始游戏', en: 'Start Game', ja: 'ゲーム開始' },
        },
        { uid: 'ui-2', key: 'TXT_Widget_设置', text: { zh: '设置', en: '', ja: '' } },
      ];
      seedProjectFile(JSON.stringify(project));
    }

    /** 渲染界面并打开本地化模块 */
    async function openLocale(): Promise<void> {
      await renderApp();
      fireEvent.click(within(rail()).getByText('本地化'));
    }

    it('侧边栏分两页，默认停在自动收集的剧情本地化', async () => {
      seedLocaleProject();
      await openLocale();

      expect(screen.getByText('剧情本地化')).toBeTruthy();
      expect(screen.getByText('UI 本地化')).toBeTruthy();
      // 剧情这一页列出对话的文本 key，UI 的条目不在这一页
      expect(screen.getByText('TXT_Dia_ch01_001-1')).toBeTruthy();
      expect(screen.queryByDisplayValue('TXT_Widget_开始游戏')).toBeNull();

      fireEvent.click(screen.getByText('UI 本地化'));
      expect(screen.getByDisplayValue('TXT_Widget_开始游戏')).toBeTruthy();
      expect(screen.getByDisplayValue('TXT_Widget_设置')).toBeTruthy();
      expect(screen.queryByText('TXT_Dia_ch01_001-1')).toBeNull();
    });

    it('搜索框对着当前这一页模糊搜索 key 与三语文本', async () => {
      seedLocaleProject();
      await openLocale();

      const search = screen.getByPlaceholderText('搜索 key 或文本');

      // 剧情页里搜 UI 的 key：一条都不命中
      fireEvent.change(search, { target: { value: 'TXT_Widget' } });
      expect(screen.getByText(/没有匹配/)).toBeTruthy();

      // 切到 UI 页，同一个搜索框改成对着这一页的内容搜
      fireEvent.click(screen.getByText('UI 本地化'));
      expect(screen.getByDisplayValue('TXT_Widget_开始游戏')).toBeTruthy();
      expect(screen.getByDisplayValue('TXT_Widget_设置')).toBeTruthy();

      fireEvent.change(search, { target: { value: '设置' } });
      expect(screen.getByDisplayValue('TXT_Widget_设置')).toBeTruthy();
      expect(screen.queryByDisplayValue('TXT_Widget_开始游戏')).toBeNull();

      // 英文小写也能命中
      fireEvent.change(search, { target: { value: 'start game' } });
      expect(screen.getByDisplayValue('TXT_Widget_开始游戏')).toBeTruthy();
      expect(screen.queryByDisplayValue('TXT_Widget_设置')).toBeNull();
    });

    it('UI 本地化的新增表单在整个列表上方，key 必填且不能重名', async () => {
      seedLocaleProject();
      await openLocale();
      fireEvent.click(screen.getByText('UI 本地化'));

      /** 列表上方那一行新增表单 */
      const form = () => document.querySelector('.locale-add-form') as HTMLElement;
      const keyBox = () => within(form()).getByPlaceholderText('TXT_（必填，不能重名）');
      const addButton = () => within(form()).getByText('添加') as HTMLButtonElement;
      /** 列表里各行的 key */
      const keys = () =>
        [
          ...document.querySelectorAll('.locale-main tbody tr.line-row .loc-key input'),
        ].map((el) => (el as HTMLInputElement).value);

      // 表单在整张列表（含表头）上方，不是列表里的第一行
      expect(form().nextElementSibling?.tagName).toBe('TABLE');
      expect(form().closest('tbody')).toBeNull();
      // key 空着时点不了添加
      expect(addButton().disabled).toBe(true);

      // 和已有条目重名：当场报出来，还是点不了
      fireEvent.change(keyBox(), { target: { value: 'TXT_Widget_设置' } });
      expect(within(form()).getByText(/key 已存在/)).toBeTruthy();
      expect(addButton().disabled).toBe(true);

      // 换个没人用的 key，填上中文，点「添加」→ 插到第一行
      fireEvent.change(keyBox(), { target: { value: 'TXT_Widget_新游戏' } });
      fireEvent.change(within(form()).getByPlaceholderText('中文原文'), {
        target: { value: '新游戏' },
      });
      expect(addButton().disabled).toBe(false);
      fireEvent.click(addButton());

      expect(keys()).toEqual([
        'TXT_Widget_新游戏',
        'TXT_Widget_开始游戏',
        'TXT_Widget_设置',
      ]);
      // 表单清空，好接着填下一条
      expect((keyBox() as HTMLInputElement).value).toBe('');
      expect((within(form()).getByPlaceholderText('中文原文') as HTMLInputElement).value).toBe('');

      // 表单里按回车等同于点「添加」
      fireEvent.change(keyBox(), { target: { value: 'TXT_Widget_保存' } });
      fireEvent.keyDown(keyBox(), { key: 'Enter' });
      expect(keys()[0]).toBe('TXT_Widget_保存');

      // 删除：拿掉最上面那条
      const firstRow = document.querySelectorAll('.locale-main tbody tr.line-row')[0] as HTMLElement;
      fireEvent.click(within(firstRow).getByText('删除'));
      expect(keys()).not.toContain('TXT_Widget_保存');
    });

    it('UI 本地化一条都没有时，表单下面给出提示', async () => {
      await openLocale();
      fireEvent.click(screen.getByText('UI 本地化'));

      expect(
        screen.getByText(
          '还没有 UI 文本。在上面那个表单里填好 key 与译文，点「添加」就会插到列表最前面。',
        ),
      ).toBeTruthy();
    });
  });

  it('新增章节会出现在侧边栏', async () => {
    await renderApp();
    fireEvent.click(screen.getByText('＋ 章节'));
    expect(screen.getByText('第 2 章')).toBeTruthy();
  });

  it('删除章节走应用内确认框，不再用 window.confirm', async () => {
    // window.confirm 在 Electron 下会阻塞渲染进程、让输入控件失去响应，已全部替换
    const confirmSpy = vi.spyOn(window, 'confirm');
    await renderApp();
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('请确认')).toBeTruthy();
  });

  it('删除章节时取消，则章节保留', async () => {
    await renderApp();
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('请确认')).toBeNull();
    expect(screen.getByText('序章')).toBeTruthy();
  });

  it('确认后章节被删除', async () => {
    await renderApp();
    fireEvent.click(screen.getByText('＋ 章节'));
    fireEvent.click(screen.getAllByTitle('删除本章')[1]);
    fireEvent.click(screen.getByText('确定'));
    expect(screen.queryByText('第 2 章')).toBeNull();
  });

  it('删除段落时，确认文案会说明将丢失多少行', async () => {
    await renderApp();
    fireEvent.click(screen.getAllByTitle('删除本段落')[0]);
    expect(screen.getByText(/1 行内容/)).toBeTruthy();
  });

  it('确认框关掉之后，输入框和下拉框依然可用', async () => {
    await renderApp();
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    fireEvent.click(screen.getByText('取消'));

    // 关掉确认框后随便改一个输入框，确认界面没被"冻住"
    const nameInput = screen.getByTitle('项目名称，也是导出文件名') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '还能改' } });
    expect(nameInput.value).toBe('还能改');
  });
});

describe('设置、自动保存与自动加载', () => {
  /** 项目名称输入框：改它就是"编辑了一下项目" */
  const nameInput = () => screen.getByTitle('项目名称，也是导出文件名');

  it('左侧栏左下角有设置入口，点进去是设置页', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('设置'));
    expect(screen.getByText('自动保存')).toBeTruthy();
    expect(screen.getByText('深色')).toBeTruthy();
  });

  it('自动保存默认开启：编辑后自动写回项目文件', async () => {
    await renderApp();
    fireEvent.change(nameInput(), { target: { value: '序章改名' } });

    // 自动保存是防抖 800ms 的
    await waitFor(() => expect(host.written.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(host.written[host.written.length - 1]?.content).toContain('序章改名');
    expect(host.disk.get('D:\\策划\\项目.json')).toContain('序章改名');
  });

  it('关掉自动保存后，编辑不再写项目文件', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('设置'));
    fireEvent.click(screen.getByRole('checkbox')); // 关掉自动保存
    expect(screen.getByText(/不会自动写回项目文件/)).toBeTruthy();

    fireEvent.change(nameInput(), { target: { value: '不该被自动保存' } });
    await new Promise((done) => setTimeout(done, 1000));
    expect(host.written).toHaveLength(0);
  });

  it('切到深色会写到 <html data-theme>，并把设置记下来', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('设置'));
    fireEvent.click(screen.getByText('深色'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    const saved = JSON.parse(window.localStorage.getItem('storymaker.settings.v1') ?? '{}') as {
      theme?: string;
    };
    expect(saved.theme).toBe('dark');
  });

  it('启动时按上次的设置恢复深色主题', async () => {
    window.localStorage.setItem(
      'storymaker.settings.v1',
      JSON.stringify({ autoSave: true, theme: 'dark' }),
    );
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('启动时按上次打开的项目文件把内容读回来', async () => {
    seedProjectFile(JSON.stringify({ version: 1, name: '上次的项目', chapters: [] }));
    await renderApp();
    expect(screen.getByDisplayValue('上次的项目')).toBeTruthy();
  });
});

describe('脚本块与三种类型的行', () => {
  /** 列表里每一行的类型标签与对话 ID */
  const rows = (container: HTMLElement) => ({
    kinds: [...container.querySelectorAll('.line-card .type-tag')].map((el) => el.textContent),
    // 序号在对话块外面（最左侧一列），所以不从 .line-card 里找
    seqs: [...container.querySelectorAll('.line-seq')].map((el) => el.textContent),
  });

  it('拖入「选项」行：默认带一个选项，ID 接着上一行连续编号', async () => {
    const { container } = await renderApp();
    dropBlock('选项');

    expect(rows(container)).toEqual({ kinds: ['对话', '选项'], seqs: ['1', '2'] });
    // 选项 ID 是所属行 ID 加字母后缀
    expect(screen.getByText('Dia_ch01_001-2A')).toBeTruthy();
    expect(screen.getByTitle('第一级：目标段落')).toBeTruthy();
  });

  it('把块拖到某一行上，就插在那一行之后', async () => {
    const { container } = await renderApp();
    dropBlock('指令', container.querySelector('[data-line-uid]') as HTMLElement);
    expect(rows(container).kinds).toEqual(['对话', '指令']);
  });

  it('「指令」行只放一条指令，预览与下拉都是横向的', async () => {
    await renderApp();
    dropBlock('指令');

    expect(screen.getByPlaceholderText('点这里手写指令，或用右侧下拉选择')).toBeTruthy();
    expect(screen.getByTitle('选择指令')).toBeTruthy();
    // 一行只有一条指令，没有"再加一条"的按钮
    expect(screen.queryByText('＋ 新增指令')).toBeNull();
  });

  it('行可以删除', async () => {
    await renderApp();
    dropBlock('指令');
    expect(screen.getAllByText('删除')).toHaveLength(2);

    fireEvent.click(screen.getAllByText('删除')[1]);
    expect(screen.getAllByText('删除')).toHaveLength(1);
  });

  it('备注：点开能写，写过的条目标出来，悬浮时显示内容', async () => {
    await renderApp();
    fireEvent.click(screen.getByText('备注'));

    const input = screen.getByPlaceholderText('例如：这句要等 BGM 淡出后再进');
    fireEvent.change(input, { target: { value: '等 BGM 淡出再进' } });

    const button = screen.getByText('备注');
    expect(button.className).toContain('has-note');
    expect(button.getAttribute('data-note')).toBe('等 BGM 淡出再进');
  });

  it('单击脚本块直接加到最后一行', async () => {
    const { container } = await renderApp();
    clickBlock('选项');
    expect(rows(container)).toEqual({
      kinds: ['对话', '选项'],
      seqs: ['1', '2'],
    });
  });

  it('「选项」行的字段顺序：选项文本 → 跳转目标 → 出现条件 → 可用条件 → 结果', async () => {
    const { container } = await renderApp();
    dropBlock('选项');

    const labels = [...container.querySelectorAll('.option-item .field > span')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['选项文本（中文）', '跳转目标', '出现条件', '可用条件', '结果（指令）']);
  });

  it('拖到两行之间的分界线上也能插入（不必躲开那条线）', async () => {
    const { container } = await renderApp();
    clickBlock('指令');
    expect(rows(container).kinds).toEqual(['对话', '指令']);

    stubCardRects(container);

    const list = container.querySelector('.line-list') as HTMLElement;
    const dataTransfer = blockTransfer('对话');
    // clientY = 100 正好是那条横线所在的位置
    fireDrag('dragover', list, dataTransfer, 100);
    fireDrag('drop', list, dataTransfer, 100);

    expect(rows(container).kinds).toEqual(['对话', '对话', '指令']);
  });

  it('整行空白处都能按住拖动排序', async () => {
    const { container } = await renderApp();
    clickBlock('指令');
    stubCardRects(container);

    const list = container.querySelector('.line-list') as HTMLElement;
    const cards = [...container.querySelectorAll('.line-card')] as HTMLElement[];

    // 从第二行的空白处起拖（没有先点进任何输入框）
    fireEvent.dragStart(cards[1], { dataTransfer: rowTransfer() });
    expect(cards[1].className).toContain('dragging');

    // 丢到最上面
    fireDrag('dragover', list, rowTransfer(), 0);
    fireDrag('drop', list, rowTransfer(), 0);
    expect(rows(container).kinds).toEqual(['指令', '对话']);
  });

  it('在输入框里起拖是选文字，不会把整行搬走', async () => {
    const { container } = await renderApp();
    clickBlock('指令');
    const card = container.querySelector('.line-card') as HTMLElement;
    const textarea = card.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.mouseDown(textarea);
    fireEvent.dragStart(card, { dataTransfer: rowTransfer() });

    expect(card.className).not.toContain('dragging');
  });

  it('正在编辑的行会整块换色', async () => {
    const { container } = await renderApp();
    const card = container.querySelector('.line-card') as HTMLElement;
    const textarea = card.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.focusIn(textarea);
    expect(card.className).toContain('editing');

    fireEvent.focusOut(textarea);
    expect(card.className).not.toContain('editing');
  });

  it('指令预览框宽度固定，切模块回来后下拉框仍然显示选好的项', async () => {
    await renderApp();

    // 先加个角色，下拉里才有目标可选
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(screen.getByText(/新增角色/));
    fireEvent.click(within(rail()).getByText('剧情'));

    dropBlock('指令');
    const defSelect = screen.getByTitle('选择指令') as HTMLSelectElement;
    const picked = defSelect.options[1].value;
    fireEvent.change(defSelect, { target: { value: picked } });

    const targetSelect = screen.getByTitle('目标对象') as HTMLSelectElement;
    expect(targetSelect.value).toBe('CHA_角色1');

    // 切走再回来：下拉框要按预览框里的指令重新解析出来
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(within(rail()).getByText('剧情'));

    expect((screen.getByTitle('选择指令') as HTMLSelectElement).value).toBe(picked);
    expect((screen.getByTitle('目标对象') as HTMLSelectElement).value).toBe('CHA_角色1');
  });
});

describe('章节流程图与分栏', () => {
  /** 两个段落，段落 001 的选项跳到段落 002 */
  function seedJumpProject(): void {
    seedProjectFile(
      JSON.stringify({
        version: 1,
        name: '流程测试',
        characters: [],
        items: [],
        quests: [],
        images: [],
        sounds: [],
        commands: [],
        variables: [],
        chapters: [
          {
            uid: 'c1',
            id: 'ch01',
            title: '序章',
            groups: [
              {
                uid: 'g1',
                id: '001',
                title: '开场',
                lines: [
                  {
                    uid: 'l1',
                    readableId: 'Dia_ch01_001-1',
                    kind: '选项',
                    characterId: '',
                    displayName: '',
                    text: { zh: '', en: '', ja: '' },
                    autoAdvance: false,
                    command: '',
                    optionIds: ['o1'],
                    note: '',
                  },
                ],
                options: [
                  {
                    uid: 'o1',
                    readableId: 'Dia_ch01_001-1A',
                    text: { zh: '去码头', en: '', ja: '' },
                    nextId: 'l2',
                    appearConditions: [],
                    enableConditions: [],
                    results: [],
                  },
                ],
              },
              {
                uid: 'g2',
                id: '002',
                title: '码头',
                lines: [
                  {
                    uid: 'l2',
                    readableId: 'Dia_ch01_002-1',
                    kind: '对话',
                    characterId: '',
                    displayName: '',
                    text: { zh: '海风很大', en: '', ja: '' },
                    autoAdvance: false,
                    command: '',
                    optionIds: [],
                    note: '',
                  },
                ],
                options: [],
              },
            ],
          },
        ],
      }),
      'D:\\策划\\流程测试.json',
    );
  }

  it('每个段落一个块，选项跳转连成一条带标签的线', async () => {
    seedJumpProject();
    const { container } = await renderApp();

    const blocks = [...container.querySelectorAll('.flow-block-title')].map((el) => el.textContent);
    expect(blocks).toEqual(['开场', '码头']);
    expect(container.querySelectorAll('.flow-line')).toHaveLength(1);
    // 线中间那个标签就是选项文本（选项编辑器里也有同样的文字，所以按类名取）
    expect(container.querySelector('.flow-edge-label')?.textContent).toBe('去码头');
  });

  it('点流程图上的选项标签跳到那个选项', async () => {
    seedJumpProject();
    const { container } = await renderApp();

    // 先切到段落 002，让列表停在别处
    fireEvent.click(screen.getByTitle('打开「码头」的对话列表'));
    expect(container.querySelector('.line-card')?.getAttribute('data-line-uid')).toBe('l2');

    fireEvent.click(screen.getByTitle(/去码头/));
    expect(container.querySelector('.line-card')?.getAttribute('data-line-uid')).toBe('l1');
    expect(container.querySelector('.option-item.flash')).toBeTruthy();
  });

  it('拖中间的分隔线改变左右宽度', async () => {
    seedJumpProject();
    const { container } = await renderApp();

    const split = container.querySelector('.story-split') as HTMLElement;
    split.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const handle = container.querySelector('.split-handle') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);

    expect((container.querySelector('.flow-pane') as HTMLElement).style.flexBasis).toBe('30%');
  });

  it('可以收起对话列表，点段落块再展开', async () => {
    seedJumpProject();
    const { container } = await renderApp();
    expect(container.querySelector('.list-pane')).not.toBeNull();

    fireEvent.click(screen.getByText('收起对话列表 ▶'));
    expect(container.querySelector('.list-pane')).toBeNull();
    expect(container.querySelector('.split-handle')).toBeNull();

    fireEvent.click(screen.getByTitle('打开「码头」的对话列表'));
    expect(container.querySelector('.list-pane')).not.toBeNull();
  });

  it('点 ✎ 能改章节名和段落名（侧边栏）', async () => {
    seedJumpProject();
    const { container } = await renderApp();
    const sidebar = within(container.querySelector('.sidebar') as HTMLElement);

    fireEvent.click(screen.getByTitle('重命名章节「序章」'));
    const chapterInput = container.querySelector('.tree-chapter .rename-input') as HTMLInputElement;
    fireEvent.change(chapterInput, { target: { value: '序章改名' } });
    fireEvent.keyDown(chapterInput, { key: 'Enter' });

    expect(container.querySelector('.tree-chapter .chapter-title')?.textContent).toBe('序章改名');
    // 流程图标题跟着一起变
    expect(screen.getByText('序章改名 · 段落流程')).toBeTruthy();

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const groupInput = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(groupInput, { target: { value: '开场改名' } });
    fireEvent.keyDown(groupInput, { key: 'Enter' });

    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场改名');
    expect(container.querySelector('.flow-block-title')?.textContent).toBe('开场改名');
  });

  it('流程图块里也能改名、写段落注释', async () => {
    seedJumpProject();
    const { container } = await renderApp();
    const block = container.querySelectorAll('.flow-block')[0] as HTMLElement;
    const inBlock = within(block);

    // 改名：回车生效，侧边栏同步
    fireEvent.click(inBlock.getByTitle('重命名段落「开场」'));
    const nameInput = container.querySelector('.flow-block .rename-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '开场（图上改的）' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(container.querySelector('.flow-block-title')?.textContent).toBe('开场（图上改的）');
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场（图上改的）');

    // 写注释：失焦保存，块上直接显示出来
    fireEvent.click(inBlock.getByTitle('加段落注释'));
    const noteInput = container.querySelector('.flow-block-note-input') as HTMLTextAreaElement;
    fireEvent.change(noteInput, { target: { value: '这里要接一场雨戏' } });
    fireEvent.blur(noteInput);
    expect(container.querySelector('.flow-block-note')?.textContent).toBe('这里要接一场雨戏');
  });

  it('段落注释写长了，块会跟着变高', async () => {
    const { container } = await renderApp();
    const block = container.querySelector('.flow-block') as HTMLElement;
    const baseHeight = Number.parseInt(block.style.minHeight, 10);

    fireEvent.click(within(block).getByTitle('加段落注释'));
    const noteInput = container.querySelector('.flow-block-note-input') as HTMLTextAreaElement;
    fireEvent.change(noteInput, {
      target: { value: '这是一段很长的段落注释，用来看块会不会随着内容自动向下延伸，而不是把文字截掉。' },
    });
    fireEvent.blur(noteInput);

    const height = Number.parseInt(
      (container.querySelector('.flow-block') as HTMLElement).style.minHeight,
      10,
    );
    expect(height).toBeGreaterThan(baseHeight);
  });

  it('改名字时 Esc 取消，空名字不生效', async () => {
    seedJumpProject();
    const { container } = await renderApp();
    const sidebar = within(container.querySelector('.sidebar') as HTMLElement);

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const input = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不要这个名字' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场');

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const again = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场');
  });

  it('鼠标悬浮某条选项线时它加粗，其他线淡化，两端段落块保持清楚', async () => {
    seedJumpProject();
    const { container } = await renderApp();

    const board = () => container.querySelector('.flow-board') as HTMLElement;
    const label = container.querySelector('.flow-edge-label') as HTMLElement;
    expect(board().className).not.toContain('dimming');

    fireEvent.mouseEnter(label);
    expect(board().className).toContain('dimming');
    expect(container.querySelector('.flow-edge-label')?.className).toContain('active');
    // SVG 元素的 className 不是字符串，要用 getAttribute
    expect(container.querySelector('.flow-line')?.getAttribute('class')).toContain('active');
    // 线两端的段落块（开场、码头）保持清楚，其他块被淡化
    const highlighted = [...container.querySelectorAll('.flow-block')].filter((block) =>
      block.className.includes('active'),
    );
    expect(highlighted.map((block) => block.getAttribute('data-block-uid'))).toEqual(['g1', 'g2']);

    fireEvent.mouseLeave(label);
    expect(board().className).not.toContain('dimming');
  });

  it('鼠标悬浮段落块时，与它有关的选项线高亮', async () => {
    seedJumpProject();
    const { container } = await renderApp();

    // 悬停「码头」（只有一条线指向它）
    const target = container.querySelectorAll('.flow-block')[1] as HTMLElement;
    fireEvent.mouseEnter(target);

    expect(container.querySelector('.flow-line')?.getAttribute('class')).toContain('active');
    const highlighted = [...container.querySelectorAll('.flow-block')].filter((block) =>
      block.className.includes('active'),
    );
    expect(highlighted).toHaveLength(2); // 自己 + 线另一端的「开场」

    fireEvent.mouseLeave(target);
    expect(container.querySelector('.flow-line')?.getAttribute('class')).not.toContain('active');
  });

  it('跳转目标下拉只列本章的段落', async () => {    await renderApp();
    fireEvent.click(screen.getByText('＋ 章节'));
    dropBlock('选项');

    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    expect([...groupSelect.options].map((option) => option.textContent)).toEqual([
      '（对话结束）',
      '序章 / 开场',
    ]);
  });
});

describe('对话列表的批量编辑', () => {
  /** 段落 001 三行，段落 002 一行，够试勾选、移动与删除 */
  function lineOf(uid: string, readableId: string, zh: string): Line {
    return {
      uid,
      readableId,
      kind: '对话',
      characterId: '',
      displayName: '',
      text: { zh, en: '', ja: '' },
      autoAdvance: false,
      command: '',
      optionIds: [],
      note: '',
    };
  }

  function seedBatchProject(): void {
    const project = createEmptyProject();
    const chapter = project.chapters[0];
    chapter.groups[0].lines = [
      lineOf('l1', 'Dia_ch01_001-1', '第一句'),
      lineOf('l2', 'Dia_ch01_001-2', '第二句'),
      lineOf('l3', 'Dia_ch01_001-3', '第三句'),
    ];
    chapter.groups.push({
      uid: 'g2',
      id: '002',
      title: '码头',
      note: '',
      lines: [lineOf('l4', 'Dia_ch01_002-1', '码头的一句')],
      options: [],
    });
    seedProjectFile(JSON.stringify(project));
  }

  /** 进入批量编辑模式 */
  async function openBatch(): Promise<HTMLElement> {
    const { container } = await renderApp();
    expect(container.querySelectorAll('.line-select')).toHaveLength(0);
    fireEvent.click(screen.getByText('批量编辑'));
    return container.querySelector('.list-pane') as HTMLElement;
  }

  it('点「批量编辑」后每行左边出现选择框，勾中的行整块高亮', async () => {
    seedBatchProject();
    const pane = await openBatch();

    const boxes = pane.querySelectorAll('.line-select');
    expect(boxes).toHaveLength(3);

    fireEvent.click(boxes[1]);
    expect(pane.querySelectorAll('.line-row')[1].className).toContain('selected');
    expect(screen.getByText('已选 1 / 3 行')).toBeTruthy();

    // 再点一次就是取消勾选
    fireEvent.click(pane.querySelectorAll('.line-select')[1]);
    expect(pane.querySelectorAll('.line-row')[1].className).not.toContain('selected');

    // 退出批量编辑后选择框收起来
    fireEvent.click(screen.getByText('退出批量编辑'));
    expect(pane.querySelectorAll('.line-select')).toHaveLength(0);
  });

  it('「全选」勾上当前段落的每一行', async () => {
    seedBatchProject();
    const pane = await openBatch();

    fireEvent.click(screen.getByText('全选'));
    expect(screen.getByText('已选 3 / 3 行')).toBeTruthy();
    expect(
      [...pane.querySelectorAll('.line-row')].every((row) => row.className.includes('selected')),
    ).toBe(true);
  });

  it('「移动至」用两级下拉选目标段落，确认后搬过去并重新编号', async () => {
    seedBatchProject();
    const pane = await openBatch();

    fireEvent.click(pane.querySelectorAll('.line-select')[1]);
    fireEvent.click(screen.getByText('移动至'));

    const chapterSelect = screen.getByTitle('第一级：目标章节') as HTMLSelectElement;
    const groupSelect = screen.getByTitle('第二级：目标段落（该章节内）') as HTMLSelectElement;
    expect(groupSelect.disabled).toBe(true);

    fireEvent.change(chapterSelect, { target: { value: chapterSelect.options[1].value } });
    expect(groupSelect.disabled).toBe(false);

    const dock = [...groupSelect.options].find((option) => option.textContent?.startsWith('码头'));
    fireEvent.change(groupSelect, { target: { value: dock?.value ?? '' } });
    fireEvent.click(screen.getByText('移动'));

    // 搬走的那行不在当前列表里了，留下的两行编号接着排
    expect(pane.querySelectorAll('.line-card')).toHaveLength(2);
    expect(
      [...pane.querySelectorAll('.line-seq')].map((seq) => seq.getAttribute('title')),
    ).toEqual(['对话 ID：Dia_ch01_001-1', '对话 ID：Dia_ch01_001-2']);

    // 切到「码头」：搬过去的行在末尾，ID 按新段落重排
    fireEvent.click(screen.getByTitle('打开「码头」的对话列表'));
    expect(screen.getByDisplayValue('第二句')).toBeTruthy();
    expect(
      [...document.querySelectorAll('.list-pane .line-seq')].map((seq) => seq.getAttribute('title')),
    ).toEqual(['对话 ID：Dia_ch01_002-1', '对话 ID：Dia_ch01_002-2']);
  });

  it('「批量删除」要先确认，取消不动、确定才删干净', async () => {
    seedBatchProject();
    const pane = await openBatch();

    fireEvent.click(screen.getByText('全选'));
    fireEvent.click(screen.getByText('批量删除'));
    expect(screen.getByText(/确定删除勾选的 3 行吗/)).toBeTruthy();

    fireEvent.click(screen.getByText('取消'));
    expect(pane.querySelectorAll('.line-card')).toHaveLength(3);

    fireEvent.click(screen.getByText('批量删除'));
    fireEvent.click(screen.getByText('确定'));
    expect(pane.querySelectorAll('.line-card')).toHaveLength(0);
    expect(pane.querySelector('.line-empty')).toBeTruthy();
  });
});

describe('校验面板', () => {
  it('默认收起只显示条数，点「校验」展开，点一条问题会跳到出问题的那一行', async () => {
    const { container } = await renderApp();

    // 校验是自动跑的：还没点就已有条数，但列表是收起的
    expect(container.querySelectorAll('.issue-row')).toHaveLength(0);
    expect(container.querySelector('.issues .badge.warn')?.textContent).toBe('建议检查 2');

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    const issues = [...container.querySelectorAll('.issue-row')];
    expect(issues.length).toBeGreaterThan(0);

    fireEvent.click(issues[0]);
    expect(container.querySelector('.line-card.flash')).toBeTruthy();
  });

  it('校验结果能收起、能再展开', async () => {
    const { container } = await renderApp();

    fireEvent.click(screen.getByTitle('展开校验结果'));
    expect(container.querySelectorAll('.issue-row').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('收起校验结果'));
    expect(container.querySelectorAll('.issue-row')).toHaveLength(0);

    fireEvent.click(screen.getByTitle('展开校验结果'));
    expect(container.querySelectorAll('.issue-row').length).toBeGreaterThan(0);
  });

  it('改动之后自动重算，条数跟着变', async () => {
    const { container } = await renderApp();
    expect(container.querySelector('.issues .badge.warn')?.textContent).toBe('建议检查 2');

    // 填上台词：少一条「空台词」的建议
    fireEvent.change(screen.getByPlaceholderText('中文台词'), { target: { value: '你好。' } });
    expect(container.querySelector('.issues .badge.warn')?.textContent).toBe('建议检查 1');
  });
});

describe('本地化模块的校验条', () => {
  /** 一条有中文、缺英文日文的台词 */
  function seedUntranslated(): void {
    const project = createEmptyProject();
    project.chapters[0].groups[0].lines[0].text = { zh: '你好。', en: '', ja: '' };
    seedProjectFile(JSON.stringify(project));
  }

  it('贴在本地化界面最下方：校验自动跑好，平时只显示条数', async () => {
    seedUntranslated();
    await renderApp();
    fireEvent.click(within(rail()).getByText('本地化'));

    const panel = document.querySelector('.issues') as HTMLElement;
    expect(panel.textContent).toContain('本地化校验结果');
    expect(panel.querySelector('.badge.warn')?.textContent).toBe('建议检查 1');
    expect(panel.querySelectorAll('.issue-row')).toHaveLength(0);
  });

  it('点条目定位到本地化表里的那一行，补上译文后条数自动清零', async () => {
    seedUntranslated();
    await renderApp();
    fireEvent.click(within(rail()).getByText('本地化'));

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    const rows = [...document.querySelectorAll('.issue-row')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('TXT_Dia_ch01_001-1');
    expect(rows[0].textContent).toContain('缺英文、日文');

    // 点它就滚到并高亮本地化表里的那一行
    fireEvent.click(rows[0]);
    expect(document.querySelector('.locale-main tr.flash')).toBeTruthy();

    // 补上英文：还缺日文，条数不变
    const translated = screen.getAllByPlaceholderText('待翻译');
    fireEvent.change(translated[0], { target: { value: 'Hi.' } });
    expect(document.querySelector('.issues .badge.warn')?.textContent).toBe('建议检查 1');

    // 补上日文：这一条没问题了
    fireEvent.change(translated[1], { target: { value: 'こんにちは。' } });
    expect(document.querySelector('.issues .badge.ok')?.textContent).toBe('没有问题');
  });
});

describe('战斗模块', () => {
  /** 打开战斗模块 */
  async function openBattle(): Promise<void> {
    await renderApp();
    fireEvent.click(within(rail()).getByText('战斗'));
  }

  it('侧边栏有七个子模块，默认停在属性表', async () => {
    await openBattle();

    expect([...document.querySelectorAll('.battle-nav')].map((nav) => nav.textContent)).toEqual([
      '属性（AS）0',
      '事件（Event）0',
      '效果（GE）0',
      '技能（GA）0',
      '角色预设0',
      '武器0',
      'GameplayTags管理器',
    ]);
    expect(screen.getByText('属性表（AS）')).toBeTruthy();
  });

  it('新增属性后，GameplayTags 管理器里出现合成好的 Tag，备注能改', async () => {
    await openBattle();
    fireEvent.click(screen.getByText('＋ 新增属性'));
    fireEvent.change(screen.getByPlaceholderText('属性名'), { target: { value: '生命值' } });

    fireEvent.click(screen.getByText('GameplayTags管理器'));

    expect(screen.getByText('GAS.属性.生命值')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('给自己看的备注'), { target: { value: '血量' } });
    expect(screen.getByDisplayValue('血量')).toBeTruthy();
  });

  it('效果页能加修改器：属性名从属性表里选，运算符可选', async () => {
    await openBattle();
    fireEvent.click(screen.getByText('＋ 新增属性'));
    fireEvent.change(screen.getByPlaceholderText('属性名'), { target: { value: '生命值' } });

    fireEvent.click(screen.getByText('效果（GE）'));
    fireEvent.click(screen.getByText('＋ 新增效果'));
    fireEvent.click(screen.getByText('＋ 添加修改器'));

    const attribute = screen.getByTitle('属性名') as HTMLSelectElement;
    expect([...attribute.options].map((option) => option.value)).toEqual(['', '生命值']);
    expect(attribute.value).toBe('生命值');

    fireEvent.change(screen.getByTitle('运算符'), { target: { value: '-' } });
    fireEvent.change(screen.getByPlaceholderText('参数名或数值'), { target: { value: 'Damage' } });
    expect((screen.getByTitle('运算符') as HTMLSelectElement).value).toBe('-');
  });

  it('技能页的锁定 GA 与监听事件是多选，勾完按钮上能看到选了谁', async () => {
    await openBattle();

    // 两个技能 + 一个事件
    fireEvent.click(screen.getByText('技能（GA）'));
    fireEvent.click(screen.getByText('＋ 新增技能'));
    fireEvent.click(screen.getByText('＋ 新增技能'));
    const skillNames = screen.getAllByPlaceholderText('技能名');
    fireEvent.change(skillNames[0], { target: { value: '回血' } });
    fireEvent.change(skillNames[1], { target: { value: '防御' } });

    fireEvent.click(screen.getByText('事件（Event）'));
    fireEvent.click(screen.getByText('＋ 新增事件'));
    fireEvent.change(screen.getByPlaceholderText('事件名'), { target: { value: '受击' } });

    fireEvent.click(screen.getByText('技能（GA）'));
    const listens = screen.getAllByTitle('勾选这个技能要监听的事件');
    fireEvent.click(listens[0]);

    // 菜单挂在 body 上，不在表格里：表格外面套着横向滚动容器，挂在里面会被裁掉
    const menu = document.querySelector('.multi-menu') as HTMLElement;
    expect(menu.parentElement).toBe(document.body);
    expect(document.querySelector('table .multi-menu')).toBeNull();

    fireEvent.click(screen.getByText('受击'));

    // 菜单里勾上之后，按钮上也会显示已选的事件
    expect(within(listens[0]).getByText('受击')).toBeTruthy();

    const locks = screen.getAllByTitle('勾选这个技能要锁定的其他技能');
    fireEvent.click(locks[0]);
    fireEvent.click(screen.getByText('防御'));
    expect(within(locks[0]).getByText('防御')).toBeTruthy();
  });

  it('底部有战斗校验条：属性名重复报「必须修复」，点它能跳到那一行', async () => {
    await openBattle();
    fireEvent.click(screen.getByText('＋ 新增属性'));
    fireEvent.click(screen.getByText('＋ 新增属性'));

    const names = screen.getAllByPlaceholderText('属性名');
    fireEvent.change(names[0], { target: { value: '生命值' } });
    fireEvent.change(names[1], { target: { value: '生命值' } });

    const panel = document.querySelector('.issues') as HTMLElement;
    expect(panel.textContent).toContain('战斗校验结果');
    expect(panel.querySelector('.badge.error')?.textContent).toBe('必须修复 1');
    expect(panel.querySelectorAll('.issue-row')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    const rows = [...document.querySelectorAll('.issue-row')];
    expect(rows[0].textContent).toContain('属性名「生命值」');

    fireEvent.click(rows[0]);
    expect(document.querySelector('.battle-nav.active')?.textContent).toContain('属性');
    expect(document.querySelector('tr.line-row.flash')).toBeTruthy();
  });
});

describe('导出模块', () => {
  /** 打开导出模块 */
  async function openExport(): Promise<void> {
    await renderApp();
    fireEvent.click(within(rail()).getByText('导出'));
  }

  it('侧边栏两个子页面 + 底部工具按钮列表，导出 Excel 从顶部挪到了这里', async () => {
    const { container } = await renderApp();

    // 顶部工具条上不再有导出按钮
    const toolbarButtons = [...container.querySelectorAll('.toolbar button')].map((button) =>
      button.textContent?.trim(),
    );
    expect(toolbarButtons).not.toContain('导出 Excel');

    fireEvent.click(within(rail()).getByText('导出'));

    expect([...document.querySelectorAll('.export-nav')].map((nav) => nav.textContent)).toEqual([
      'Unreal导入设置',
      '导出预览',
    ]);
    expect(document.querySelector('.export-tools-head')?.textContent).toBe('工具');
    expect([...document.querySelectorAll('.export-tool')].map((button) => button.textContent)).toEqual([
      '导出 Excel',
    ]);
    expect(screen.getByText('Unreal 导入设置')).toBeTruthy();
  });

  it('工具按钮能真的导出：点了会走导出流程', async () => {
    await openExport();
    fireEvent.click(screen.getByText('导出 Excel'));
    await waitFor(() => expect(host.bridge.exportFile).toHaveBeenCalled());
  });

  it('导入设置能新增一行：三列都在，子表下拉列出所有参与导出的子表', async () => {
    await openExport();
    fireEvent.click(screen.getByText('＋ 新增数据表'));

    fireEvent.change(screen.getByPlaceholderText('TB_'), { target: { value: 'TB_GAS_Ability' } });
    fireEvent.change(screen.getByPlaceholderText('GameContent/BP/…'), {
      target: { value: 'GameContent/BP/GAS/GA' },
    });

    const subTable = screen.getByTitle('这张数据表的内容来自哪个子表') as HTMLSelectElement;
    expect([...subTable.options].map((option) => option.value)).toEqual([
      '',
      '对话',
      '选项',
      '本地化',
      'GASGameplayTags',
      'GAS属性',
      'GAS效果',
      'GAS技能',
      'GAS事件',
      'GAS角色',
      'GAS武器',
      '导入设置',
    ]);
    fireEvent.change(subTable, { target: { value: 'GAS技能' } });
    expect(subTable.value).toBe('GAS技能');
  });

  it('导出预览：一排子表按钮，点哪个看哪个', async () => {
    await openExport();
    fireEvent.click(screen.getByText('导出预览'));

    const tabs = [...document.querySelectorAll('.sheet-tab')].map((tab) =>
      tab.textContent?.replace(/\d+$/, ''),
    );
    expect(tabs).toEqual([
      '对话',
      '选项',
      '本地化',
      'GASGameplayTags',
      'GAS属性',
      'GAS效果',
      'GAS技能',
      'GAS事件',
      'GAS角色',
      'GAS武器',
      '导入设置',
    ]);

    // 默认停在第一张：对话表，表头就是导出用的那一行
    const headers = () =>
      [...document.querySelectorAll('.preview-table thead th')].map((th) => th.textContent);
    expect(headers()).toEqual([
      '（行名）',
      '文本类型',
      '角色ID',
      '角色显示名称',
      '强制自动播放下一对话',
      '文本ID',
      '选项列表',
      '指令列表',
    ]);

    // 切到导入设置：表头换成算出来的两列
    fireEvent.click(screen.getByText('导入设置'));
    expect(headers()).toEqual(['（行名）', '数据表引用', 'csv文件路径']);
  });
});

describe('滚动位置记忆', () => {
  /** jsdom 不做排版，scrollTop 永远是 0：临时把它换成真能存取的，测完还原 */
  function stubScrollTop(): () => void {
    const tops = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        // 真浏览器里，已经从文档摘掉的元素读出来就是 0，桩也照这个来
        return this.isConnected ? (tops.get(this) ?? 0) : 0;
      },
      set(this: HTMLElement, value: number) {
        tops.set(this, value);
      },
    });
    return () => {
      delete (HTMLElement.prototype as unknown as { scrollTop?: unknown }).scrollTop;
    };
  }

  it('对话列表滚动后切到别的模块再回来，还停在原处', async () => {
    const { container } = await renderApp();
    const restore = stubScrollTop();

    try {
      const editor = container.querySelector('.list-pane .editor') as HTMLElement;
      editor.scrollTop = 320;
      fireEvent.scroll(editor);

      fireEvent.click(within(rail()).getByText('角色'));
      expect(container.querySelector('.list-pane')).toBeNull();

      fireEvent.click(within(rail()).getByText('剧情'));
      const back = container.querySelector('.list-pane .editor') as HTMLElement;
      expect(back.scrollTop).toBe(320);
    } finally {
      restore();
    }
  });

  it('角色表滚动后切走再回来，也停在原处', async () => {
    const { container } = await renderApp();
    const restore = stubScrollTop();

    try {
      fireEvent.click(within(rail()).getByText('角色'));
      const table = container.querySelector('.editor') as HTMLElement;
      table.scrollTop = 180;
      fireEvent.scroll(table);

      fireEvent.click(within(rail()).getByText('剧情'));
      fireEvent.click(within(rail()).getByText('角色'));

      expect((container.querySelector('.editor') as HTMLElement).scrollTop).toBe(180);
    } finally {
      restore();
    }
  });

  it('战斗模块里选的子页面也记着：离开再回来还在那一页', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('战斗'));
    fireEvent.click(screen.getByText('效果（GE）'));
    expect(document.querySelector('.battle-nav.active')?.textContent).toContain('效果');

    fireEvent.click(within(rail()).getByText('剧情'));
    fireEvent.click(within(rail()).getByText('战斗'));

    expect(document.querySelector('.battle-nav.active')?.textContent).toContain('效果');
  });
});

describe('右上角的校验结果', () => {
  const badge = () => screen.getByRole('button', { name: /校验结果/ });

  it('显示所有模块的合计条数，点开是「模块 / 建议 / 错误」的列表', async () => {
    await renderApp();

    // 默认那行缺台词、又没指定角色 → 剧情 2 条建议
    expect(badge().textContent).toBe('校验结果 2');

    fireEvent.click(badge());
    expect([...document.querySelectorAll('.check-table th')].map((th) => th.textContent)).toEqual([
      '模块',
      '建议',
      '错误',
    ]);
    expect([...document.querySelectorAll('.check-row')].map((row) => row.textContent)).toEqual([
      '剧情20',
      '战斗00',
      '本地化00',
    ]);
  });

  it('点列表里的一行跳到对应模块', async () => {
    await renderApp();
    fireEvent.click(within(rail()).getByText('角色'));

    fireEvent.click(badge());
    const rows = [...document.querySelectorAll('.check-row')];
    fireEvent.click(rows[1]); // 战斗

    expect(document.querySelector('.battle-side')).toBeTruthy();
    expect(document.querySelector('.check-pop')).toBeNull();

    fireEvent.click(badge());
    fireEvent.click([...document.querySelectorAll('.check-row')][2]); // 本地化
    expect(screen.getByText('剧情本地化')).toBeTruthy();
  });
});
