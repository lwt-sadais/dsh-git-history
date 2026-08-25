import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { ApiResult, HistoryPage, HistoryRequest, RepositorySnapshot, SnapshotRequest } from '../core/types.js'
import type { GitHistoryService } from './git-service.js'

const SNAPSHOT_ROUTE = '/api/dsh-git-history/snapshot'
const HISTORY_ROUTE = '/api/dsh-git-history/log'
const BODY_CAP = 16 * 1024

/** 仅接受来自当前 DSH 页面、回环地址且使用 JSON 的请求。 */
function allowed(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress?.replace(/^::ffff:/u, '')
  if (address === undefined || (address !== '::1' && !(isIP(address) === 4 && address.startsWith('127.')))) return false
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) return false
  const origin = req.headers.origin
  const host = req.headers.host
  return typeof origin === 'string' && typeof host === 'string' && origin === `http://${host}`
}

/** 读取有上限的 JSON 请求体，防止本地路由被大请求占用内存。 */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > BODY_CAP) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 将未知值缩窄为普通 JSON 对象。 */
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** 校验带长度上限的字符串字段。 */
function boundedString(value: unknown, allowEmpty = false): string | null {
  return typeof value === 'string' && value.length <= 4096 && (allowEmpty || value.length > 0) ? value : null
}

/** 校验仓库树快照请求。 */
function snapshotRequestOf(value: unknown): SnapshotRequest | null {
  const record = recordOf(value)
  if (record === null || Object.keys(record).length !== 2) return null
  const path = boundedString(record.path)
  return path === null || typeof record.fetch !== 'boolean' ? null : { path, fetch: record.fetch }
}

/** 校验分页历史请求并限制分页参数范围。 */
function historyRequestOf(value: unknown): HistoryRequest | null {
  const record = recordOf(value)
  if (record === null || Object.keys(record).length !== 4) return null
  const path = boundedString(record.path)
  const repositoryId = boundedString(record.repositoryId, true)
  const skip = record.skip
  const limit = record.limit
  if (path === null || repositoryId === null || !Number.isSafeInteger(skip) || !Number.isSafeInteger(limit)) return null
  if ((skip as number) < 0 || (limit as number) < 1 || (limit as number) > 100) return null
  return { path, repositoryId, skip: skip as number, limit: limit as number }
}

/** 输出无缓存且禁止 MIME 嗅探的 JSON 响应。 */
function send<T>(res: ServerResponse, status: number, result: ApiResult<T>): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(result))
}

/** 注册一条具有统一鉴权、取消和错误处理的本地 POST API。 */
function registerRoute<T, R>(
  ctx: Context,
  route: string,
  parse: (value: unknown) => T | null,
  run: (value: T, signal: AbortSignal) => Promise<ApiResult<R>>,
): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: route,
    handler: async (req, res) => {
      if (req.method !== 'POST' || !allowed(req)) {
        send(res, 403, { ok: false, error: { code: 'invalid-request', message: 'local same-origin JSON POST required' } })
        return
      }
      const controller = new AbortController()
      const abort = () => controller.abort()
      req.once('aborted', abort)
      res.once('close', abort)
      try {
        const value = parse(await readBody(req))
        if (value === null) {
          send(res, 400, { ok: false, error: { code: 'invalid-request', message: 'invalid Git history request' } })
          return
        }
        const result = await run(value, controller.signal)
        if (!controller.signal.aborted && !res.destroyed) send(res, result.ok ? 200 : 400, result)
      } catch (cause) {
        if (!controller.signal.aborted && !res.destroyed) {
          ctx.logger.warn(`dsh-git-history: request failed: ${String(cause)}`)
          send(res, 500, { ok: false, error: { code: 'internal', message: 'Git history request failed' } })
        }
      } finally {
        req.off('aborted', abort)
        res.off('close', abort)
      }
    },
  })
}

/** 注册仓库树与提交历史 API，并返回按逆序释放的 disposer。 */
export function registerRoutes(ctx: Context, service: GitHistoryService): () => void {
  const disposeSnapshot = registerRoute<SnapshotRequest, RepositorySnapshot>(
    ctx,
    SNAPSHOT_ROUTE,
    snapshotRequestOf,
    (request, signal) => service.snapshot(request.path, request.fetch, signal),
  )
  const disposeHistory = registerRoute<HistoryRequest, HistoryPage>(
    ctx,
    HISTORY_ROUTE,
    historyRequestOf,
    (request, signal) => service.history(request, signal),
  )
  return () => { disposeHistory(); disposeSnapshot() }
}
