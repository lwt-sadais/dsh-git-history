import type { ApiResult, BranchListRequest, BranchListResult, CommitDetail, CommitDetailRequest, CommitFile, CommitFileRequest, HistoryPage, HistoryRequest, RepositorySnapshot, SwitchBranchRequest, SwitchBranchResult, SyncRequest, SyncResult } from '../core/types.js';
/** 读取仓库树；fetch 为 true 时先更新远程跟踪引用。 */
export declare function readRepositorySnapshot(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
/**
 * 合并同一（路径, fetch）的并发快照请求，避免开发态双跑或快速开关弹窗触发重复的全量扫描。
 * 只合并正在飞行中的请求，不缓存已完成结果，因此不会返回陈旧数据。
 */
export declare function readRepositorySnapshotOnce(path: string, fetchRemote: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
/** 分页读取指定仓库的提交历史。 */
export declare function readHistory(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>>;
/** 读取指定提交的轻量文件清单。 */
export declare function readCommit(request: CommitDetailRequest, signal?: AbortSignal): Promise<ApiResult<CommitDetail>>;
/** 按服务端签发的文件标识读取提交中的单文件差异。 */
export declare function readCommitFile(request: CommitFileRequest, signal?: AbortSignal): Promise<ApiResult<CommitFile>>;
/** 按远端跟踪状态先 pull 后 push 同步指定仓库。 */
export declare function syncRepository(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>>;
/** 列出仓库的本地与远程分支；detached HEAD 时 current 为 null。 */
export declare function readBranches(request: BranchListRequest, signal?: AbortSignal): Promise<ApiResult<BranchListResult>>;
/** 切换到本地分支，或基于远程引用创建同名跟踪分支后切换。 */
export declare function switchBranch(request: SwitchBranchRequest, signal?: AbortSignal): Promise<ApiResult<SwitchBranchResult>>;
