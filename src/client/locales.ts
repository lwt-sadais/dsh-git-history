export const zh = {
  tab: 'Git',
  repositories: '仓库',
  history: '提交历史',
  refresh: '刷新并 Fetch',
  refreshing: '正在 Fetch…',
  loading: '正在读取 Git 仓库…',
  loadingHistory: '正在读取提交历史…',
  noWorkspace: '当前会话没有工作区',
  noHistory: '当前仓库没有提交记录',
  uninitialized: '未初始化',
  noBranch: '未知分支',
  noUpstream: '未设置跟踪分支',
  fetchFailed: 'Fetch 失败',
  loadMore: '加载更多',
  loadingMore: '正在加载…',
  ahead: '本地领先 {count} 个提交',
  behind: '本地落后 {count} 个提交',
  commits: '{count} 条提交',
} as const

export const en = {
  tab: 'Git', repositories: 'Repositories', history: 'Commit History', refresh: 'Refresh and fetch', refreshing: 'Fetching…',
  loading: 'Reading Git repositories…', loadingHistory: 'Reading commit history…', noWorkspace: 'The current session has no workspace',
  noHistory: 'No commits in this repository', uninitialized: 'Not initialized', noBranch: 'Unknown branch', noUpstream: 'No upstream branch',
  fetchFailed: 'Fetch failed', loadMore: 'Load more', loadingMore: 'Loading…', ahead: '{count} commits ahead', behind: '{count} commits behind',
  commits: '{count} commits',
} as const

export type GitHistoryLocaleKey = keyof typeof zh
