import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitDetail, CommitEntry, CommitFile, CommitFileSummary, DiffLine, RepositoryNode } from '../core/types.js'
import { readCommit, readCommitFile, readHistory, readRepositorySnapshot, syncRepository } from './api.js'

export type GitHistoryViewProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'git-history'>

const PAGE_SIZE = 20
const DIFF_ROW_HEIGHT = 20
const DIFF_OVERSCAN = 20

const STATUS_KEYS = {
  modified: 'statusModified', added: 'statusAdded', deleted: 'statusDeleted', renamed: 'statusRenamed',
} as const

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
  onSync,
  syncingId,
  t,
}: {
  readonly repository: RepositoryNode
  readonly selectedId: string
  readonly depth: number
  readonly onSelect: (repository: RepositoryNode) => void
  readonly onSync: (repository: RepositoryNode) => void
  readonly syncingId: string | null
  readonly t: GitHistoryViewProps['t']
}) {
  const selected = repository.id === selectedId
  return (
    <div className="dghTreeNode">
      <div className={`dghRepository ${selected ? 'dghRepositoryActive' : ''}`}>
        <button
          type="button"
          className="dghRepositorySelect"
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
        </button>
        {(repository.ahead > 0 || repository.behind > 0) && <button
          type="button"
          className="dghSync"
          disabled={syncingId !== null}
          onClick={() => onSync(repository)}
          title={syncingId === repository.id ? t('syncing') : t('sync')}
        >
          {syncingId === repository.id ? <span className="dghSpin" aria-hidden="true">↻</span> : <>
            {repository.ahead > 0 && <span className="dghAhead" title={t('ahead', { count: repository.ahead })}>{repository.ahead} ↑</span>}
            {repository.behind > 0 && <span className="dghBehind" title={t('behind', { count: repository.behind })}>{repository.behind} ↓</span>}
          </>}
        </button>}
        {repository.fetchError !== null && <span className="dghFetchError" title={repository.fetchError}>!</span>}
      </div>
      {repository.children.map(child => (
        <RepositoryTree
          key={child.id}
          repository={child}
          selectedId={selectedId}
          depth={depth + 1}
          onSelect={onSelect}
          onSync={onSync}
          syncingId={syncingId}
          t={t}
        />
      ))}
    </div>
  )
}

/** 渲染一个可打开详情的提交条目。 */
function CommitRow({ commit, onOpen }: { readonly commit: CommitEntry, readonly onOpen: (commit: CommitEntry) => void }) {
  return (
    <button type="button" className="dghCommit" title={`${commit.hash}\n${commit.authorName} <${commit.authorEmail}>`} onClick={() => onOpen(commit)}>
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
    </button>
  )
}

/** 将差异行类型映射为稳定样式名。 */
function diffLineClass(line: DiffLine): string {
  if (line.kind === 'delete') return 'dghDiffDelete'
  if (line.kind === 'insert') return 'dghDiffInsert'
  if (line.kind === 'modify') return line.partnerKind === 'delete' ? 'dghDiffModifyDelete' : 'dghDiffModifyInsert'
  if (line.kind === 'empty') return 'dghDiffEmpty'
  return 'dghDiffEqual'
}

