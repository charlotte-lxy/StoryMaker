import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * 兜底错误边界。
 *
 * 没有它的话，任何一处渲染异常都会让整页变成空白，既看不到原因也没法自救。
 * 这里至少把错误信息和组件栈暴露出来，并给出恢复入口。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' });
    // 同时打到控制台，方便直接复制
    console.error('[StoryMaker] 渲染失败', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null, stack: '' });
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="crash">
        <h1>界面出错了</h1>
        <p className="crash-hint">
          这不是数据没了：项目内容只存在你的 .json 项目文件里，界面出错不会动它。
          请把下面的错误信息发给我，我来修。
        </p>
        <dl className="crash-meta">
          <dt>错误</dt>
          <dd>{error.message}</dd>
        </dl>
        <pre className="crash-stack">
          {error.stack ?? '(无堆栈)'}
          {stack}
        </pre>
        <div className="crash-actions">
          <button type="button" onClick={this.handleReset}>
            返回界面
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
