import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitEntry, RepositoryNode } from '../core/types.js'
import { readHistory, readRepositorySnapshot } from './api.js'

export type GitHistoryViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'git-history'>

const PAGE_SIZE = 20

/** 以深度优先顺序展开仓库树，供选中仓库失效时寻找回退项。 */
function flattenRepositories(repository: RepositoryNode): RepositoryNode[] {
  return [repository, ...repository.children.flatMap(flattenRepositories)]
}

/** 在最新仓库树中按服务端生成的稳定标识查找节点。 */
function findRepository(repository: RepositoryNode | null, id: string): RepositoryNode | null {
  if (repository === null) return null
  if (repository.id === id) return repository
  for (const child of repository.children) {
    const match = findRepository(child, id)
    if (match !== null) return match
  }
  return null
}

/** 将提交时间格式化为紧凑的本地相对时间或日期。 */
function formatDate(value: string): string {
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** 渲染递归仓库节点，并保持子模块的树状缩进。 */
function RepositoryTree({
  repository,
  selectedId,
  depth,
  onSelect,
  t,
}: {
  readonly repository: RepositoryNode
  readonly selectedId: string
  readonly depth: number
  readonly onSelect: (repository: RepositoryNode) => void
  readonly t: GitHistoryViewProps['t']
}) {
  const selected = repository.id === selectedId
  return (
    <div className="dghTreeNode">
      <button
        type="button"
        className={`dghRepository ${selected ? 'dghRepositoryActive' : ''}`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => repository.initialized && onSelect(repository)}
        disabled={!repository.initialized}
        title={repository.path || repository.name}
      >
        <span className="dghTreeGuide" aria-hidden="true">{depth === 0 ? '◆' : '└'}</span>
        <span className="dghRepositoryName">{repository.name}</span>
        {!repository.initialized && <span className="dghMuted">{t('uninitialized')}</span>}
        {repository.initialized && <span className="dghBranch" title={repository.tracking ?? t('noUpstream')}>
          <span aria-hidden="true">⑂</span> {repository.branch ?? t('noBranch')}
        </span>}
        {repository.ahead > 0 && <span className="dghAhead" title={t('ahead', { count: repository.ahead })}>{repository.ahead} ↑</span>}
        {repository.behind > 0 && <span className="dghBehind" title={t('behind', { count: repository.behind })}>{repository.behind} ↓</span>}
        {repository.fetchError !== null && <span className="dghFetchError" title={repository.fetchError}>!</span>}
      </button>
      {repository.children.map(child => (
        <RepositoryTree
          key={child.id}
          repository={child}
          selectedId={selectedId}
          depth={depth + 1}
          onSelect={onSelect}
          t={t}
        />
      ))}
    </div>
  )
}

/** 渲染一个提交条目及其作者、时间、引用和短哈希。 */
function CommitRow({ commit }: { readonly commit: CommitEntry }) {
  return (
    <article className="dghCommit" title={`${commit.hash}\n${commit.authorName} <${commit.authorEmail}>`}>
      <div className="dghCommitDot" aria-hidden="true" />
      <div className="dghCommitBody">
        <div className="dghCommitTitle">{commit.subject}</div>
        <div className="dghCommitMeta">
          <span>{commit.authorName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={commit.date}>{formatDate(commit.date)}</time>
          <code>{commit.shortHash}</code>
        </div>
        {commit.refs.length > 0 && <div className="dghRefs">
          {commit.refs.map(ref => <span key={ref}>{ref.replace(/^HEAD ->\s*/u, '').replace(/^tag:\s*/u, '')}</span>)}
        </div>}
      </div>
    </article>
  )
}

/** 提供当前会话工作区的仓库树和可切换分页提交历史。 */
export function GitHistoryView(props: GitHistoryViewProps) {
  const { sessionId, useSessions, t } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [repository, setRepository] = useState<RepositoryNode | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [commits, setCommits] = useState<readonly CommitEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const selectedRepository = useMemo(() => findRepository(repository, selectedId), [repository, selectedId])

  /** 读取本地快照，并可选在后台 fetch 后刷新远程同步计数。 */
  const loadSnapshot = useCallback(async (fetchRemote: boolean, signal?: AbortSignal) => {
    if (cwd === undefined || cwd === '') return
    fetchRemote ? setRefreshing(true) : setLoading(true)
    setError(null)
    const result = await readRepositorySnapshot(cwd, fetchRemote, signal)
    if (result.ok) {
      setRepository(result.value.repository)
      setSelectedId(current => {
        const match = findRepository(result.value.repository, current)
        return match?.initialized === true ? current : flattenRepositories(result.value.repository).find(item => item.initialized)?.id ?? ''
      })
    } else {
      setError(result.error.message)
    }
    fetchRemote ? setRefreshing(false) : setLoading(false)
  }, [cwd])

  useEffect(() => {
    setRepository(null)
    setSelectedId('')
    setCommits([])
    setHasMore(false)
    if (cwd === undefined || cwd === '') return
    const controller = new AbortController()
    void loadSnapshot(false, controller.signal).then(() => loadSnapshot(true, controller.signal)).catch(cause => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(String(cause))
    })
    return () => controller.abort()
  }, [cwd, loadSnapshot])

  useEffect(() => {
    if (cwd === undefined || cwd === '' || selectedRepository === null || !selectedRepository.initialized) return
    const controller = new AbortController()
    setHistoryLoading(true)
    setHistoryError(null)
    setCommits([])
    void readHistory({ path: cwd, repositoryId: selectedRepository.id, skip: 0, limit: PAGE_SIZE }, controller.signal).then(result => {
      if (result.ok) {
        setCommits(result.value.commits)
        setHasMore(result.value.hasMore)
      } else {
        setHistoryError(result.error.message)
      }
      setHistoryLoading(false)
    }).catch(cause => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setHistoryError(String(cause))
      setHistoryLoading(false)
    })
    return () => controller.abort()
  }, [cwd, selectedRepository?.id])

  /** 追加下一页历史，同时避免并发重复加载。 */
  const loadMore = useCallback(async () => {
    if (cwd === undefined || cwd === '' || selectedRepository === null || loadingMore || !hasMore) return
    setLoadingMore(true)
    const result = await readHistory({
      path: cwd,
      repositoryId: selectedRepository.id,
      skip: commits.length,
      limit: PAGE_SIZE,
    })
    if (result.ok) {
      setCommits(current => [...current, ...result.value.commits])
      setHasMore(result.value.hasMore)
    } else {
      setHistoryError(result.error.message)
    }
    setLoadingMore(false)
  }, [commits.length, cwd, hasMore, loadingMore, selectedRepository])

  if (cwd === undefined || cwd === '') return <div className="dghState">{t('noWorkspace')}</div>

  return (
    <section className="dghRoot">
      <header className="dghHeader">
        <div>
          <h2>{t('repositories')}</h2>
          {repository !== null && <span>{t('commits', { count: commits.length })}</span>}
        </div>
        <button type="button" className="dghRefresh" disabled={refreshing || loading} onClick={() => void loadSnapshot(true)}>
          <span className={refreshing ? 'dghSpin' : ''} aria-hidden="true">↻</span>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </header>

      {loading && repository === null ? <div className="dghState">{t('loading')}</div> : error !== null ? <div className="dghState dghError">{error}</div> : repository !== null && <>
        <div className="dghRepositories">
          <RepositoryTree repository={repository} selectedId={selectedId} depth={0} onSelect={item => setSelectedId(item.id)} t={t} />
        </div>
        <div className="dghHistoryHeader">
          <h3>{t('history')}</h3>
          <span>{selectedRepository?.name}</span>
          {selectedRepository?.fetchError !== null && selectedRepository?.fetchError !== undefined && <span className="dghHistoryWarning" title={selectedRepository.fetchError}>{t('fetchFailed')}</span>}
        </div>
        <div className="dghHistory">
          {historyLoading ? <div className="dghState">{t('loadingHistory')}</div> : historyError !== null ? <div className="dghState dghError">{historyError}</div> : commits.length === 0 ? <div className="dghState">{t('noHistory')}</div> : <>
            {commits.map(commit => <CommitRow key={commit.hash} commit={commit} />)}
            {hasMore && <button type="button" className="dghLoadMore" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t('loadingMore') : t('loadMore')}
            </button>}
          </>}
        </div>
      </>}
    </section>
  )
}
