import { describe, expect, it } from 'vitest'
import { parseAheadBehind, parseHistory, parseSubmodulePaths } from '../src/host/git-service.js'

/** 构造与宿主 git log 格式一致的一条测试记录。 */
function historyRecord(fields: readonly string[]): string {
  return `${fields.join('\u001f')}\u001e`
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
