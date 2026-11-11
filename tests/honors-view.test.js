const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// 我的荣誉（2026-11-11 晚）：页面模型、「新获得」、学习页庆祝
const storage = new Map()
global.wx = { getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) }
const { ART, normalizeHonors, honorKeys, freshHonors, markSeen, readSeen, honorsView, findHonor } = require('../utils/honors-view')

const RAW = {
  summary: { trophies: 2, gold: 1, badges: 1, medals: 2, medalTotal: 13 },
  trophies: [
    { stageId: 'stage-a', title: '函数图像', tier: 'gold', hint: '', earnedAt: '2026-11-11T02:00:00.000Z' },
    { stageId: 'stage-b', title: '一次函数', tier: 'silver', hint: '练习一次全对就是金杯', earnedAt: '2026-11-11T03:00:00.000Z' },
    { stageId: 'stage-c', title: '反比例', tier: null, hint: '', earnedAt: null }
  ],
  badges: [{ id: 's1', number: 1, title: '函数', earned: true, done: 2, total: 2, earnedAt: '2026-11-11T03:00:00.000Z' }, { id: 's2', number: 2, title: '几何', earned: false, done: 1, total: 3 }],
  medals: [
    { key: 'onboard', group: 'start', title: '启程', desc: '完成入门三关', earned: true, value: 1, target: 1, unit: '' },
    { key: 'streak-7', group: 'persist', title: '七日之约', desc: '连续学习 7 天', earned: true, value: 7, target: 7, unit: '天' },
    { key: 'streak-30', group: 'persist', title: '月度坚持', desc: '连续学习 30 天', earned: false, value: 12, target: 30, unit: '天' },
    { key: 'bogus', group: 'start', title: '?', earned: true }
  ]
}

test('normalizes and builds shelves, badges, grouped medals with art and progress', () => {
  const honors = normalizeHonors(RAW)
  assert.equal(honors.medals.length, 3)
  const view = honorsView(honors, honorKeys(honors))
  assert.equal(view.summary.total, 5)
  assert.equal(view.shelves.length, 1)
  assert.deepEqual(view.shelves[0].items.map((item) => item.tierLabel), ['金杯', '银杯', '待闯'])
  assert.equal(view.shelves[0].items[2].art, ART['trophy-empty'])
  assert.equal(view.badges[1].art, ART['stage-locked'])
  assert.equal(view.badges[1].progress, '1/3 节')
  const persist = view.groups.find((group) => group.key === 'persist')
  assert.equal(persist.medals[1].progress, '12/30 天')
  assert.equal(persist.medals[1].art, ART['medal-streak-30-locked'])
  assert.equal(findHonor(view, 'trophy-0').detail.date, '2026.11.11')
  assert.ok(view.shelves[0].items.every((item) => !item.isNew))
})

test('fresh honors: none on first sight, then only what this phone has not seen, medals first', () => {
  storage.clear()
  const honors = normalizeHonors(RAW)
  assert.equal(readSeen(), null)
  assert.deepEqual(freshHonors(honors, readSeen()), [])
  markSeen(honors, ['trophy:stage-a:gold'])
  const fresh = freshHonors(honors, readSeen())
  assert.equal(fresh[0].kind, 'medal')
  assert.deepEqual(fresh.map((item) => item.key), ['medal:onboard', 'medal:streak-7', 'badge:s1', 'trophy:stage-b:silver'])
  markSeen(honors)
  assert.deepEqual(freshHonors(honors, readSeen()), [])
})

test('every honor art path is a full /assets/honors/ path (verify-ui-assets scans them)', () => {
  for (const value of Object.values(ART)) assert.match(value, /^\/assets\/honors\/[a-z0-9-]+\.svg$/)
  const source = fs.readFileSync(path.join(__dirname, '../learning/honors/index.wxml'), 'utf8')
  assert.match(source, /UA\.src\(ui, item\.art\)/)
})
