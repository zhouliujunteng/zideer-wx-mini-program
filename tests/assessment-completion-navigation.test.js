const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture(call) {
  let definition
  const navigations = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assessment/short/index.js'), 'utf8'), {
    Page(page) { definition = page },
    require() { return { call, reportView: value => value } },
    wx: {
      getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 } },
      showModal() {},
      navigateTo(options) { navigations.push(options) },
      switchTab(options) { navigations.push(options) },
      setInterval() { return 1 },
      clearInterval() {}
    }
  })
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) },
    stopTimer: definition.stopTimer,
    startTimer: definition.startTimer,
    showAttempt: definition.showAttempt,
    loadPage: definition.loadPage
  }
  definition.onLoad.call(instance, {})
  instance.visible = true
  return { definition, instance, navigations }
}

test('short assessment starts, saves answers, and renders the submitted report', async () => {
  const answers = []
  const { definition, instance } = fixture(async (operation, payload) => {
    if (operation === 'start') return { attempt: { id: '51', revision: 0, status: 'draft', answeredCount: 0, totalQuestions: 1, current: { id: 'q1', prompt: '题目', options: [{ value: 'A', label: '选项 A' }] } } }
    if (operation === 'answer') {
      answers.push(payload)
      return { attempt: { id: '51', revision: 1, status: 'submitted', answeredCount: 1, totalQuestions: 1, current: null, report: { scope: { name: '数学摸底' }, answeredCount: 1, topics: [], totalScore: 100, scoreBand: '扎实' } } }
    }
    throw new Error(`unexpected operation: ${operation}`)
  })

  await definition.start.call(instance, { currentTarget: { dataset: { id: '8' } } })
  instance.setData({ answer: 'A' })
  await definition.next.call(instance, { currentTarget: { dataset: {} } })

  assert.equal(answers.length, 1)
  assert.equal(answers[0].attemptId, '51')
  assert.equal(answers[0].revision, 0)
  assert.equal(answers[0].questionId, 'q1')
  assert.equal(answers[0].answer, 'A')
  assert.equal(instance.data.report.totalScore, 100)
})

test('completed short assessment returns to its list without using deleted legacy pages', () => {
  const { definition, instance, navigations } = fixture(async () => {})
  instance.setData({ report: { scope: { name: '数学摸底' } }, attempt: { id: '51' } })
  definition.backToList.call(instance)
  assert.equal(navigations.length, 0)
  assert.equal(instance.data.attempt, null)
})
