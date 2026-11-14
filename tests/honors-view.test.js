const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// 我的荣誉第二版（2026-11-13）：统一的奖杯（3 座各 4 级）和勋章，不跟课程内容走；页面模型、「新获得」、学习页庆祝
const storage = new Map()
global.wx = { getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) }
const { ART, CUP_KEYS, MEDAL_KEYS, normalizeHonors, honorKeys, freshHonors, markSeen, readSeen, honorsView, findHonor } = require('../utils/honors-view')
const { drawHonor, tiltFromMotion, idleTilt } = require('../utils/honor-shine')

const RAW = {
  version: 2,
  summary: { earned: 4, total: 6, cups: 2, medals: 2 },
  cups: [
    { kind: 'cup', key: 'quest', title: '闯关杯', desc: '闯过的课', unit: '节', levels: [1, 5, 20, 50], level: 2, value: 6, earnedAt: '2026-11-13T02:00:00.000Z' },
    { kind: 'cup', key: 'diligent', title: '勤学杯', desc: '累计学习的天数', unit: '天', levels: [5, 20, 60, 150], level: 0, value: 3 },
    { kind: 'cup', key: 'streak', title: '恒心杯', desc: '最长连续学习', unit: '天', levels: [3, 7, 30, 100], level: 4, value: 120 }
  ],
  medals: [
    { kind: 'medal', key: 'onboard', group: 'start', title: '启程', desc: '完成入门三关', unit: '', levels: [1], level: 1, value: 1 },
    { kind: 'medal', key: 'run', group: 'skill', title: '连对高手', desc: '一口气答对', unit: '题', levels: [10, 20, 40], level: 2, value: 23 },
    { kind: 'medal', key: 'review', group: 'collect', title: '温故知新', desc: '完成间隔复习', unit: '次', levels: [5, 20, 60], level: 0, value: 0, unknown: true },
    { kind: 'medal', key: 'bogus', group: 'start', title: '?', levels: [1], level: 1 }
  ]
}

test('only the second version is accepted; unknown keys are dropped', () => {
  assert.equal(normalizeHonors({ summary: {}, trophies: [], badges: [], medals: [] }), null)
  const honors = normalizeHonors(RAW)
  assert.equal(honors.medals.length, 3)
  assert.deepEqual(honors.summary, { earned: 4, total: 6, cups: 2, medals: 2 })
})

test('view: cups by level art and label, medals grouped with Lv names and progress to the next level', () => {
  const honors = normalizeHonors(RAW)
  const view = honorsView(honors, honorKeys(honors))
  const [quest, diligent, streak] = view.cups
  assert.equal(quest.art, ART['cup-quest-2'])
  assert.equal(quest.levelLabel, '银杯')
  assert.equal(quest.progress, '6/20 节')
  assert.equal(quest.detail.nextStep, '现在 6 节，到 20 节 升到金杯')
  assert.deepEqual(quest.detail.ladder.map((step) => [step.label, step.target, step.reached, step.current]), [
    ['铜杯', '1 节', true, false], ['银杯', '5 节', true, true], ['金杯', '20 节', false, false], ['钻石杯', '50 节', false, false]
  ])
  assert.equal(quest.detail.ladder[3].art, ART['cup-quest-4'])
  assert.equal(quest.detail.date, '2026/11/13')
  // 没拿到：用第一级的图（页面压灰），给到第一级的进度
  assert.equal(diligent.earned, false)
  assert.equal(diligent.art, ART['cup-diligent-1'])
  assert.equal(diligent.progress, '3/5 天')
  assert.equal(diligent.detail.pill, '未获得')
  // 满级：没有进度条
  assert.equal(streak.art, ART['cup-streak-4'])
  assert.equal(streak.progress, '')
  assert.equal(streak.detail.nextStep, '已经满级')
  assert.equal(view.cupsEarned, 2)

  assert.deepEqual(view.groups.map((group) => [group.label, group.earned, group.total]), [['起步', 1, 1], ['实力', 1, 1], ['积累', 0, 1]])
  const run = findHonor(view, 'medal-run')
  assert.equal(run.name, '连对高手 Lv.2')
  assert.equal(run.progress, '23/40 题')
  assert.equal(findHonor(view, 'medal-onboard').name, '启程')
  assert.equal(findHonor(view, 'medal-onboard').detail.ladder.length, 0)
  // 进度读不到：不画进度条，说明读不到
  const review = findHonor(view, 'medal-review')
  assert.equal(review.progress, '')
  assert.match(review.detail.nextStep, /读不到/)
  assert.equal(findHonor(view, 'nope'), null)
})

