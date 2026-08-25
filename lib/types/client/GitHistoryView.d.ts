import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export type GitHistoryViewProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'git-history'>;
/** 提供常驻工具栏入口，并在按需弹窗中展示仓库树和分页提交历史。 */
export declare function GitHistoryView(props: GitHistoryViewProps): import("react").JSX.Element;
