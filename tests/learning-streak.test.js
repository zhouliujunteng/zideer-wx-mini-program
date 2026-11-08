// 学习连胜入口：四个 tab 页顶栏的火苗（components/streak-entry）、「我的」页的连胜卡片（components/streak-card）
// 与打卡页、学习页共用 services/learning-streak.js 的同一份打卡状态。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { buildStreakSummary } = require('../services/checkin-model')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const storePath = require.resolve('../services/learning-streak.js')
const identityPath = require.resolve('../services/identity.js')

function loadStore(loader) {
  const storage = { zion_runtime_token: 'token-a' }
  const calls = { count: 0 }
  delete require.cache[storePath]
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadCurrentLearningCheckin: () => {
        calls.count += 1
        return loader(calls.count)
      }
    }
  }
  global.wx = { getStorageSync: (key) => storage[key] }
  const store = require(storePath)
  delete require.cache[identityPath]
  return { store, storage, calls }
}

const today = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const litCheckin = () => ({ today: today(), checkedDates: [shift(today(), -1), today()], todaySeconds: 420, thresholdSeconds: 300 })
const idleCheckin = () => ({ today: today(), checkedDates: [shift(today(), -2), shift(today(), -1)], todaySeconds: 120, thresholdSeconds: 300 })

test('the summary lights the flame only when today is checked in and lists this week from Sunday', () => {
  const lit = buildStreakSummary({ today: '2026-09-24', checkedDates: ['2026-09-22', '2026-09-23', '2026-09-24'] })
  assert.equal(lit.lit, true)
  assert.equal(lit.streakDays, 3)
  assert.equal(lit.iconSrc, '/learning/assets/check-in/streak.svg')
  assert.equal(lit.stateLabel, '今天也保持住了')
  assert.deepEqual(lit.week.map((day) => day.id), ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
  assert.deepEqual(lit.week.map((day) => day.label).join(''), '日一二三四五六')
  assert.deepEqual(lit.week.filter((day) => day.isChecked).map((day) => day.date), [22, 23, 24])
  assert.equal(lit.week.find((day) => day.isToday).date, 24)
  assert.deepEqual(lit.week.filter((day) => day.isFuture).map((day) => day.date), [25, 26])

  // 今天还没打卡：天数从昨天往前数（今天还有机会），图标是未点亮版，提示怎么点亮（2026-09-25 起学完一节课算一天）。
  const idle = buildStreakSummary({ today: '2026-09-24', checkedDates: ['2026-09-22', '2026-09-23'] })
  assert.equal(idle.lit, false)
  assert.equal(idle.streakDays, 2)
  assert.equal(idle.iconSrc, '/learning/assets/check-in/streak-gray.svg')
  assert.equal(idle.stateLabel, '学完一节课就能点亮今天')
})

test('entries start as a skeleton and share one request when several refresh at once', async () => {
  let resolve
  const { store, calls } = loadStore((count) => count === 1 ? new Promise((done) => { resolve = done }) : Promise.resolve(litCheckin()))
  assert.equal(store.getStreakState().status, 'loading')
  const seen = []
  store.subscribeStreak((state) => seen.push(state.status))

  const pending = Promise.all([store.refreshStreak(), store.refreshStreak(), store.loadCheckin()])
  resolve(litCheckin())
  const [first, second, raw] = await pending
  assert.equal(calls.count, 1)
  assert.equal(first.status, 'ready')
  assert.equal(second.summary.lit, true)
  assert.deepEqual(raw, litCheckin())
  assert.deepEqual(seen, ['ready'])

  // 10 秒内再切回页面直接用上次的结果。
  await store.refreshStreak()
  assert.equal(calls.count, 1)
  await store.refreshStreak({ maxAge: 0 })
  assert.equal(calls.count, 2)
})

test('lighting up anywhere reaches every entry, and a slow stale read cannot turn it back off', async () => {
  const { store } = loadStore(async () => idleCheckin())
  const states = []
  const unsubscribe = store.subscribeStreak((state) => states.push(state.summary.lit))
  await store.refreshStreak()
  assert.equal(store.getStreakState().summary.lit, false)

  // 打卡页读到今天已点亮 → 顶栏与「我的」卡片立即点亮。
  store.publishCheckin(litCheckin())
  assert.equal(store.getStreakState().summary.lit, true)
  // 更早发出、更晚返回的请求还是未点亮：同一天里不回退。
  store.publishCheckin(idleCheckin())
  assert.equal(store.getStreakState().summary.lit, true)
  assert.deepEqual(states, [false, true])

  unsubscribe()
  store.publishCheckin(litCheckin())
  assert.deepEqual(states, [false, true])
})

test('another account or a new day never shows the old flame', async () => {
  const { store, storage } = loadStore(async () => litCheckin())
  await store.refreshStreak()
  assert.equal(store.getStreakState().status, 'ready')

  storage.zion_runtime_token = 'token-b'
  assert.equal(store.getStreakState().status, 'loading')
  storage.zion_runtime_token = 'token-a'
  assert.equal(store.getStreakState().status, 'ready')

  const realNow = Date.now
  Date.now = () => realNow() + 24 * 60 * 60 * 1000
  try {
    assert.equal(store.getStreakState().status, 'loading')
  } finally {
    Date.now = realNow
  }
})

test('a failed first read reports failure; a failed refresh keeps what was already shown', async () => {
  let fail = true
  const { store } = loadStore(async () => {
    if (fail) throw new Error('学习打卡暂时无法读取，请稍后重试。')
    return idleCheckin()
  })
  const state = await store.refreshStreak()
  assert.equal(state.status, 'failed')
  await assert.rejects(store.loadCheckin(), /暂时无法读取/)

  fail = false
  assert.equal((await store.refreshStreak()).status, 'ready')
  fail = true
  const after = await store.refreshStreak({ maxAge: 0 })
  assert.equal(after.status, 'ready')
  assert.equal(after.summary.streakDays, 2)
})

test('the four tab top bars show the streak entry next to the capsule instead of messages', () => {
  for (const tab of ['home', 'learning', 'knowledge-universe', 'knowledge-map']) {
    const wxml = read(`pages/${tab}/index.wxml`)
    const js = read(`pages/${tab}/index.js`)
    assert.match(wxml, /<streak-entry top="\{\{streakEntryTop\}\}" right="\{\{streakEntryRight\}\}" size="\{\{menuButtonHeight\}\}" \/>/, tab)
    assert.doesNotMatch(wxml, /topbar\/message\.png|showNotifications/, tab)
    assert.equal(JSON.parse(read(`pages/${tab}/index.json`)).usingComponents['streak-entry'], '/components/streak-entry/index', tab)
    // 与胶囊顶对齐、紧贴胶囊左侧 8px。
    assert.match(js, /streakEntryTop: menuButton\.top/, tab)
    assert.match(js, /streakEntryRight: (?:this\._)?windowWidth - menuButton\.left \+ 8/, tab)
  }

  const entry = read('components/streak-entry/index.wxml')
  assert.match(entry, /UA\.src\(ui, streak && streak\.lit \? '\/learning\/assets\/check-in\/streak\.svg' : '\/learning\/assets\/check-in\/streak-gray\.svg'\)/)
  assert.match(entry, /wx:if="\{\{streakStatus === 'loading'\}\}" class="sk /)
  assert.match(entry, /bindtap="openCheckIn"/)
  assert.match(read('utils/streak-behavior.js'), /wx\.navigateTo\(\{ url: '\/learning\/check-in\/index' \}\)/)
})

test('the knowledge map keeps its top bar buttons on the capsule after a window resize', () => {
  const js = read('pages/knowledge-map/index.js')
  const onResize = js.slice(js.indexOf('  onResize('), js.indexOf('\n  },', js.indexOf('  onResize(')))
  assert.ok(onResize.length > 0)
  // 转屏那一刻胶囊位置可能还是旧的：onResize 只重排画布与底部面板，不重读胶囊、不动顶栏按钮。
  assert.doesNotMatch(onResize, /getMenuButtonBoundingClientRect|applyTopbarLayout|streakEntry|galaxyRight/)
  const windowLayout = js.slice(js.indexOf('  applyWindowLayout('), js.indexOf('\n  },', js.indexOf('  applyWindowLayout(')))
  assert.doesNotMatch(windowLayout, /getMenuButtonBoundingClientRect|streakEntry|galaxyRight/)
})

test('"我的" shows the learning streak card right above 常用入口', () => {
  const wxml = read('pages/me/index.wxml')
  assert.ok(wxml.indexOf('<streak-card />') > wxml.indexOf('wallet-grid'))
  assert.ok(wxml.indexOf('<streak-card />') < wxml.indexOf('常用入口'))
  assert.equal(JSON.parse(read('pages/me/index.json')).usingComponents['streak-card'], '/components/streak-card/index')
  const card = read('components/streak-card/index.wxml')
  assert.match(card, />我的学习连胜</)
  assert.match(card, /streak-card-number-skeleton/)
  assert.doesNotMatch(card, /正在读取|加载中/)
})

test('a read that never returns does not block later refreshes forever', async () => {
  const { store, calls } = loadStore((count) => count === 1 ? new Promise(() => {}) : Promise.resolve(idleCheckin()))
  store.refreshStreak()
  store.refreshStreak()
  assert.equal(calls.count, 1)
  const realNow = Date.now
  Date.now = () => realNow() + 16 * 1000
  try {
    const state = await store.refreshStreak()
    assert.equal(calls.count, 2)
    assert.equal(state.status, 'ready')
  } finally {
    Date.now = realNow
  }
})
