import type { ApiResult, CommitDetail, CommitDetailRequest, CommitFile, CommitFileRequest, HistoryPage, HistoryRequest, RepositorySnapshot, SyncRequest, SyncResult } from '../core/types.js'

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
