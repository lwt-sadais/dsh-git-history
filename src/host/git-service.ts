import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { diffLines } from 'diff'
import type {
  ApiError,
  ApiResult,
  BranchListRequest,
  BranchListResult,
  ChangeMarker,
  CommitDetail,
  CommitDetailRequest,
  CommitEntry,
  CommitFile,
  CommitFileRequest,
  CommitFileSummary,
  DiffLine,
  DiffRow,
  HistoryPage,
  HistoryRequest,
  RepositoryNode,
  RepositorySnapshot,
  SwitchBranchRequest,
  SwitchBranchResult,
  SyncRequest,
  SyncResult,
} from '../core/types.js'

const MAX_REPOSITORIES = 128
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_ERROR_BYTES = 256 * 1024
const COMMAND_TIMEOUT_MS = 15_000
const FIELD_SEPARATOR = '\u001f'
const RECORD_SEPARATOR = '\u001e'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_DIFF_BYTES = 16 * 1024 * 1024
const MAX_MANIFESTS = 8
const MANIFEST_TTL_MS = 5 * 60_000
const EMPTY_LINE: DiffLine = { kind: 'empty', text: '', lineNumber: null }

interface CommitManifestEntry {
  readonly summary: CommitFileSummary
  readonly repositoryRoot: string
  readonly commitHash: string
  readonly parentHash: string | null
}

interface StoredCommitManifest {
  readonly workspace: string
  readonly expiresAt: number
  readonly files: ReadonlyMap<string, CommitManifestEntry>
}

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

/** 将文本拆为稳定的逻辑行，同时忽略末尾换行产生的空记录。 */
function splitLines(content: string): string[] {
  if (content === '') return []
  const lines = content.replace(/\r\n/gu, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** 构造带行号的差异行。 */
function diffLine(kind: DiffLine['kind'], text: string, lineNumber: number, partnerKind?: 'delete' | 'insert'): DiffLine {
  return { kind, text, lineNumber, ...(partnerKind === undefined ? {} : { partnerKind }) }
}

/** 将修改前后文本对齐为双栏行，并生成可定位的变更标记。 */
export function alignDiff(before: string, after: string): { rows: readonly DiffRow[], markers: readonly ChangeMarker[] } {
  const chunks = diffLines(before, after, { newlineIsToken: false, stripTrailingCr: true })
  const rows: DiffRow[] = []
  const markers: ChangeMarker[] = []
  let beforeLine = 1
  let afterLine = 1
  let index = 0
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]!
    if (chunk.removed && chunks[chunkIndex + 1]?.added) {
      const inserted = chunks[chunkIndex + 1]!
      const leftLines = splitLines(chunk.value)
      const rightLines = splitLines(inserted.value)
      for (let offset = 0; offset < Math.max(leftLines.length, rightLines.length); offset += 1) {
        const leftText = leftLines[offset]
        const rightText = rightLines[offset]
        const left = leftText === undefined ? EMPTY_LINE : diffLine('modify', leftText, beforeLine++, 'delete')
        const right = rightText === undefined ? EMPTY_LINE : diffLine('modify', rightText, afterLine++, 'insert')
        rows.push({ index, left, right, changed: true })
        if (leftText !== undefined) markers.push({ row: index, kind: 'delete' })
        if (rightText !== undefined) markers.push({ row: index, kind: 'insert' })
        index += 1
      }
      chunkIndex += 1
      continue
    }
    for (const value of splitLines(chunk.value)) {
      if (chunk.removed) {
        rows.push({ index, left: diffLine('delete', value, beforeLine++), right: EMPTY_LINE, changed: true })
        markers.push({ row: index, kind: 'delete' })
      } else if (chunk.added) {
        rows.push({ index, left: EMPTY_LINE, right: diffLine('insert', value, afterLine++), changed: true })
        markers.push({ row: index, kind: 'insert' })
      } else {
        rows.push({ index, left: diffLine('equal', value, beforeLine++), right: diffLine('equal', value, afterLine++), changed: false })
      }
      index += 1
    }
  }
  return { rows, markers }
}

/** 解析 diff-tree 的 NUL 分隔状态记录，并为文件签发不可猜测标识。 */
export function parseCommitFiles(stdout: string): CommitFileSummary[] {
  const fields = stdout.split('\0')
  const files: CommitFileSummary[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!status) continue
    const code = status[0]
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++]
      const path = fields[index++]
      if (oldPath && path) files.push({ id: randomUUID(), path, oldPath, status: 'renamed' })
      continue
    }
    const path = fields[index++]
    if (!path) continue
    files.push({
      id: randomUUID(),
      path,
      oldPath: null,
      status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
    })
  }
  return files
}

