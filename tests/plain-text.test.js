const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 剥 Markdown 记号这件事在 JS 里做，不在 WXML 里用 wxs 做：
// 渲染层每多一个 wxs 调用就多一处只有真机才暴露的失败点，算不出东西时气泡是空的、页面还不报错。
const { stripMarkdown: strip } = require('../utils/plain-text')

test('bold is removed — a real teacher never sends ** around words', () => {
  assert.equal(strip('今天我们先看**二次函数**的顶点式'), '今天我们先看二次函数的顶点式')
  assert.equal(strip('__重点__在配方'), '重点在配方')
  assert.equal(strip('这里*稍微*注意一下'), '这里稍微注意一下')
})

test('headings, quotes, lists and rules lose their markers but keep the words', () => {
  assert.equal(strip('# 今天的目标'), '今天的目标')
  assert.equal(strip('### 第三步'), '第三步')
  assert.equal(strip('> 记得先化简'), '记得先化简')
  assert.equal(strip('- 先看定义域\n- 再看对称轴'), '先看定义域\n再看对称轴')
  assert.equal(strip('1. 配方\n2. 求顶点'), '1. 配方\n2. 求顶点')
  assert.equal(strip('前面\n\n---\n\n后面'), '前面\n\n后面')
})

test('code fences and links keep only what a person would read aloud', () => {
  assert.equal(strip('```js\nconst a = 1\n```'), 'const a = 1')
  assert.equal(strip('用 `x^2` 表示'), '用 x^2 表示')
  assert.equal(strip('看[这道题](https://example.com/q/1)'), '看这道题')
  assert.equal(strip('![图](https://example.com/a.png)'), '图')
})

test('plain text passes through untouched', () => {
  assert.equal(strip('上次测评你在二次函数上丢了 12 分，今天想先解决哪一块？'), '上次测评你在二次函数上丢了 12 分，今天想先解决哪一块？')
  assert.equal(strip('3 * 4 = 12'), '3 * 4 = 12')
  assert.equal(strip(''), '')
  assert.equal(strip(null), '')
  assert.equal(strip(undefined), '')
})

test('a mixed answer comes out as something a teacher could have typed', () => {
  const answer = [
    '## 今天的安排',
    '',
    '先做 **两道** 配方题，再看 `顶点式`。',
    '',
    '- 第一题：y = x² + 4x + 1',
    '- 第二题：y = 2x² - 8x + 5',
    '',
    '> 不会就直接说，我们一起推。'
  ].join('\n')
  assert.equal(strip(answer), [
    '今天的安排',
    '',
    '先做 两道 配方题，再看 顶点式。',
    '',
    '第一题：y = x² + 4x + 1',
    '第二题：y = 2x² - 8x + 5',
    '',
    '不会就直接说，我们一起推。'
  ].join('\n'))
})

test('the teacher text is plain by the time it reaches the template', () => {
  const page = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  // 模板里老师的气泡只写 {{item.text}}，和学生自己的气泡走同一条渲染路径
  assert.ok(!page.includes('plain-text.wxs'), '渲染层不再依赖 wxs 剥记号')
  assert.ok(!/PT\.strip\(/.test(page))
  const source = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')
  assert.match(source, /stripMarkdown\(settled\)/, '正文落到 data 之前就剥好')
  // 记录里可能带卡片数据（utils/room-card-record.js）：先拆出可读文字，再剥记号
  assert.match(source, /decodeRoomCard\(row\.content\)[\s\S]{0,800}stripMarkdown\(text\)/, '老师亲手打的字同样剥好再显示')
})
