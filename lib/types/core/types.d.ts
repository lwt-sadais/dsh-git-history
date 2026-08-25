export interface RepositoryNode {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly initialized: boolean;
    readonly branch: string | null;
    readonly tracking: string | null;
    readonly ahead: number;
    readonly behind: number;
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
export interface SnapshotRequest {
    readonly path: string;
    readonly fetch: boolean;
}
export interface HistoryRequest {
    readonly path: string;
    readonly repositoryId: string;
    readonly skip: number;
    readonly limit: number;
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
    readonly code: 'workspace-unknown' | 'not-git-repository' | 'repository-unknown' | 'invalid-request' | 'internal';
    readonly message: string;
}
export type ApiResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: ApiError;
};