/** 虚拟渲染单侧差异，避免大文件一次创建全部 DOM 行。 */
function DiffPane({ file, side, paneRef, onScroll }: {
  readonly file: CommitFile
  readonly side: 'before' | 'after'
  readonly paneRef: RefObject<HTMLDivElement>
  readonly onScroll: () => void
}) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const start = Math.max(0, Math.floor(viewport.scrollTop / DIFF_ROW_HEIGHT) - DIFF_OVERSCAN)
  const end = Math.min(file.rows.length, Math.ceil((viewport.scrollTop + viewport.height) / DIFF_ROW_HEIGHT) + DIFF_OVERSCAN)
  const update = () => {
    const pane = paneRef.current
    if (pane !== null) setViewport({ scrollTop: pane.scrollTop, height: pane.clientHeight })
  }
  useEffect(() => {
    const pane = paneRef.current
    if (pane === null) return
    update()
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [file.id, paneRef])
  return (
    <div ref={paneRef} className="dghDiffPane" onScroll={() => { update(); onScroll() }}>
      <div className="dghDiffRows" style={{ height: `${file.rows.length * DIFF_ROW_HEIGHT}px` }}>
        <div className="dghDiffRowsVisible" style={{ top: `${start * DIFF_ROW_HEIGHT}px` }}>
          {file.rows.slice(start, end).map(row => {
            const line = side === 'before' ? row.left : row.right
            return <div className={`dghDiffLine ${diffLineClass(line)}`} key={row.index}>
              <span className="dghDiffLineNo">{line.lineNumber ?? ''}</span>
              <span className="dghDiffCode">{line.text || ' '}</span>
            </div>
          })}
        </div>
      </div>
    </div>
  )
}

