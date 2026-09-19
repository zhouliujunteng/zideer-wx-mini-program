const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const pagePath = require.resolve('../learning/check-in/index.js')
const identityPath = require.resolve('../services/identity.js')

function loadPage({ checkin, storage = {}, saveResult = { ok: true } } = {}) {
  delete require.cache[pagePath]
  let current = checkin
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadCurrentLearningCheckin: async () => {
        const value = typeof current === 'function' ? current() : current
        if (value instanceof Error) throw value
        return value
      },
      loadMeDashboard: async () => ({ profile: { displayName: '小鹿' } })
    }
  }
  let definition = null
  const calls = { navigate: [], switchTab: [], toast: [], modal: [], saved: [] }
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    navigateTo: (options) => calls.navigate.push(options.url),
    navigateBack: () => calls.navigate.push('back'),
    switchTab: (options) => calls.switchTab.push(options.url),
    showToast: (options) => calls.toast.push(options.title),
    showModal: (options) => calls.modal.push(options.title),
    canvasToTempFilePath: (options) => options.success({ tempFilePath: 'wxfile://poster.png' }),
    createCanvasContext: () => new Proxy({}, { get: (target, key) => key === 'draw' ? (flag, done) => done && done() : () => {} }),
    saveImageToPhotosAlbum: (options) => {
      calls.saved.push(options.filePath)
      if (saveResult.ok) options.success()
      else options.fail({ errMsg: saveResult.errMsg })
    }
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls, storage, setCheckin: (value) => { current = value } }
}

const checkedToday = { today: '2026-09-19', checkedDates: ['2026-09-18', '2026-09-19'] }
const notYet = { today: '2026-09-19', checkedDates: ['2026-09-17', '2026-09-18'] }

test('the check-in page loads the real streak for the current month', async () => {
  const { page } = loadPage({ checkin: notYet })
  await page.loadCheckIn()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.model.streak.days, 2)
  assert.equal(page.data.model.calendar.monthLabel, '2026年9月')
  assert.equal(page.data.model.shareCard.posterNickname, '小鹿')
  assert.equal(page.data.showSuccessSheet, false)
})

test('a failed first load shows the error and can be retried', async () => {
  const { page, setCheckin } = loadPage({ checkin: new Error('学习打卡暂时无法读取，请稍后重试。') })
  await page.loadCheckIn()
  assert.equal(page.data.loadState, 'failed')
  assert.equal(page.data.loadError, '学习打卡暂时无法读取，请稍后重试。')
  setCheckin(notYet)
  await page.loadCheckIn()
  assert.equal(page.data.loadState, 'ready')
})

test('the success sheet celebrates the first check-in of the day only once', async () => {
  const storage = {}
  const first = loadPage({ checkin: checkedToday, storage })
  await first.page.loadCheckIn()
  assert.equal(first.page.data.showSuccessSheet, true)
  assert.equal(storage.learning_checkin_celebrated_day, '2026-09-19')

  const second = loadPage({ checkin: checkedToday, storage })
  await second.page.loadCheckIn()
  assert.equal(second.page.data.showSuccessSheet, false)
})

test('month navigation goes back freely but never into the future', async () => {
  const { page } = loadPage({ checkin: notYet })
  await page.loadCheckIn()
  page.handleMonthChange({ currentTarget: { dataset: { direction: '1' } } })
  assert.equal(page.data.calendarMonth, 9)
  page.handleMonthChange({ currentTarget: { dataset: { direction: '-1' } } })
  assert.deepEqual([page.data.calendarYear, page.data.calendarMonth, page.data.model.calendar.monthLabel], [2026, 8, '2026年8月'])
  page.handleMonthChange({ currentTarget: { dataset: { direction: '1' } } })
  assert.equal(page.data.calendarMonth, 9)
  page.onUnload()
})

test('the main button studies before check-in and shares afterwards', async () => {
  const idle = loadPage({ checkin: notYet })
  await idle.page.loadCheckIn()
  idle.page.handlePrimaryAction()
  assert.deepEqual(idle.calls.switchTab, ['/pages/learning/index'])

  const done = loadPage({ checkin: checkedToday, storage: { learning_checkin_celebrated_day: '2026-09-19' } })
  await done.page.loadCheckIn()
  done.page.handlePrimaryAction()
  assert.equal(done.page.data.showShareSheet, true)
  assert.equal(done.page.onShareAppMessage().title, '我已在知鹿连续学习 2 天')
  assert.equal(done.page.onShareAppMessage().path, '/learning/check-in/index')
})

test('saving the poster asks for album permission when it was denied, but not when cancelled', async () => {
  const denied = loadPage({ checkin: checkedToday, saveResult: { ok: false, errMsg: 'saveImageToPhotosAlbum:fail auth deny' } })
  await denied.page.loadCheckIn()
  await denied.page.handleSaveSharePoster()
  assert.deepEqual(denied.calls.saved, ['wxfile://poster.png'])
  assert.deepEqual(denied.calls.modal, ['需要相册权限'])

  const cancelled = loadPage({ checkin: checkedToday, saveResult: { ok: false, errMsg: 'saveImageToPhotosAlbum:fail cancel' } })
  await cancelled.page.loadCheckIn()
  await cancelled.page.handleSaveSharePoster()
  assert.deepEqual(cancelled.calls.modal, [])
})

test('the learning tab shows the real learning streak and opens the check-in page', async () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module,
    require: (name) => {
      if (name === './mock-service') return { getLearningModel: () => ({ notifications: {} }) }
      if (name === './checkin-model') return require('../services/checkin-model')
      if (name === '../utils/agent-course-view') return require('../utils/agent-course-view')
      return {
        loadLearningDashboard: async () => ({ students: [{}], tasks: [] }),
        loadAgentCourses: async () => [],
        loadCurrentLearningCheckin: async () => ({ today: '2026-09-19', checkedDates: ['2026-09-16', '2026-09-17', '2026-09-18'] })
      }
    }
  })
  const { model } = await module.exports.getLiveLearningModel()
  const streak = model.overview.find((item) => item.label === '连续学习')
  assert.deepEqual([streak.value, streak.unit], ['3', '天'])

  const wxml = fs.readFileSync(path.join(__dirname, '../pages/learning/index.wxml'), 'utf8')
  assert.match(wxml, /bindtap="handleOverviewTap"/)
  assert.match(fs.readFileSync(path.join(__dirname, '../pages/learning/index.js'), 'utf8'), /\/learning\/check-in\/index/)
})
