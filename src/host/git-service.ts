import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ApiError,
  ApiResult,
  CommitEntry,
  HistoryPage,
  HistoryRequest,
  RepositoryNode,
  RepositorySnapshot,
  SyncRequest,
  SyncResult,
} from '../core/types.js'

const MAX_REPOSITORIES = 128
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_ERROR_BYTES = 256 * 1024
const COMMAND_TIMEOUT_MS = 15_000
const FIELD_SEPARATOR = '\u001f'
const RECORD_SEPARATOR = '\u001e'

export interface GitRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface GitRunner {
  run(argv: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRunResult>
}

export interface WorkspaceGate {
  resolve(path: string): Promise<ApiResult<string>>
}

interface ScanBudget {
  repositories: number
}

/** 构造稳定的 API 失败结果，避免各调用点重复拼装错误结构。 */
function fail(code: ApiError['code'], message: string): ApiResult<never> {
  return { ok: false, error: { code, message } }
}

/** 将 Git 输出的首行转换为可展示值，空输出统一视为未知。 */
function firstLine(value: string): string | null {
  const line = value.trim().split(/\r?\n/u)[0]
  return line === undefined || line === '' ? null : line
}

/** 解析 .gitmodules 的路径配置，同时忽略畸形或空白记录。 */
export function parseSubmodulePaths(stdout: string): string[] {
  return stdout.split(/\r?\n/u).flatMap(line => {
    const separator = line.search(/\s/u)
    if (separator < 0) return []
    const path = line.slice(separator).trim()
    return path === '' ? [] : [path]
  })
}

/** 只允许解析仓库根目录之内的相对路径，阻断绝对路径和目录穿越。 */
function safeChild(root: string, path: string): string | null {
  if (path === '' || isAbsolute(path) || path.includes('\0')) return null
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    ? absolute
    : null
}

/** 拼接工作区相对的仓库标识，根仓库固定使用空字符串。 */
function childId(parentId: string, childPath: string): string {
  return parentId === '' ? childPath : `${parentId}/${childPath}`
}

/** 将 rev-list 的左右计数转换为 ahead 和 behind。 */
export function parseAheadBehind(stdout: string): { ahead: number, behind: number } {
  const [aheadValue, behindValue] = stdout.trim().split(/\s+/u)
  return {
    ahead: Number.parseInt(aheadValue ?? '0', 10) || 0,
    behind: Number.parseInt(behindValue ?? '0', 10) || 0,
  }
}

/** 解析使用不可见分隔符输出的 Git 日志，避免提交文本中的常见字符破坏字段。 */
export function parseHistory(stdout: string): CommitEntry[] {
  return stdout.split(RECORD_SEPARATOR).flatMap(record => {
    const value = record.replace(/^\r?\n/u, '').trimEnd()
    if (value === '') return []
    const [hash, shortHash, date, subject, authorName, authorEmail, refs = ''] = value.split(FIELD_SEPARATOR)
    if (!hash || !shortHash || !date || subject === undefined || authorName === undefined || authorEmail === undefined) return []
    return [{
      hash,
      shortHash,
      date,
      subject,
      authorName,
      authorEmail,
      refs: refs.split(',').map(ref => ref.trim()).filter(Boolean),
    }]
  })
}

export class GitHistoryService {
  private readonly repositories = new Map<string, ReadonlyMap<string, string>>()

  /** 创建服务并注入受控 Git 执行器和已注册工作区校验器。 */
  constructor(private readonly runner: GitRunner, private readonly gate: WorkspaceGate) {}

