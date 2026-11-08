// 摸底诊断作答页「上一题」（2026-09-29）：本轮提交前可以翻回已答过的题，看到自己选的答案并重新选择。
// 服务端（scripts/assessment/diagnostic-service.js）的 read 带 position 翻到某题、answer 可改已保存的答案；这里用同样规则的假服务。
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function fakeServer(total = 3) {
  const order = Array.from({ length: total }, (_, i) => 101 + i)
  const answers = {}
  const state = { revision: 0, cursor: 0 }
  const calls = []
  const view = (position) => {
    const index = position == null ? state.cursor : Math.max(0, Math.min(position, state.cursor))
    const id = order[index]
    const saved = Object.prototype.hasOwnProperty.call(answers, id)
    return {
      id: 7, status: 'draft', revision: state.revision, answeredCount: state.cursor, totalQuestions: total, position: index, roundCount: 1,
      current: id ? { id, number: index + 1, prompt: '第 ' + (index + 1) + ' 题', options: ['A', 'B', 'C', 'D'].map((value) => ({ value, label: value + '项' })), answered: saved, selected: saved ? answers[id].selected : '' } : null
    }
  }
  async function call(op, payload) {
    calls.push([op, { ...payload }])
    if (op === 'read') return { attempt: view(payload.position) }
    if (op === 'answer') {
      const id = payload.questionId, index = order.indexOf(id), saved = answers[id]
      if (saved && saved.selected === payload.answer) return { attempt: view(index + 1) }
      if (payload.revision !== state.revision || (!saved && index !== state.cursor)) throw Object.assign(Error('答案状态已更新，请重新加载后继续。'), { code: 'revision_conflict' })
      if (saved) { saved.selected = payload.answer; saved.secondsUsed += payload.secondsUsed || 0 } else { answers[id] = { selected: payload.answer, secondsUsed: payload.secondsUsed }; state.cursor++ }
      state.revision++
      return { attempt: view(index + 1) }
    }
    throw Error('unexpected ' + op)
  }
  return { call, calls, answers, order, state }
}

function fixture(call) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assessment/short/index.js'), 'utf8'), {
    Page: (p) => { definition = p },
    require: () => ({ call, reportView: (r) => r }),
    wx: { showModal() {}, navigateTo() {}, showToast() {} },
    Date, setInterval: () => 1, clearInterval() {}
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({ attemptId: 7 })
  page.visible = true
  return page
}
const plain = (value) => JSON.parse(JSON.stringify(value)) // 页面在 vm 里跑，数组跨 realm 要先转成本地值再比
const tap = (dataset = {}) => ({ currentTarget: { dataset } })
async function choose(page, value, skip) {
  if (!skip) page.select(tap({ value }))
  await page.next(tap(skip ? { skip: 'yes' } : {}))
}

test('going back shows the saved answer selected and the current segment on that question', async () => {
  const server = fakeServer()
  const page = fixture(server.call)
  await page.loadPage()
  assert.equal(page.data.position, 0)
  await choose(page, 'B')
  await choose(page, 'C')
  assert.equal(page.data.position, 2)
  assert.equal(page.data.revisiting, false)

  await page.previous()
  assert.deepEqual(server.calls.at(-1), ['read', { attemptId: 7, position: 1 }])
  assert.equal(page.data.currentNumber, 2)
  assert.equal(page.data.revisiting, true)
  assert.equal(page.data.savedAnswer, 'C')
  assert.equal(page.data.answer, 'C')
  assert.deepEqual(plain(page.data.optionList.filter((o) => o.isSelected).map((o) => o.value)), ['C'])
  assert.deepEqual(plain(page.data.segments.map((s) => s.segmentClass)), ['is-completed', 'is-current', 'is-upcoming'])

  await page.previous()
  assert.equal(page.data.position, 0)
  await page.previous() // 第 1 题没有上一题
  assert.equal(server.calls.filter(([op]) => op === 'read').length, 3)
})

