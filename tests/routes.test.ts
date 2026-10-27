import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { allowed } from '../src/host/routes.js'

/** 构造仅包含来源校验所需字段的请求替身；未指定 address 时模拟回环连接。 */
function request(options: {
  readonly address?: string | undefined
  readonly headers?: Record<string, string | undefined>
} = {}): IncomingMessage {
  return {
    socket: { remoteAddress: 'address' in options ? options.address : '127.0.0.1' },
    headers: { 'content-type': 'application/json', ...options.headers },
  } as unknown as IncomingMessage
}

describe('allowed', () => {
  it('DSH Desktop 代理剥离 Origin 后按回环地址与 JSON 放行', () => {
    expect(allowed(request())).toBe(true)
    expect(allowed(request({ address: '::1' }))).toBe(true)
    expect(allowed(request({ address: '::ffff:127.0.0.1' }))).toBe(true)
  })

  it('拒绝非回环来源', () => {
    expect(allowed(request({ address: '192.168.1.5' }))).toBe(false)
    expect(allowed(request({ address: '::ffff:192.168.1.5' }))).toBe(false)
    expect(allowed(request({ address: undefined }))).toBe(false)
  })

  it('拒绝非 JSON 请求', () => {
    expect(allowed(request({ headers: { 'content-type': 'text/plain' } }))).toBe(false)
    expect(allowed(request({ headers: { 'content-type': undefined } }))).toBe(false)
  })

  it('浏览器同源请求仍需 Origin 与 Host 一致', () => {
    const host = '127.0.0.1:50813'
    expect(allowed(request({ headers: { origin: `http://${host}`, host } }))).toBe(true)
    expect(allowed(request({ headers: { origin: 'http://evil.example', host } }))).toBe(false)
    expect(allowed(request({ headers: { origin: `http://${host}` } }))).toBe(false)
    expect(allowed(request({ headers: { origin: 'http://127.0.0.1:1', host } }))).toBe(false)
  })

  it('接受桌面壳的 dsh-app 来源', () => {
    expect(allowed(request({ headers: { origin: 'dsh-app://app' } }))).toBe(true)
  })
})
