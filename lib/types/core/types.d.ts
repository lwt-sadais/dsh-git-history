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
    readonly code: 'workspace-unknown' | 'not-git-repository' | 'repository-unknown' | 'commit-unknown' | 'manifest-stale' | 'file-unknown' | 'too-large' | 'invalid-request' | 'internal';
    readonly message: string;
}
export type ApiResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: ApiError;
};
