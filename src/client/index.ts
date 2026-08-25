import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { GitHistoryView } from './GitHistoryView.js'
import { en, zh, type GitHistoryLocaleKey } from './locales.js'
import styles from './styles.css?inline'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'git-history': GitHistoryLocaleKey
  }
}

export const inject = ['slots', 'locale']
const NS = 'git-history'

/** 注册 Git 视图、双语词典和随插件生命周期释放的样式。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshGitHistory = ''
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-git-history: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-history: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'git-history',
    order: 20,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
  }, GitHistoryView))
}

export { GitHistoryView } from './GitHistoryView.js'