/** 展示一个提交相对第一父提交的按文件双栏差异。 */
function CommitDetailDialog({ commit, detail, activeFileId, activeFile, loading, error, onSelect, onClose, t }: {
  readonly commit: CommitEntry
  readonly detail: CommitDetail | null
  readonly activeFileId: string | null
  readonly activeFile: CommitFile | undefined
  readonly loading: boolean
  readonly error: string | null
  readonly onSelect: (file: CommitFileSummary) => void
  readonly onClose: () => void
  readonly t: GitHistoryViewProps['t']
}) {
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)
  const sync = (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (source === null || target === null || syncing.current) return
    syncing.current = true
    target.scrollTop = source.scrollTop
    target.scrollLeft = source.scrollLeft
    requestAnimationFrame(() => { syncing.current = false })
  }
  useEffect(() => {
    if (leftRef.current) { leftRef.current.scrollTop = 0; leftRef.current.scrollLeft = 0 }
    if (rightRef.current) { rightRef.current.scrollTop = 0; rightRef.current.scrollLeft = 0 }
  }, [activeFileId])
  return createPortal(
    <div className="dghDetailOverlay" role="dialog" aria-modal="true" aria-label={t('commitChanges')}>
      <button type="button" className="dghDetailMask" onClick={onClose} aria-label={t('close')} />
      <section className="dghDetailPanel">
        <header className="dghDetailHeader">
          <div><h2>{commit.subject}</h2><p>{commit.authorName} · {formatDate(commit.date)} · <code>{commit.shortHash}</code></p></div>
          <button type="button" className="dghClose" onClick={onClose} aria-label={t('close')}>×</button>
        </header>
        {detail !== null && detail.parentHash !== null && <div className="dghParentNotice">{t('firstParent')}</div>}
        <div className="dghDetailBody">
          <aside className="dghCommitFiles">
            <div className="dghCommitFilesTitle">{t('changedFiles', { count: detail?.files.length ?? 0 })}</div>
            {detail?.files.map(file => <button type="button" key={file.id} className={`dghCommitFile ${activeFileId === file.id ? 'dghCommitFileActive' : ''}`} onClick={() => onSelect(file)} title={file.path}>
              <span className={`dghFileStatus dghFileStatus${file.status}`}>{t(STATUS_KEYS[file.status])}</span>
              <span>{file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`}</span>
            </button>)}
          </aside>
          <main className="dghDiffMain">
            {loading ? <div className="dghState">{t('loadingChanges')}</div> : error !== null ? <div className="dghState dghError">{error}</div> : detail?.files.length === 0 ? <div className="dghState">{t('noChanges')}</div> : activeFile === undefined ? <div className="dghState">{t('selectFile')}</div> : activeFile.binary ? <div className="dghState">{t('binary')}</div> : <>
              <div className="dghSelectedFile" title={activeFile.path}>{activeFile.oldPath !== null && <span>{activeFile.oldPath} → </span>}{activeFile.path}</div>
              <div className="dghDiffColumns"><span>{t('before')}</span><span>{t('after')}</span></div>
              {activeFile.truncated && <div className="dghDiffNotice">{t('truncated')}</div>}
              <div className="dghDiffViewport">
                <DiffPane file={activeFile} side="before" paneRef={leftRef} onScroll={() => sync(leftRef.current, rightRef.current)} />
                <DiffPane file={activeFile} side="after" paneRef={rightRef} onScroll={() => sync(rightRef.current, leftRef.current)} />
                <div className="dghDiffIndicator" aria-hidden="true">{activeFile.markers.map((marker, index) => <span key={`${marker.row}-${marker.kind}-${index}`} className={marker.kind === 'delete' ? 'dghMarkerDelete' : 'dghMarkerInsert'} style={{ top: `${(marker.row / Math.max(1, activeFile.rows.length)) * 100}%` }} />)}</div>
              </div>
            </>}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  )
}

/** 提供常驻工具栏入口，并在按需弹窗中展示仓库树和分页提交历史。 */
export function GitHistoryView(props: GitHistoryViewProps) {
  const { sessionId, useSessions, t } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const [open, setOpen] = useState(false)
  const [repository, setRepository] = useState<RepositoryNode | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [commits, setCommits] = useState<readonly CommitEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<CommitEntry | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<ReadonlyMap<string, CommitFile>>(new Map())
  const [commitLoading, setCommitLoading] = useState(false)
  const [commitFileLoading, setCommitFileLoading] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const selectedRepository = useMemo(() => findRepository(repository, selectedId), [repository, selectedId])
  const activeCommitFile = activeFileId === null ? undefined : commitFiles.get(activeFileId)

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
    if (!open) return
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
  }, [cwd, loadSnapshot, open])

  useEffect(() => {
    if (!open || cwd === undefined || cwd === '' || selectedRepository === null || !selectedRepository.initialized) return
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
  }, [cwd, historyRevision, open, selectedRepository?.id])

  useEffect(() => {
    if (selectedCommit === null || cwd === undefined || cwd === '' || selectedRepository === null) return
    const controller = new AbortController()
    setCommitLoading(true)
    setCommitError(null)
    setCommitDetail(null)
    setActiveFileId(null)
    setCommitFiles(new Map())
    void readCommit({ path: cwd, repositoryId: selectedRepository.id, commitHash: selectedCommit.hash }, controller.signal).then(result => {
      if (result.ok) {
        setCommitDetail(result.value)
        setActiveFileId(result.value.files[0]?.id ?? null)
      } else setCommitError(result.error.message)
    }).catch(cause => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setCommitError(String(cause))
    }).finally(() => setCommitLoading(false))
    return () => controller.abort()
  }, [cwd, selectedCommit, selectedRepository?.id])

  useEffect(() => {
    if (cwd === undefined || cwd === '' || commitDetail === null || activeFileId === null || commitFiles.has(activeFileId)) return
    const controller = new AbortController()
    setCommitFileLoading(true)
    setCommitError(null)
    void readCommitFile({ path: cwd, manifestId: commitDetail.manifestId, fileId: activeFileId }, controller.signal).then(result => {
      if (result.ok) setCommitFiles(current => new Map(current).set(result.value.id, result.value))
      else setCommitError(result.error.message)
    }).catch(cause => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setCommitError(String(cause))
    }).finally(() => setCommitFileLoading(false))
    return () => controller.abort()
  }, [activeFileId, commitDetail, commitFiles, cwd])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      selectedCommit === null ? setOpen(false) : setSelectedCommit(null)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open, selectedCommit])

  /** 同步指定仓库，并在成功后刷新仓库计数和当前提交历史。 */
  const sync = useCallback(async (item: RepositoryNode) => {
    if (cwd === undefined || cwd === '' || syncingId !== null) return
    setSelectedId(item.id)
    setSyncingId(item.id)
    setSyncMessage(null)
    setSyncError(null)
    const result = await syncRepository({ path: cwd, repositoryId: item.id })
    if (result.ok) {
      setSyncMessage(t('syncCompleted', { pulled: result.value.pulled, pushed: result.value.pushed }))
      await loadSnapshot(false)
      setHistoryRevision(current => current + 1)
    } else {
      setSyncError(result.error.message)
    }
    setSyncingId(null)
  }, [cwd, loadSnapshot, syncingId, t])

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

  return (
    <div className="dghDock">
      <button type="button" className="dghLauncher" onClick={() => setOpen(true)} aria-label={t('tab')} title={t('tab')}>
        <span className="dghLauncherIcon" aria-hidden="true">⑂</span>
        <span>{t('tab')}</span>
      </button>
      {open && createPortal(
        <div className="dghOverlay" role="dialog" aria-modal="true" aria-label={t('history')}>
          <button className="dghMask" type="button" onClick={() => setOpen(false)} aria-label={t('close')} />
          <section className="dghPanel">
            <header className="dghHeader">
              <div>
                <h2>{t('history')}</h2>
                {repository !== null && <span>{t('commits', { count: commits.length })}</span>}
              </div>
              <div className="dghHeaderActions">
                <button type="button" className="dghRefresh" disabled={refreshing || loading || cwd === undefined || cwd === ''} onClick={() => void loadSnapshot(true)}>
                  <span className={refreshing ? 'dghSpin' : ''} aria-hidden="true">↻</span>
                  {refreshing ? t('refreshing') : t('refresh')}
                </button>
                <button type="button" className="dghClose" onClick={() => setOpen(false)} aria-label={t('close')}>×</button>
              </div>
            </header>

            {cwd === undefined || cwd === '' ? <div className="dghState">{t('noWorkspace')}</div> : loading && repository === null ? <div className="dghState">{t('loading')}</div> : error !== null ? <div className="dghState dghError">{error}</div> : repository !== null && <div className="dghContent">
              <aside className="dghRepositories">
                <div className="dghRepositoriesTitle">{t('repositories')}</div>
                <RepositoryTree repository={repository} selectedId={selectedId} depth={0} onSelect={item => setSelectedId(item.id)} onSync={item => void sync(item)} syncingId={syncingId} t={t} />
              </aside>
              <main className="dghMain">
                {syncMessage !== null && <div className="dghSyncMessage">{syncMessage}</div>}
                {syncError !== null && <div className="dghSyncMessage dghSyncMessageError">{syncError}</div>}
                <div className="dghHistoryHeader">
                  <h3>{t('history')}</h3>
                  <span>{selectedRepository?.name}</span>
                  {selectedRepository?.fetchError !== null && selectedRepository?.fetchError !== undefined && <span className="dghHistoryWarning" title={selectedRepository.fetchError}>{t('fetchFailed')}</span>}
                </div>
                <div className="dghHistory">
                  {historyLoading ? <div className="dghState">{t('loadingHistory')}</div> : historyError !== null ? <div className="dghState dghError">{historyError}</div> : commits.length === 0 ? <div className="dghState">{t('noHistory')}</div> : <>
                    {commits.map(commit => <CommitRow key={commit.hash} commit={commit} onOpen={setSelectedCommit} />)}
                    {hasMore && <button type="button" className="dghLoadMore" disabled={loadingMore} onClick={() => void loadMore()}>
                      {loadingMore ? t('loadingMore') : t('loadMore')}
                    </button>}
                  </>}
                </div>
              </main>
            </div>}
          </section>
        </div>,
        document.body,
      )}
      {selectedCommit !== null && <CommitDetailDialog
        commit={selectedCommit}
        detail={commitDetail}
        activeFileId={activeFileId}
        activeFile={activeCommitFile}
        loading={commitLoading || commitFileLoading}
        error={commitError}
        onSelect={file => setActiveFileId(file.id)}
        onClose={() => setSelectedCommit(null)}
        t={t}
      />}
    </div>
  )
}