  /** 探测仓库当前分支、跟踪分支和同步计数。 */
  private async readIdentity(root: string, signal?: AbortSignal): Promise<Omit<RepositoryNode, 'id' | 'name' | 'path' | 'initialized' | 'fetchError' | 'children'>> {
    const branchResult = await this.runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, signal)
    let branch = branchResult.exitCode === 0 ? firstLine(branchResult.stdout) : null
    if (branch === null) {
      const head = await this.runner.run(['rev-parse', '--short', 'HEAD'], root, signal)
      const shortHash = head.exitCode === 0 ? firstLine(head.stdout) : null
      branch = shortHash === null ? null : `detached@${shortHash}`
    }
    const upstreamResult = await this.runner.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root, signal)
    const tracking = upstreamResult.exitCode === 0 ? firstLine(upstreamResult.stdout) : null
    if (tracking === null) return { branch, tracking: null, ahead: 0, behind: 0 }
    const countResult = await this.runner.run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root, signal)
    const counts = countResult.exitCode === 0 ? parseAheadBehind(countResult.stdout) : { ahead: 0, behind: 0 }
    return { branch, tracking, ...counts }
  }

  /** 在明确请求时更新远程跟踪引用；失败仅记录在对应仓库节点上。 */
  private async fetch(root: string, signal?: AbortSignal): Promise<string | null> {
    const result = await this.runner.run(['fetch', '--prune'], root, signal)
    if (result.exitCode === 0) return null
    const message = firstLine(result.stderr) ?? 'git fetch failed'
    return message.slice(0, 500)
  }

  /** 先尝试快进拉取，失败时按 EnsoAI 行为改用 rebase，并在冲突后清理 rebase 状态。 */
  private async pull(root: string, signal?: AbortSignal): Promise<GitRunResult> {
    const fastForward = await this.runner.run(['pull', '--ff-only'], root, signal)
    if (fastForward.exitCode === 0) return fastForward
    const rebase = await this.runner.run(['pull', '--rebase'], root, signal)
    if (rebase.exitCode === 0) return rebase
    await this.runner.run(['rebase', '--abort'], root, signal)
    return rebase
  }

  /** 推送被远端拒绝时先同步新增远端提交，再按 EnsoAI 行为重试一次。 */
  private async push(root: string, signal?: AbortSignal): Promise<GitRunResult> {
    const initial = await this.runner.run(['push'], root, signal)
    if (initial.exitCode === 0 || !/non-fast-forward|rejected/iu.test(initial.stderr)) return initial
    const pull = await this.pull(root, signal)
    return pull.exitCode === 0 ? this.runner.run(['push'], root, signal) : pull
  }

  /** 递归扫描一个已初始化仓库，并建立仅供当前工作区使用的仓库路径清单。 */
  private async scanRepository(
    root: string,
    id: string,
    shouldFetch: boolean,
    budget: ScanBudget,
    identities: Map<string, string>,
    signal?: AbortSignal,
  ): Promise<RepositoryNode> {
    signal?.throwIfAborted()
    budget.repositories += 1
    if (budget.repositories > MAX_REPOSITORIES) throw new Error('repository limit exceeded')
    identities.set(id, root)
    const fetchError = shouldFetch ? await this.fetch(root, signal) : null
    const identity = await this.readIdentity(root, signal)
    const modules = await this.runner.run(['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], root, signal)
    const declaredPaths = modules.exitCode === 0 ? parseSubmodulePaths(modules.stdout) : []
    const children: RepositoryNode[] = []
    for (const path of declaredPaths) {
      const childRoot = safeChild(root, path)
      if (childRoot === null) continue
      const childRepositoryId = childId(id, path)
      let initialized = false
      try {
        const canonicalChild = await realpath(childRoot)
        const probe = await this.runner.run(['rev-parse', '--show-toplevel'], canonicalChild, signal)
        initialized = probe.exitCode === 0 && await realpath(probe.stdout.trim()) === canonicalChild
      } catch {
        // 未检出的目录或尚未初始化的 gitlink 仍作为禁用节点展示。
        initialized = false
      }
      if (initialized) {
        children.push(await this.scanRepository(childRoot, childRepositoryId, shouldFetch, budget, identities, signal))
      } else {
        children.push({
          id: childRepositoryId,
          name: basename(path),
          path: childRepositoryId,
          initialized: false,
          branch: null,
          tracking: null,
          ahead: 0,
          behind: 0,
          fetchError: null,
          children: [],
        })
      }
    }
    return {
      id,
      name: basename(root),
      path: id,
      initialized: true,
      ...identity,
      fetchError,
      children,
    }
  }

  /** 读取当前工作区仓库树，并按需自动 fetch 根仓库及递归子模块。 */
  async snapshot(path: string, shouldFetch: boolean, signal?: AbortSignal): Promise<ApiResult<RepositorySnapshot>> {
    const workspace = await this.gate.resolve(path)
    if (!workspace.ok) return workspace
    const probe = await this.runner.run(['rev-parse', '--show-toplevel'], workspace.value, signal)
    if (probe.exitCode !== 0) return fail('not-git-repository', 'workspace is not a Git repository')
    let root: string
    try {
      root = await realpath(probe.stdout.trim())
      if (root !== workspace.value) return fail('workspace-unknown', 'workspace must be the Git repository root')
    } catch {
      return fail('not-git-repository', 'Git repository root is unavailable')
    }
    try {
      const identities = new Map<string, string>()
      const repository = await this.scanRepository(root, '', shouldFetch, { repositories: 0 }, identities, signal)
      this.repositories.set(root, identities)
      return { ok: true, value: { generatedAt: new Date().toISOString(), repository } }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') throw cause
      return fail('internal', 'unable to read Git repositories')
    }
  }

  /** 分页读取服务端最近一次扫描确认过的仓库提交历史。 */
  async history(request: HistoryRequest, signal?: AbortSignal): Promise<ApiResult<HistoryPage>> {
    const workspace = await this.gate.resolve(request.path)
    if (!workspace.ok) return workspace
    const root = this.repositories.get(workspace.value)?.get(request.repositoryId)
    if (root === undefined) return fail('repository-unknown', 'repository is stale; refresh the Git view')
    const format = `%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%D${RECORD_SEPARATOR}`
    const result = await this.runner.run([
      '--no-pager', 'log', `--skip=${request.skip}`, `--max-count=${request.limit + 1}`, `--pretty=format:${format}`,
    ], root, signal)
    if (result.exitCode !== 0) return fail('internal', 'unable to read Git history')
    const commits = parseHistory(result.stdout)
    return {
      ok: true,
      value: {
        commits: commits.slice(0, request.limit),
        hasMore: commits.length > request.limit,
      },
    }
  }

  /** 按 EnsoAI 的同步顺序先拉取落后提交，再推送本地领先提交。 */
  async sync(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>> {
    const workspace = await this.gate.resolve(request.path)
    if (!workspace.ok) return workspace
    const root = this.repositories.get(workspace.value)?.get(request.repositoryId)
    if (root === undefined) return fail('repository-unknown', 'repository is stale; refresh the Git view')
    const identity = await this.readIdentity(root, signal)
    if (identity.tracking === null) return fail('internal', 'repository has no upstream branch')
    if (identity.behind > 0) {
      const pull = await this.pull(root, signal)
      if (pull.exitCode !== 0) return fail('internal', (firstLine(pull.stderr) ?? 'git pull failed').slice(0, 500))
    }
    if (identity.ahead > 0) {
      const push = await this.push(root, signal)
      if (push.exitCode !== 0) return fail('internal', (firstLine(push.stderr) ?? 'git push failed').slice(0, 500))
    }
    return { ok: true, value: { branch: identity.branch, pulled: identity.behind, pushed: identity.ahead } }
  }
}

/** 建立只承认 DSH Workspace Registry 中规范路径的访问门。 */
export function createWorkspaceGate(workspaces: () => readonly { readonly path: string }[]): WorkspaceGate {
  return {
    async resolve(path) {
      let canonical: string
      try {
        canonical = await realpath(path)
      } catch {
        return fail('workspace-unknown', 'workspace path does not resolve')
      }
      return workspaces().some(workspace => workspace.path === canonical)
        ? { ok: true, value: canonical }
        : fail('workspace-unknown', 'path is not a registered workspace')
    },
  }
}

/** 将 DSH subprocess 能力适配为带超时、无交互凭据提示的 Git 执行器。 */
export function subprocessRunner(ctx: { subprocess: { spawn(spec: {
  argv: readonly string[]
  cwd: string
  stdio: { stdin: 'ignore', stdout: { maxBytes: number }, stderr: { maxBytes: number } }
  graceMs: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}): { done: Promise<{ exitCode: number | null }>, collected: { stdout?: { readFrom(offset: number): { text: string } }, stderr?: { readFrom(offset: number): { text: string } } } } } }): GitRunner {
  return {
    async run(argv, cwd, signal) {
      const timeoutSignal = AbortSignal.timeout(COMMAND_TIMEOUT_MS)
      const combinedSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal])
      const handle = ctx.subprocess.spawn({
        argv: ['git', ...argv],
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_ERROR_BYTES } },
        graceMs: 2_000,
        env: { GIT_TERMINAL_PROMPT: '0' },
        signal: combinedSignal,
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      }
    },
  }
}