test('nothing in the view carries course names: titles come from the fixed catalogue', () => {
  const view = honorsView(normalizeHonors(RAW), [])
  assert.deepEqual(view.cups.map((cup) => cup.title), ['闯关杯', '勤学杯', '恒心杯'])
})

test('fresh honors: first sight seeds silently, later only the newly reached level celebrates', () => {
  storage.clear()
  const honors = normalizeHonors(RAW)
  assert.equal(readSeen(), null)
  assert.deepEqual(freshHonors(honors, readSeen()), [])
  markSeen(honors)
  assert.deepEqual(freshHonors(honors, readSeen()), [])
  const upgraded = normalizeHonors({ ...RAW, cups: RAW.cups.map((cup) => (cup.key === 'quest' ? { ...cup, level: 3 } : cup.key === 'diligent' ? { ...cup, level: 1 } : cup)) })
  const fresh = freshHonors(upgraded, readSeen())
  assert.deepEqual(fresh.map((item) => [item.key, item.title, item.subtitle, item.art]), [
    ['cup:quest:3', '闯关杯 · 金杯', '奖杯升级', ART['cup-quest-3']],
    ['cup:diligent:1', '勤学杯 · 铜杯', '赢得新奖杯', ART['cup-diligent-1']]
  ])
  assert.equal(honorsView(upgraded, readSeen()).cups[0].isNew, true)
  markSeen(upgraded, fresh.map((item) => item.key))
  assert.deepEqual(freshHonors(upgraded, readSeen()), [])
})

test('every honor has art, and every art path is used by the page through UA.src', () => {
  for (const key of CUP_KEYS) for (const level of [1, 2, 3, 4]) assert.ok(ART[`cup-${key}-${level}`], `cup-${key}-${level}`)
  for (const key of MEDAL_KEYS) assert.ok(ART[`medal-${key}`], `medal-${key}`)
  for (const value of Object.values(ART)) assert.match(value, /^\/assets\/honors\/v2\/[a-z0-9-]+\.png$/)
  const wxml = fs.readFileSync(path.join(__dirname, '../learning/honors/index.wxml'), 'utf8')
  assert.match(wxml, /UA\.src\(ui, item\.art\)/)
  assert.match(wxml, /<honor-shine/)
})

test('shine: tilt follows the phone relative to how it was held, and drawing masks the highlight to the art', () => {
  assert.deepEqual(tiltFromMotion({ gamma: 14, beta: 40 }, { gamma: 0, beta: 40 }), { x: 0.5, y: 0 })
  assert.equal(tiltFromMotion({ gamma: 90, beta: 0 }, { gamma: 0, beta: 0 }).x, 1)
  assert.ok(Math.abs(idleTilt(500).x) <= 1)
  const calls = []
  const gradient = { addColorStop() {} }
  const ctx = new Proxy({ canvas: { width: 600, height: 600 } }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient
      return (...args) => { calls.push([prop, ...args]) }
    },
    set(target, prop, value) { calls.push(['set', prop, value]); target[prop] = value; return true }
  })
  drawHonor(ctx, {}, 300, { tiltX: 0.4, tiltY: -0.2, flip: 1 })
  assert.ok(calls.some((call) => call[0] === 'drawImage'))
  const ops = calls.filter((call) => call[0] === 'set' && call[1] === 'globalCompositeOperation').map((call) => call[2])
  assert.deepEqual(ops, ['source-atop', 'source-over'])
})
