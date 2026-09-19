export interface RepositoryNode {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly initialized: boolean;
    readonly branch: string | null;
    readonly tracking: string | null;
    readonly ahead: number;
    readonly behind: number;
    /** 本地未提交变更文件数，含未跟踪文件；同一文件暂存与未暂存改动只计 1 次。 */
    readonly changes: number;
    readonly fetchError: string | null;
    readonly children: readonly RepositoryNode[];
}
export interface RepositorySnapshot {
    readonly generatedAt: string;
    readonly repository: RepositoryNode;
}
export interface CommitEntry {
    readonly hash: string;
    readonly shortHash: string;
    readonly date: string;
    readonly subject: string;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly refs: readonly string[];
}
export interface HistoryPage {
    readonly commits: readonly CommitEntry[];
    readonly hasMore: boolean;
}
export type ChangeKind = 'equal' | 'delete' | 'insert' | 'modify' | 'empty';
export interface DiffLine {
    readonly kind: ChangeKind;
    readonly text: string;
    readonly lineNumber: number | null;
    readonly partnerKind?: 'delete' | 'insert';
}
export interface DiffRow {
    readonly index: number;
    readonly left: DiffLine;
    readonly right: DiffLine;
    readonly changed: boolean;
}
export interface ChangeMarker {
    readonly row: number;
    readonly kind: 'delete' | 'insert';
}
export interface CommitFileSummary {
    readonly id: string;
    readonly path: string;
    readonly oldPath: string | null;
    readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
}
export interface CommitFile extends CommitFileSummary {
    readonly binary: boolean;
    readonly truncated: boolean;
    readonly rows: readonly DiffRow[];
    readonly markers: readonly ChangeMarker[];
}
export interface CommitDetail {
    readonly manifestId: string;
    readonly parentHash: string | null;
    readonly files: readonly CommitFileSummary[];
}
export interface SnapshotRequest {
    readonly path: string;
    readonly fetch: boolean;
}
export interface BranchListRequest {
    readonly path: string;
    readonly repositoryId: string;
}
export interface BranchListResult {
    /** 当前分支名；detached HEAD 时为 null。 */
    readonly current: string | null;
    readonly local: readonly string[];
    /** 远程跟踪短引用（如 origin/feature），已剔除 HEAD 符号引用与本地已有同名分支。 */
    readonly remote: readonly string[];
}
export interface SwitchBranchRequest {
    readonly path: string;
    readonly repositoryId: string;
    /** 目标引用名：本地分支名或远程跟踪短引用。 */
    readonly branch: string;
}
export interface SwitchBranchResult {
    /** 切换完成后的本地分支名。 */
    readonly branch: string;
}
export interface HistoryRequest {
    readonly path: string;
    readonly repositoryId: string;
    readonly skip: number;
    readonly limit: number;
}
export interface CommitDetailRequest {
    readonly path: string;
    readonly repositoryId: string;
    readonly commitHash: string;
}
export interface CommitFileRequest {
    readonly path: string;
    readonly manifestId: string;
    readonly fileId: string;
}
export interface SyncRequest {
    readonly path: string;
    readonly repositoryId: string;
}
export interface SyncResult {
    readonly branch: string | null;
    readonly pulled: number;
    readonly pushed: number;
}
export interface ApiError {
    readonly code: 'workspace-unknown' | 'not-git-repository' | 'repository-unknown' | 'branch-unknown' | 'commit-unknown' | 'manifest-stale' | 'file-unknown' | 'too-large' | 'invalid-request' | 'internal';
    readonly message: string;
}
export type ApiResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: ApiError;
};
