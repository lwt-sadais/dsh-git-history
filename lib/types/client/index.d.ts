import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type GitHistoryLocaleKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'git-history': GitHistoryLocaleKey;
    }
}
export declare const inject: string[];
/** 注册输入框工具栏入口、双语词典和随插件生命周期释放的弹窗样式。 */
export declare function apply(ctx: ClientContext): void;
export { GitHistoryView } from './GitHistoryView.js';
