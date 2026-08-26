import { Context } from "@deepseek-ai/cordis";
//#region src/core/types.d.ts
interface RepositoryNode {
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
interface RepositorySnapshot {
  readonly generatedAt: string;
  readonly repository: RepositoryNode;
}
interface CommitEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly date: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly refs: readonly string[];
}
interface HistoryPage {
  readonly commits: readonly CommitEntry[];
  readonly hasMore: boolean;
}
type ChangeKind = 'equal' | 'delete' | 'insert' | 'modify' | 'empty';
interface DiffLine {
  readonly kind: ChangeKind;
  readonly text: string;
  readonly lineNumber: number | null;
  readonly partnerKind?: 'delete' | 'insert';
}
interface DiffRow {
  readonly index: number;
  readonly left: DiffLine;
  readonly right: DiffLine;
  readonly changed: boolean;
}
interface ChangeMarker {
  readonly row: number;
  readonly kind: 'delete' | 'insert';
}
interface CommitFileSummary {
  readonly id: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
}
interface CommitFile extends CommitFileSummary {
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly rows: readonly DiffRow[];
  readonly markers: readonly ChangeMarker[];
}
interface CommitDetail {
  readonly manifestId: string;
  readonly parentHash: string | null;
  readonly files: readonly CommitFileSummary[];
}
interface SnapshotRequest {
  readonly path: string;
  readonly fetch: boolean;
}
interface HistoryRequest {
  readonly path: string;
  readonly repositoryId: string;
  readonly skip: number;
  readonly limit: number;
}
interface CommitDetailRequest {
  readonly path: string;
  readonly repositoryId: string;
  readonly commitHash: string;
}
interface CommitFileRequest {
  readonly path: string;
  readonly manifestId: string;
  readonly fileId: string;
}
interface SyncRequest {
  readonly path: string;
  readonly repositoryId: string;
}
interface SyncResult {
  readonly branch: string | null;
  readonly pulled: number;
  readonly pushed: number;
}
interface ApiError {
  readonly code: 'workspace-unknown' | 'not-git-repository' | 'repository-unknown' | 'commit-unknown' | 'manifest-stale' | 'file-unknown' | 'too-large' | 'invalid-request' | 'internal';
  readonly message: string;
}
type ApiResult<T> = {
  readonly ok: true;
  readonly value: T;
} | {
  readonly ok: false;
  readonly error: ApiError;
};
//#endregion
//#region src/host/git-service.d.ts
interface GitRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
interface GitRunner {
  run(argv: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRunResult>;
}
interface WorkspaceGate {
  resolve(path: string): Promise<ApiResult<string>>;
}
/** 解析 .gitmodules 的路径配置，同时忽略畸形或空白记录。 */
declare function parseSubmodulePaths(stdout: string): string[];
/** 将修改前后文本对齐为双栏行，并生成可定位的变更标记。 */
declare function alignDiff(before: string, after: string): {
  rows: readonly DiffRow[];
  markers: readonly ChangeMarker[];
};
/** 解析 diff-tree 的 NUL 分隔状态记录，并为文件签发不可猜测标识。 */
declare function parseCommitFiles(stdout: string): CommitFileSummary[];
/** 将 rev-list 的左右计数转换为 ahead 和 behind。 */
declare function parseAheadBehind(stdout: string): {
  ahead: number;
  behind: number;
};
/** 解析使用不可见分隔符输出的 Git 日志，避免提交文本中的常见字符破坏字段。 */
declare function parseHistory(stdout: string): CommitEntry[];
declare class GitHistoryService {
  private readonly runner;
  private readonly gate;
  private readonly repositories;
  private readonly commitManifests;
  /** 创建服务并注入受控 Git 执行器和已注册工作区校验器。 */
  constructor(runner: GitRunner, gate: WorkspaceGate);
  /** 探测仓库当前分支、跟踪分支和同步计数。 */
  private readIdentity;
  /** 在明确请求时更新远程跟踪引用；失败仅记录在对应仓库节点上。 */
  private fetch;
  /** 先尝试快进拉取，失败时按 EnsoAI 行为改用 rebase，并在冲突后清理 rebase 状态。 */
  private pull;
  /** 推送被远端拒绝时先同步新增远端提交，再按 EnsoAI 行为重试一次。 */
  private push;
  /** 递归扫描一个已初始化仓库，并建立仅供当前工作区使用的仓库路径清单。 */
  private scanRepository;
  /** 读取当前工作区仓库树，并按需自动 fetch 根仓库及递归子模块。 */
  snapshot(path: string, shouldFetch: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
  /** 分页读取服务端最近一次扫描确认过的仓库提交历史。 */
  history(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>>;
  /** 验证提交属于已扫描仓库，并签发短期文件清单供后续按需读取。 */
  commit(request: CommitDetailRequest, signal?: AbortSignal): Promise<ApiResult<CommitDetail>>;
  /** 解析服务端签发的提交文件引用，拒绝过期清单和任意客户端路径。 */
  private commitManifestEntry;
  /** 按需读取提交文件两侧内容，并返回适合双栏显示的有界文本差异。 */
  commitFile(request: CommitFileRequest, signal?: AbortSignal): Promise<ApiResult<CommitFile>>;
  /** 按 EnsoAI 的同步顺序先拉取落后提交，再推送本地领先提交。 */
  sync(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>>;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-git-history";
declare const inject: string[];
/** 组装工作区访问门、Git 服务和本地 API，并交由 Cordis 管理生命周期。 */
declare function apply(ctx: Context): void;
//#endregion
export { type ApiError, type ApiResult, type ChangeKind, type ChangeMarker, type CommitDetail, type CommitDetailRequest, type CommitEntry, type CommitFile, type CommitFileRequest, type CommitFileSummary, type DiffLine, type DiffRow, GitHistoryService, type HistoryPage, type HistoryRequest, type RepositoryNode, type RepositorySnapshot, type SnapshotRequest, type SyncRequest, type SyncResult, alignDiff, apply, inject, name, parseAheadBehind, parseCommitFiles, parseHistory, parseSubmodulePaths };
//# sourceMappingURL=index.d.ts.map