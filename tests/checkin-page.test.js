const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const pagePath = require.resolve('../learning/check-in/index.js')
const identityPath = require.resolve('../services/identity.js')

function loadPage({ checkin, storage = {}, saveResult = { ok: true }, useCard } = {}) {
  delete require.cache[pagePath]
  let current = checkin
  const cardCalls = []
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
      loadMeDashboard: async () => ({ profile: { displayName: '小鹿' } }),
      useCurrentStreakCard: async (cardType, key) => {
        cardCalls.push({ cardType, key })
        const value = typeof useCard === 'function' ? useCard(cardType, key) : useCard
        if (value instanceof Error) throw value
        return value
      }
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
  return { page, calls, storage, cardCalls, setCheckin: (value) => { current = value } }
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

test('the learning tab shows the real learning streak', async () => {
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

  // 学习连胜页的入口改为四个 tab 页顶栏的火苗与「我的」页的连胜卡片（tests/learning-streak.test.js），
  // 学习页的「连续学习」统计格只显示天数，不再是入口。
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/learning/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /handleOverviewTap/)
})

test('the check-in page shares what it read with the streak entries', async () => {
  const { page } = loadPage({ checkin: checkedToday })
  await page.loadCheckIn()
  const { getStreakState } = require('../services/learning-streak')
  const state = getStreakState()
  assert.equal(state.status, 'ready')
  assert.equal(state.summary.lit, true)
  assert.equal(state.summary.streakDays, 2)
})

// ---- 2026-09-25：冻结卡 / 复活卡 ----
const withCards = (extra = {}) => ({
  today: '2026-09-25',
  checkedDates: ['2026-09-21', '2026-09-24'],
  frozenDates: [],
  revivedDates: [],
  cards: [
    { type: 'freeze', title: '冻结卡', count: 1, effectDays: 3, windowDays: 0, enabled: true },
    { type: 'revive', title: '复活卡', count: 1, effectDays: 2, windowDays: 7, enabled: true }
  ],
  cardRules: [],
  freezePlan: ['2026-09-25', '2026-09-26', '2026-09-27'],
  revivable: { dates: ['2026-09-22', '2026-09-23'] },
  ...extra
})

test('tapping a card opens its sheet with the days it would cover', async () => {
  const { page } = loadPage({ checkin: withCards() })
  await page.loadCheckIn()
  page.handleCardTap({ currentTarget: { dataset: { type: 'revive' } } })
  assert.equal(page.data.cardSheet.type, 'revive')
  assert.equal(page.data.cardSheet.usable, true)
  assert.deepEqual(page.data.cardSheet.days.map((day) => [day.label, day.weekday]), [['9/22', '周二'], ['9/23', '周三']])
  page.onUnload()
})

test('using a revive card calls the flow once, reloads and marks the repaired days', async () => {
  const repaired = withCards({ revivedDates: ['2026-09-22', '2026-09-23'], revivable: null, cards: withCards().cards.map((card) => card.type === 'revive' ? { ...card, count: 0 } : card) })
  const { page, cardCalls, calls, setCheckin } = loadPage({ checkin: withCards(), useCard: () => ({ cardType: 'revive', dates: ['2026-09-22', '2026-09-23'], remaining: 0, streakDays: 2 }) })
  await page.loadCheckIn()
  page.handleCardTap({ currentTarget: { dataset: { type: 'revive' } } })
  setCheckin(repaired)
  await page.handleConfirmUseCard()
  assert.equal(cardCalls.length, 1)
  assert.equal(cardCalls[0].cardType, 'revive')
  assert.match(cardCalls[0].key, /^streak-card-/)
  assert.equal(page.data.cardSheet, null)
  assert.equal(page.data.cardEffect, 'revive')
  assert.deepEqual(calls.toast, ['已补回 9月22日–23日'])
  assert.equal(page.data.model.streak.days, 2)
  const day = page.data.model.calendar.days.find((item) => item.id === '2026-09-22')
  assert.deepEqual([day.isRevived, day.isFresh], [true, true])
  page.onUnload()
})

test('a failed card use keeps the sheet open and says why', async () => {
  const { page, calls } = loadPage({ checkin: withCards(), useCard: new Error('冻结卡用完了。') })
  await page.loadCheckIn()
  page.handleCardTap({ currentTarget: { dataset: { type: 'freeze' } } })
  await page.handleConfirmUseCard()
  assert.equal(page.data.cardSheet.type, 'freeze')
  assert.equal(page.data.usingCard, false)
  assert.deepEqual(calls.toast, ['冻结卡用完了。'])
  page.onUnload()
})

