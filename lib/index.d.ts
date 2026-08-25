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
interface ApiError {
  readonly code: 'workspace-unknown' | 'not-git-repository' | 'repository-unknown' | 'invalid-request' | 'internal';
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
  /** 创建服务并注入受控 Git 执行器和已注册工作区校验器。 */
  constructor(runner: GitRunner, gate: WorkspaceGate);
  /** 探测仓库当前分支、跟踪分支和同步计数。 */
  private readIdentity;
  /** 在明确请求时更新远程跟踪引用；失败仅记录在对应仓库节点上。 */
  private fetch;
  /** 递归扫描一个已初始化仓库，并建立仅供当前工作区使用的仓库路径清单。 */
  private scanRepository;
  /** 读取当前工作区仓库树，并按需自动 fetch 根仓库及递归子模块。 */
  snapshot(path: string, shouldFetch: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>>;
  /** 分页读取服务端最近一次扫描确认过的仓库提交历史。 */
  history(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>>;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-git-history";
declare const inject: string[];
/** 组装工作区访问门、Git 服务和本地 API，并交由 Cordis 管理生命周期。 */
declare function apply(ctx: Context): void;
//#endregion
export { type ApiError, type ApiResult, type CommitEntry, GitHistoryService, type HistoryPage, type HistoryRequest, type RepositoryNode, type RepositorySnapshot, type SnapshotRequest, apply, inject, name, parseAheadBehind, parseHistory, parseSubmodulePaths };
//# sourceMappingURL=index.d.ts.map