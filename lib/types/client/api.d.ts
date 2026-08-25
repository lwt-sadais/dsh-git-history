import type { ApiResult, HistoryPage, HistoryRequest, RepositorySnapshot, SyncRequest, SyncResult } from '../core/types.js';
/** 读取仓库树；fetch 为 true 时先更新远程跟踪引用。 */
export declare function readRepositorySnapshot(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
/** 分页读取指定仓库的提交历史。 */
export declare function readHistory(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>>;
/** 按远端跟踪状态先 pull 后 push 同步指定仓库。 */
export declare function syncRepository(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>>;