test('the streak page has no activation code entry, and the calendar sits above the card badges', async () => {
  const { page } = loadPage({ checkin: withCards({ cards: [] }) })
  await page.loadCheckIn()
  assert.equal(typeof page.handleRedeemTap, 'undefined')
  const wxml = fs.readFileSync(path.join(__dirname, '../learning/check-in/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /激活码|redemption/)
  const ready = wxml.slice(wxml.indexOf('<scroll-view'))
  assert.ok(ready.indexOf('calendar-card') < ready.indexOf('streak-props'), '日历在道具卡牌上面')
  assert.ok(ready.indexOf('today-task-card') < ready.indexOf('calendar-card'))
  assert.match(wxml, /prop-card-\{\{item\.type\}\} \{\{item\.lit \? 'prop-card-lit' : 'prop-card-off'\}\}/)
  assert.doesNotMatch(wxml, /me\/coins\.png/)
  // 连胜赚的金币只在顶部「连胜已赚 N 金币」显示一次，统计格只剩打卡天数、连胜周数
  assert.match(wxml, /连胜已赚 \{\{model\.streak\.coinsEarned\}\} 金币/)
  assert.doesNotMatch(wxml, /checkin-stat-label">连胜金币/)
  assert.deepEqual([...ready.matchAll(/checkin-stat-label">([^<]+)</g)].map((m) => m[1]), ['打卡天数', '连胜周数'])
})

test('the task row shows how many coins the next check-in brings, ahead of the action', async () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../learning/check-in/index.wxml'), 'utf8')
  const ready = wxml.slice(wxml.indexOf('<scroll-view'))
  const row = ready.slice(ready.indexOf('class="today-task-row"'), ready.indexOf('calendar-month-header'))
  assert.match(row, /<text wx:if="\{\{model\.task\.coinHint\}\}" class="today-task-coins">\{\{model\.task\.coinHint\}\}<\/text>/)
  assert.ok(row.indexOf('today-task-coins') < row.indexOf('today-task-done'), '金币提示在对勾前面')
  assert.ok(row.indexOf('today-task-coins') < row.indexOf('today-task-right'), '金币提示在「去学习 ›」前面')
  const idle = loadPage({ checkin: withCards({ reward: { enabled: true, coins: 20, nextDay: 'today', nextCoins: 30 } }) })
  await idle.page.loadCheckIn()
  assert.equal(idle.page.data.model.task.coinHint, '+30 金币')
  const done = loadPage({
    checkin: withCards({ checkedDates: ['2026-09-24', '2026-09-25'], todayCheckin: { source: 'lesson_completed', rewardCoins: 30 }, reward: { enabled: true, coins: 20, nextDay: 'tomorrow', nextCoins: 40 } }),
    storage: { learning_checkin_celebrated_day: '2026-09-25' }
  })
  await done.page.loadCheckIn()
  assert.equal(done.page.data.model.task.coinHint, '明天 +40 金币')
})

test('tapping a task row goes studying until today is lit', async () => {
  const idle = loadPage({ checkin: withCards() })
  await idle.page.loadCheckIn()
  idle.page.handleTaskTap()
  assert.deepEqual(idle.calls.switchTab, ['/pages/learning/index'])
  const done = loadPage({ checkin: withCards({ checkedDates: ['2026-09-24', '2026-09-25'], todayCheckin: { source: 'lesson_completed', rewardCoins: 20 } }), storage: { learning_checkin_celebrated_day: '2026-09-25' } })
  await done.page.loadCheckIn()
  done.page.handleTaskTap()
  assert.deepEqual(done.calls.switchTab, [])
})

test('calendar taps explain frozen and revived days', async () => {
  const { page, calls } = loadPage({ checkin: withCards({ frozenDates: ['2026-09-26'], revivedDates: ['2026-09-22'] }) })
  await page.loadCheckIn()
  const index = (key) => page.data.model.calendar.days.findIndex((item) => item.id === key)
  page.handleDayTap({ currentTarget: { dataset: { index: index('2026-09-26') } } })
  page.handleDayTap({ currentTarget: { dataset: { index: index('2026-09-22') } } })
  page.handleDayTap({ currentTarget: { dataset: { index: index('2026-09-25') } } })
  assert.deepEqual(calls.toast, ['这一天已冻结，不打卡也不断连胜', '这一天用复活卡补回来了', '学完一节课、通过验收或完成一次复习就能点亮'])
})
