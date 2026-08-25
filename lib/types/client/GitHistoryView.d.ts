import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export type GitHistoryViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'git-history'>;
/** 提供当前会话工作区的仓库树和可切换分页提交历史。 */
export declare function GitHistoryView(props: GitHistoryViewProps): import("react").JSX.Element;
