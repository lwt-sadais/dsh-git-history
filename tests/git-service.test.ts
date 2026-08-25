import { realpath } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { GitHistoryService, parseAheadBehind, parseHistory, parseSubmodulePaths } from '../src/host/git-service.js'

/** 构造与宿主 git log 格式一致的一条测试记录。 */
function historyRecord(fields: readonly string[]): string {
  return `${fields.join('\u001f')}\u001e`
}

/** 构造按命令返回结果的受控 Git 执行器，并记录实际执行顺序。 */
function commandRunner(root: string, ahead: number, behind: number) {
  const calls: string[][] = []
  return {
    calls,
    runner: {
      async run(argv: readonly string[]) {
        calls.push([...argv])
        const command = argv.join(' ')
        if (command === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${root}\n`, stderr: '' }
        if (command === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'main\n', stderr: '' }
        if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 0, stdout: 'origin/main\n', stderr: '' }
        if (command === 'rev-list --left-right --count HEAD...@{upstream}') return { exitCode: 0, stdout: `${ahead}\t${behind}\n`, stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  }
}

describe('Git 输出解析', () => {
  it('解析 ahead 和 behind 计数', () => {
    expect(parseAheadBehind('3\t5\n')).toEqual({ ahead: 3, behind: 5 })
    expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 })
  })

  it('解析递归子模块声明路径', () => {
    expect(parseSubmodulePaths([
      'submodule.common.path src/dt-common-mp',
      'submodule.form.path src/dt-form-process-h5',
      '',
    ].join('\n'))).toEqual(['src/dt-common-mp', 'src/dt-form-process-h5'])
  })

  it('解析提交历史和引用', () => {
    const stdout = historyRecord([
      '0123456789abcdef',
      '0123456',
      '2026-08-25T10:00:00+08:00',
      'feat: 新增历史视图',
      '测试作者',
      'author@example.com',
      'HEAD -> main, tag: v0.1.0, origin/main',
    ])
    expect(parseHistory(stdout)).toEqual([{
      hash: '0123456789abcdef',
      shortHash: '0123456',
      date: '2026-08-25T10:00:00+08:00',
      subject: 'feat: 新增历史视图',
      authorName: '测试作者',
      authorEmail: 'author@example.com',
      refs: ['HEAD -> main', 'tag: v0.1.0', 'origin/main'],
    }])
  })
})

describe('Git 同步', () => {
  it('存在落后和领先提交时先 pull 再 push', async () => {
    const root = await realpath(process.cwd())
    const { calls, runner } = commandRunner(root, 2, 3)
    const service = new GitHistoryService(runner, { async resolve() { return { ok: true, value: root } } })

    const snapshot = await service.snapshot(root, false)
    expect(snapshot.ok).toBe(true)
    calls.length = 0
    await expect(service.sync({ path: root, repositoryId: '' })).resolves.toEqual({
      ok: true,
      value: { branch: 'main', pulled: 3, pushed: 2 },
    })
    expect(calls.slice(-2)).toEqual([['pull', '--ff-only'], ['push']])
  })

  it('没有同步差异时不执行 pull 或 push', async () => {
    const root = await realpath(process.cwd())
    const { calls, runner } = commandRunner(root, 0, 0)
    const service = new GitHistoryService(runner, { async resolve() { return { ok: true, value: root } } })

    await service.snapshot(root, false)
    calls.length = 0
    await service.sync({ path: root, repositoryId: '' })
    expect(calls.some(argv => argv[0] === 'pull' || argv[0] === 'push')).toBe(false)
  })
})
