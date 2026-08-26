import { realpath } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { alignDiff, GitHistoryService, parseAheadBehind, parseCommitFiles, parseHistory, parseSubmodulePaths } from '../src/host/git-service.js'

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

  it('对齐替换行并生成双侧标记', () => {
    const result = alignDiff('one\ntwo\n', 'one\nTWO\n')
    expect(result.rows[1]?.left).toMatchObject({ kind: 'modify', text: 'two', lineNumber: 2 })
    expect(result.rows[1]?.right).toMatchObject({ kind: 'modify', text: 'TWO', lineNumber: 2 })
    expect(result.markers).toEqual([{ row: 1, kind: 'delete' }, { row: 1, kind: 'insert' }])
  })

  it('解析提交文件的增删改名状态', () => {
    const files = parseCommitFiles('M\0src/a.ts\0A\0src/b.ts\0D\0old.ts\0R100\0before.ts\0after.ts\0')
    expect(files.map(({ id: _id, ...file }) => file)).toEqual([
      { path: 'src/a.ts', oldPath: null, status: 'modified' },
      { path: 'src/b.ts', oldPath: null, status: 'added' },
      { path: 'old.ts', oldPath: null, status: 'deleted' },
      { path: 'after.ts', oldPath: 'before.ts', status: 'renamed' },
    ])
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

describe('提交改动', () => {
  it('先返回文件清单，再按文件读取第一父提交差异', async () => {
    const root = await realpath(process.cwd())
    const hash = 'a'.repeat(40)
    const parentHash = 'b'.repeat(40)
    const calls: string[][] = []
    const runner = {
      async run(argv: readonly string[]) {
        calls.push([...argv])
        const command = argv.join(' ')
        if (command === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${root}\n`, stderr: '' }
        if (command === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'main\n', stderr: '' }
        if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 1, stdout: '', stderr: '' }
        if (command === `cat-file -e ${hash}^{commit}`) return { exitCode: 0, stdout: '', stderr: '' }
        if (command === `rev-parse --verify ${hash}^1`) return { exitCode: 0, stdout: `${parentHash}\n`, stderr: '' }
        if (argv[0] === 'diff-tree') return { exitCode: 0, stdout: 'M\0src/a.ts\0', stderr: '' }
        if (command === `show ${parentHash}:src/a.ts`) return { exitCode: 0, stdout: 'before\n', stderr: '' }
        if (command === `show ${hash}:src/a.ts`) return { exitCode: 0, stdout: 'after\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitHistoryService(runner, { async resolve() { return { ok: true, value: root } } })
    await service.snapshot(root, false)

    const detail = await service.commit({ path: root, repositoryId: '', commitHash: hash })
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.value.parentHash).toBe(parentHash)
    expect(detail.value.files).toHaveLength(1)
    expect(calls.some(call => call[0] === 'show')).toBe(false)

    const file = await service.commitFile({ path: root, manifestId: detail.value.manifestId, fileId: detail.value.files[0]!.id })
    expect(file.ok).toBe(true)
    if (!file.ok) return
    expect(file.value.rows[0]).toMatchObject({ left: { text: 'before' }, right: { text: 'after' }, changed: true })
    expect(calls.filter(call => call[0] === 'show')).toHaveLength(2)
  })

  it('根提交的新增文件使用空白修改前内容', async () => {
    const root = await realpath(process.cwd())
    const hash = 'c'.repeat(40)
    const runner = {
      async run(argv: readonly string[]) {
        const command = argv.join(' ')
        if (command === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${root}\n`, stderr: '' }
        if (command === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'main\n', stderr: '' }
        if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { exitCode: 1, stdout: '', stderr: '' }
        if (command === `cat-file -e ${hash}^{commit}`) return { exitCode: 0, stdout: '', stderr: '' }
        if (command === `rev-parse --verify ${hash}^1`) return { exitCode: 1, stdout: '', stderr: '' }
        if (argv[0] === 'diff-tree') return { exitCode: 0, stdout: 'A\0README.md\0', stderr: '' }
        if (command === `show ${hash}:README.md`) return { exitCode: 0, stdout: 'hello\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitHistoryService(runner, { async resolve() { return { ok: true, value: root } } })
    await service.snapshot(root, false)
    const detail = await service.commit({ path: root, repositoryId: '', commitHash: hash })
    if (!detail.ok) throw new Error('commit detail failed')
    const file = await service.commitFile({ path: root, manifestId: detail.value.manifestId, fileId: detail.value.files[0]!.id })
    expect(file).toMatchObject({ ok: true, value: { status: 'added', rows: [{ left: { kind: 'empty' }, right: { text: 'hello' } }] } })
  })

  it('拒绝未知清单和文件标识', async () => {
    const root = await realpath(process.cwd())
    const service = new GitHistoryService({ async run() { return { exitCode: 1, stdout: '', stderr: '' } } }, {
      async resolve() { return { ok: true, value: root } },
    })
    await expect(service.commitFile({ path: root, manifestId: 'unknown', fileId: 'unknown' })).resolves.toMatchObject({
      ok: false, error: { code: 'manifest-stale' },
    })
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
