const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function setup(load) {
  let definition
  let serial = 0
  const timers = new Map()
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/learning/index.js'), 'utf8'), {
    Page: value => { definition = value },
    require: () => ({ getLiveLearningModel: load, getLearningModel: () => ({ calendarTitle: '今天', studyTasks: [] }) }),
    getApp: () => ({}), wx: { showToast() {}, stopPullDownRefresh() {} },
    setTimeout: fn => { timers.set(++serial, fn); return serial }, clearTimeout: id => timers.delete(id),
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, timers }
}
function result(canPoll, progress) {
  return { model: { studyTasks: [{ id: 1, progress }] }, dashboard: { tasks: [{ id: 1, canPoll }] } }
}
test('visible generation polls to ready, then stops; hiding cancels polling', async () => {
  let count = 0
  const { page, timers } = setup(async () => ++count === 1 ? result(true, 30) : result(false, 100))
  await page.onShow()
  assert.equal(timers.size, 1)
  await [...timers.values()][0]()
  assert.equal(page.data.model.studyTasks[0].progress, 100)
  assert.equal(timers.size, 0)
  page.data.dashboard.tasks[0].canPoll = true
  page.scheduleProgressPolling()
  page.onHide()
  assert.equal(timers.size, 0)
})
test('late loads cannot replace a hidden page or a newer progress response', async () => {
  const replies = []
  const { page, timers } = setup(() => new Promise(resolve => replies.push(resolve)))
  page._visible = true
  const first = page.refreshLearning(), second = page.refreshLearning()
  replies[1](result(false, 100)); await second
  replies[0](result(true, 15)); await first
  assert.equal(page.data.model.studyTasks[0].progress, 100)
  const third = page.refreshLearning()
  page.onHide()
  replies[2](result(true, 30)); await third
  assert.equal(page.data.model.studyTasks[0].progress, 100)
  assert.equal(timers.size, 0)
})
