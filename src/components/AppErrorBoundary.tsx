import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("MarkGrove failed to render", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <p className="eyebrow">MARKGROVE / LOCAL RECOVERY</p>
          <h1>笔记仍保存在浏览器中</h1>
          <p>界面遇到了问题，但 MarkGrove 没有主动清理本地数据库。请先刷新页面；如果问题持续，请保留站点数据并报告错误。</p>
          <button type="button" onClick={() => window.location.reload()}>刷新 MarkGrove</button>
          <details><summary>错误信息</summary><pre>{this.state.error.message}</pre></details>
        </main>
      );
    }
    return this.props.children;
  }
}
