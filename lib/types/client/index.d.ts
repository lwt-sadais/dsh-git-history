import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type GitHistoryLocaleKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'git-history': GitHistoryLocaleKey;
    }
}
export declare const inject: string[];
/** 注册 Git 视图、双语词典和随插件生命周期释放的样式。 */
export declare function apply(ctx: ClientContext): void;
export { GitHistoryView } from './GitHistoryView.js';
