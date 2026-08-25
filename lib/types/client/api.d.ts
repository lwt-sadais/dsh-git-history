import type { ApiResult, HistoryPage, HistoryRequest, RepositorySnapshot } from '../core/types.js';
/** 读取仓库树；fetch 为 true 时先更新远程跟踪引用。 */
export declare function readRepositorySnapshot(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
/** 分页读取指定仓库的提交历史。 */
export declare function readHistory(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>>;
