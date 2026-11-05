import type { ApiResult, BranchListRequest, BranchListResult, CommitDetail, CommitDetailRequest, CommitFile, CommitFileRequest, HistoryPage, HistoryRequest, RepositorySnapshot, SwitchBranchRequest, SwitchBranchResult, SyncRequest, SyncResult } from '../core/types.js'

const FALLBACK: ApiResult<never> = {
  ok: false,
  error: { code: 'internal', message: 'Git history service is unavailable' },
}

/** 向插件宿主路由发送同源 JSON 请求，并将传输异常折叠为稳定错误。 */
async function post<T>(route: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
    const value = await response.json() as unknown
    if (value !== null && typeof value === 'object' && 'ok' in value) return value as ApiResult<T>
    return FALLBACK
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    return FALLBACK
  }
}

/** 读取仓库树；fetch 为 true 时先更新远程跟踪引用。 */
export function readRepositorySnapshot(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>> {
  return post('/api/dsh-git-history/snapshot', { path, fetch: fetchRemote }, signal)
}

const inflightSnapshots = new Map<string, Promise<ApiResult<RepositorySnapshot>>>()

/**
 * 合并同一（路径, fetch）的并发快照请求，避免开发态双跑或快速开关弹窗触发重复的全量扫描。
 * 只合并正在飞行中的请求，不缓存已完成结果，因此不会返回陈旧数据。
 */
export function readRepositorySnapshotOnce(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>> {
  const key = `${path}\u0000${fetchRemote}`
  const running = inflightSnapshots.get(key)
  if (running !== undefined) return running
  const task = readRepositorySnapshot(path, fetchRemote, signal).finally(() => { inflightSnapshots.delete(key) })
  inflightSnapshots.set(key, task)
  return task
}

/** 分页读取指定仓库的提交历史。 */
export function readHistory(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>> {
  return post('/api/dsh-git-history/log', request, signal)
}

/** 读取指定提交的轻量文件清单。 */
export function readCommit(request: CommitDetailRequest, signal?: AbortSignal): Promise<ApiResult<CommitDetail>> {
  return post('/api/dsh-git-history/commit', request, signal)
}

/** 按服务端签发的文件标识读取提交中的单文件差异。 */
export function readCommitFile(request: CommitFileRequest, signal?: AbortSignal): Promise<ApiResult<CommitFile>> {
  return post('/api/dsh-git-history/commit-file', request, signal)
}

/** 按远端跟踪状态先 pull 后 push 同步指定仓库。 */
export function syncRepository(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>> {
  return post('/api/dsh-git-history/sync', request, signal)
}

/** 列出仓库的本地与远程分支；detached HEAD 时 current 为 null。 */
export function readBranches(request: BranchListRequest, signal?: AbortSignal): Promise<ApiResult<BranchListResult>> {
  return post('/api/dsh-git-history/branches', request, signal)
}

/** 切换到本地分支，或基于远程引用创建同名跟踪分支后切换。 */
export function switchBranch(request: SwitchBranchRequest, signal?: AbortSignal): Promise<ApiResult<SwitchBranchResult>> {
  return post('/api/dsh-git-history/switch-branch', request, signal)
}
