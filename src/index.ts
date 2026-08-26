import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { createWorkspaceGate, GitHistoryService, subprocessRunner } from './host/git-service.js'
import { registerRoutes } from './host/routes.js'

export const name = 'dsh-git-history'
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/** 组装工作区访问门、Git 服务和本地 API，并交由 Cordis 管理生命周期。 */
export function apply(ctx: Context): void {
  const service = new GitHistoryService(
    subprocessRunner(ctx),
    createWorkspaceGate(() => ctx.workspaceRegistry.list()),
  )
  ctx.effect(() => registerRoutes(ctx, service), 'dsh-git-history: routes')
}

export type * from './core/types.js'
export { alignDiff, GitHistoryService, parseAheadBehind, parseCommitFiles, parseHistory, parseSubmodulePaths } from './host/git-service.js'