test('re-choosing on a revisited question saves the change and moves to the following question', async () => {
  const server = fakeServer()
  const page = fixture(server.call)
  await page.loadPage()
  await choose(page, 'B')
  await choose(page, 'C')
  await page.previous()
  await page.previous()
  page.select(tap({ value: 'D' }))
  assert.notEqual(page.data.answer, page.data.savedAnswer) // 按钮显示「保存修改，继续」
  await page.next(tap())
  assert.equal(server.answers[101].selected, 'D')
  assert.equal(server.state.cursor, 2)
  assert.equal(page.data.position, 1)
  assert.equal(page.data.answer, 'C')
  // 没改答案：直接往后翻，不写库
  const revision = server.state.revision
  await page.next(tap())
  assert.equal(server.state.revision, revision)
  assert.equal(page.data.position, 2)
  assert.equal(page.data.revisiting, false)
})

test('a skipped question can be answered later, or passed again without picking anything', async () => {
  const server = fakeServer()
  const page = fixture(server.call)
  await page.loadPage()
  await choose(page, '', true)
  await choose(page, 'A')
  await page.previous()
  await page.previous()
  assert.equal(page.data.revisiting, true)
  assert.equal(page.data.savedAnswer, '')
  // 仍然不会：不选直接点下一题，不报「请选择一个答案」
  await page.next(tap())
  assert.equal(page.data.error, '')
  assert.equal(page.data.position, 1)
  await page.previous()
  await choose(page, 'B')
  assert.equal(server.answers[101].selected, 'B')
})

test('an unsubmitted pick survives a trip back, and its time keeps adding up', async () => {
  const server = fakeServer()
  const page = fixture(server.call)
  await page.loadPage()
  await choose(page, 'A')
  page.select(tap({ value: 'D' })) // 第 2 题点了 D 还没提交
  page.questionShownAt = Date.now() - 20000
  await page.previous()
  page.questionShownAt = Date.now() - 5000
  await page.next(tap()) // 第 1 题没改，翻回第 2 题
  assert.equal(page.data.position, 1)
  assert.equal(page.data.answer, 'D')
  page.questionShownAt = Date.now() - 10000
  await page.next(tap())
  const sent = server.calls.filter(([op, p]) => op === 'answer' && p.questionId === 102).at(-1)[1]
  assert.equal(sent.answer, 'D')
  assert.ok(sent.secondsUsed >= 30 && sent.secondsUsed <= 32, String(sent.secondsUsed))
})

test('after the last question you can still go back before submitting the round', async () => {
  const server = fakeServer(2)
  const page = fixture(server.call)
  await page.loadPage()
  await choose(page, 'A')
  await choose(page, 'B')
  assert.equal(page.data.attempt.current, null)
  assert.equal(page.data.position, 2)
  assert.equal(page.data.currentNumber, 2)
  assert.deepEqual(plain(page.data.segments.map((s) => s.segmentClass)), ['is-completed', 'is-completed'])
  await page.previous()
  assert.equal(page.data.attempt.current.id, 102)
  assert.equal(page.data.answer, 'B')
})

test('a silent refresh stays on the question being revisited', async () => {
  const server = fakeServer()
  const page = fixture(server.call)
  await page.loadPage()
  await choose(page, 'A')
  await choose(page, 'B')
  await page.previous()
  page.select(tap({ value: 'D' }))
  await page.loadPage(true)
  assert.deepEqual(server.calls.at(-1), ['read', { attemptId: 7, position: 1 }])
  assert.equal(page.data.position, 1)
  assert.equal(page.data.answer, 'D')
})

test('an older flow without position still starts at the first unanswered question', () => {
  const page = fixture(async () => ({}))
  page.showAttempt({ id: 7, status: 'draft', revision: 2, answeredCount: 2, totalQuestions: 4, current: { id: 103, options: [{ value: 'A', label: '甲' }] } })
  assert.equal(page.data.position, 2)
  assert.equal(page.data.currentNumber, 3)
  assert.equal(page.data.revisiting, false)
})