/** 将 rev-list 的左右计数转换为 ahead 和 behind。 */
export function parseAheadBehind(stdout: string): { ahead: number, behind: number } {
  const [aheadValue, behindValue] = stdout.trim().split(/\s+/u)
  return {
    ahead: Number.parseInt(aheadValue ?? '0', 10) || 0,
    behind: Number.parseInt(behindValue ?? '0', 10) || 0,
  }
}

/** 统计 status --porcelain=v2 行式输出中的变更条目数；`#` 表头与 `!` 忽略项不计，重命名条目单行只计 1 次。 */
export function parseChangeCount(stdout: string): number {
  return stdout.split(/\r?\n/u).filter(line => /^[12u?] /u.test(line)).length
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

/** 解析 for-each-ref 的短引用行输出，忽略空行。 */
export function parseBranchRefs(stdout: string): string[] {
  return stdout.split(/\r?\n/u).map(line => line.trim()).filter(line => line !== '')
}

/** 本地分支引用及其上游状态；gone 表示跟踪的远程分支已在远端删除。 */
export interface LocalBranchRef {
  readonly name: string
  readonly gone: boolean
}

/** 解析带上游跟踪状态的本地分支行输出（refname 与 track 以制表符分隔），识别上游已删除（[gone]）的分支。 */
export function parseLocalBranchRefs(stdout: string): LocalBranchRef[] {
  return stdout.split(/\r?\n/u).flatMap(line => {
    const separator = line.indexOf('\t')
    const name = (separator < 0 ? line : line.slice(0, separator)).trim()
    if (name === '') return []
    const track = separator < 0 ? '' : line.slice(separator + 1).trim()
    return [{ name, gone: track.startsWith('[gone]') }]
  })
}

/** 将远程跟踪短引用按已知远程名切分为目标本地分支短名，取最长匹配的远程名。 */
export function splitRemoteRef(remoteNames: readonly string[], ref: string): string | null {
  let matchedLength = 0
  let short: string | null = null
  for (const name of remoteNames) {
    if (name.length <= matchedLength || !ref.startsWith(`${name}/`)) continue
    const tail = ref.slice(name.length + 1)
    if (tail === '') continue
    matchedLength = name.length
    short = tail
  }
  return short
}

/** 过滤远程分支列表：剔除 HEAD 符号引用与本地已有同名分支，保证每个远程项的切换语义唯一。 */
export function filterRemoteBranches(remoteNames: readonly string[], remoteRefs: readonly string[], local: readonly string[]): string[] {
  const localSet = new Set(local)
  const remote: string[] = []
  for (const ref of remoteRefs) {
    if (ref.endsWith('/HEAD')) continue
    const short = splitRemoteRef(remoteNames, ref)
    if (short === null || localSet.has(short)) continue
    remote.push(ref)
  }
  return remote
}

export class GitHistoryService {
  private readonly repositories = new Map<string, ReadonlyMap<string, string>>()
  private readonly commitManifests = new Map<string, StoredCommitManifest>()

  /** 创建服务并注入受控 Git 执行器和已注册工作区校验器。 */
  constructor(private readonly runner: GitRunner, private readonly gate: WorkspaceGate) {}

  /** 校验工作区路径并解析服务端最近一次扫描签发的仓库根目录。 */
  private async resolveRepository(path: string, repositoryId: string): Promise<ApiResult<string>> {
    const workspace = await this.gate.resolve(path)
    if (!workspace.ok) return workspace
    const root = this.repositories.get(workspace.value)?.get(repositoryId)
    return root === undefined
      ? fail('repository-unknown', 'repository is stale; refresh the Git view')
      : { ok: true, value: root }
  }

  /** 枚举本地分支（含上游删除状态）、远程跟踪引用、远程名和当前分支，供分支列表与切换校验复用。 */
  private async readRefs(root: string, signal?: AbortSignal): Promise<ApiResult<{
    current: string | null
    localBranches: LocalBranchRef[]
    remoteRefs: string[]
    remoteNames: string[]
  }>> {
    const localResult = await this.runner.run(['for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:track)'], root, signal)
    if (localResult.exitCode !== 0) return fail('internal', 'unable to read Git branches')
    const remoteResult = await this.runner.run(['for-each-ref', 'refs/remotes', '--format=%(refname:short)'], root, signal)
    const remoteNamesResult = await this.runner.run(['remote'], root, signal)
    const headResult = await this.runner.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, signal)
    return {
      ok: true,
      value: {
        current: headResult.exitCode === 0 ? firstLine(headResult.stdout) : null,
        localBranches: parseLocalBranchRefs(localResult.stdout),
        remoteRefs: remoteResult.exitCode === 0 ? parseBranchRefs(remoteResult.stdout) : [],
        remoteNames: remoteNamesResult.exitCode === 0 ? parseBranchRefs(remoteNamesResult.stdout) : [],
      },
    }
  }

  /** 探测仓库当前分支、跟踪分支、同步计数和本地未提交变更数。 */
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
    const statusResult = await this.runner.run(['status', '--porcelain=v2', '--untracked-files=all'], root, signal)
    const changes = statusResult.exitCode === 0 ? parseChangeCount(statusResult.stdout) : 0
    if (tracking === null) return { branch, tracking: null, ahead: 0, behind: 0, changes }
    const countResult = await this.runner.run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], root, signal)
    const counts = countResult.exitCode === 0 ? parseAheadBehind(countResult.stdout) : { ahead: 0, behind: 0 }
    return { branch, tracking, ...counts, changes }
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
          changes: 0,
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
    const resolved = await this.resolveRepository(request.path, request.repositoryId)
    if (!resolved.ok) return resolved
    const root = resolved.value
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

  /** 验证提交属于已扫描仓库，并签发短期文件清单供后续按需读取。 */
  async commit(request: CommitDetailRequest, signal?: AbortSignal): Promise<ApiResult<CommitDetail>> {
    const resolved = await this.resolveRepository(request.path, request.repositoryId)
    if (!resolved.ok) return resolved
    const root = resolved.value
    const verified = await this.runner.run(['cat-file', '-e', `${request.commitHash}^{commit}`], root, signal)
    if (verified.exitCode !== 0) return fail('commit-unknown', 'commit is unavailable in this repository')
    const parent = await this.runner.run(['rev-parse', '--verify', `${request.commitHash}^1`], root, signal)
    const parentHash = parent.exitCode === 0 ? firstLine(parent.stdout) : null
    const tree = await this.runner.run(parentHash === null
      ? ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', request.commitHash]
      : ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '-M', parentHash, request.commitHash], root, signal)
    if (tree.exitCode !== 0) return fail('internal', 'unable to read commit changes')
    const files = parseCommitFiles(tree.stdout)
    const entries = new Map(files.map(summary => [summary.id, { summary, repositoryRoot: root, commitHash: request.commitHash, parentHash }]))
    const manifestId = randomUUID()
    const now = Date.now()
    for (const [id, manifest] of this.commitManifests) if (manifest.expiresAt <= now) this.commitManifests.delete(id)
    while (this.commitManifests.size >= MAX_MANIFESTS) this.commitManifests.delete(this.commitManifests.keys().next().value!)
    this.commitManifests.set(manifestId, { workspace: resolved.value, expiresAt: now + MANIFEST_TTL_MS, files: entries })
    return { ok: true, value: { manifestId, parentHash, files } }
  }

  /** 解析服务端签发的提交文件引用，拒绝过期清单和任意客户端路径。 */
  private async commitManifestEntry(request: CommitFileRequest): Promise<ApiResult<CommitManifestEntry>> {
    const workspace = await this.gate.resolve(request.path)
    if (!workspace.ok) return workspace
    const manifest = this.commitManifests.get(request.manifestId)
    if (manifest === undefined || manifest.expiresAt <= Date.now() || manifest.workspace !== workspace.value) {
      this.commitManifests.delete(request.manifestId)
      return fail('manifest-stale', 'commit detail has expired; reopen the commit')
    }
    const entry = manifest.files.get(request.fileId)
    return entry === undefined ? fail('file-unknown', 'file is not present in this commit') : { ok: true, value: entry }
  }

  /** 按需读取提交文件两侧内容，并返回适合双栏显示的有界文本差异。 */
  async commitFile(request: CommitFileRequest, signal?: AbortSignal): Promise<ApiResult<CommitFile>> {
    const resolved = await this.commitManifestEntry(request)
    if (!resolved.ok) return resolved
    const { summary, repositoryRoot, commitHash, parentHash } = resolved.value
    let before = ''
    let after = ''
    if (summary.status !== 'added' && parentHash !== null) {
      const previous = await this.runner.run(['show', `${parentHash}:${summary.oldPath ?? summary.path}`], repositoryRoot, signal)
      if (previous.exitCode !== 0) return fail('manifest-stale', 'commit baseline is unavailable; reopen the commit')
      before = previous.stdout
    }
    if (summary.status !== 'deleted') {
      const current = await this.runner.run(['show', `${commitHash}:${summary.path}`], repositoryRoot, signal)
      if (current.exitCode !== 0) return fail('manifest-stale', 'commit file is unavailable; reopen the commit')
      after = current.stdout
    }
    if (Buffer.byteLength(before) + Buffer.byteLength(after) > MAX_DIFF_BYTES) return fail('too-large', 'commit file diff exceeds the review limit')
    const binary = before.includes('\0') || after.includes('\0')
    const truncated = Buffer.byteLength(before) > MAX_FILE_BYTES || Buffer.byteLength(after) > MAX_FILE_BYTES
    if (truncated) {
      before = Buffer.from(before).subarray(0, MAX_FILE_BYTES).toString('utf8')
      after = Buffer.from(after).subarray(0, MAX_FILE_BYTES).toString('utf8')
    }
    const aligned = binary ? { rows: [], markers: [] } : alignDiff(before, after)
    return { ok: true, value: { ...summary, binary, truncated, rows: aligned.rows, markers: aligned.markers } }
  }

  /** 按 EnsoAI 的同步顺序先拉取落后提交，再推送本地领先提交。 */
  async sync(request: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResult>> {
    const resolved = await this.resolveRepository(request.path, request.repositoryId)
    if (!resolved.ok) return resolved
    const root = resolved.value
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

  /** 枚举仓库的本地与远程分支；列举前先尽力 fetch --prune 清掉远端已删分支的过期跟踪引用，并隐藏上游已删除的本地分支；detached HEAD 时 current 为 null。 */
  async branches(request: BranchListRequest, signal?: AbortSignal): Promise<ApiResult<BranchListResult>> {
    const resolved = await this.resolveRepository(request.path, request.repositoryId)
    if (!resolved.ok) return resolved
    // 过期远程跟踪引用会以"远端已删+本地已删"的分支形态残留在下拉列表里；fetch 失败（离线或无凭据）时忽略并退回本地引用。
    await this.fetch(resolved.value, signal)
    const refs = await this.readRefs(resolved.value, signal)
    if (!refs.ok) return refs
    const locals = refs.value.localBranches.map(branch => branch.name)
    return {
      ok: true,
      value: {
        current: refs.value.current,
        // 上游已删除（[gone]）的本地分支与本地不存在同样不进下拉列表，避免误导切换；手动 switch 的服务端校验仍接受它们。
        local: refs.value.localBranches.filter(branch => !branch.gone).map(branch => branch.name),
        // 远程组过滤使用包含 gone 的全量本地名，保证 prune 失败时残留的同名远程项也不会重现。
        remote: filterRemoteBranches(refs.value.remoteNames, refs.value.remoteRefs, locals),
      },
    }
  }

  /** 切换到本地分支，或基于远程引用创建同名跟踪分支后切换；引用名必须命中服务端重新枚举的结果。 */
  async switchBranch(request: SwitchBranchRequest, signal?: AbortSignal): Promise<ApiResult<SwitchBranchResult>> {
    const resolved = await this.resolveRepository(request.path, request.repositoryId)
    if (!resolved.ok) return resolved
    const root = resolved.value
    const refs = await this.readRefs(root, signal)
    if (!refs.ok) return refs
    const { localBranches, remoteRefs, remoteNames } = refs.value
    const local = localBranches.map(branch => branch.name)
    if (local.includes(request.branch)) {
      const switched = await this.runner.run(['switch', request.branch], root, signal)
      return switched.exitCode === 0
        ? { ok: true, value: { branch: request.branch } }
        : fail('internal', (firstLine(switched.stderr) ?? 'git switch failed').slice(0, 500))
    }
    const short = remoteRefs.includes(request.branch) ? splitRemoteRef(remoteNames, request.branch) : null
    // 短名命中本地分支说明客户端列表已过期，交由用户刷新后重试，避免歧义覆盖。
    if (short === null || local.includes(short)) return fail('branch-unknown', 'branch is not available in this repository')
    const created = await this.runner.run(['switch', '-c', short, '--track', request.branch], root, signal)
    return created.exitCode === 0
      ? { ok: true, value: { branch: short } }
      : fail('internal', (firstLine(created.stderr) ?? 'git switch failed').slice(0, 500))
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
