const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// 学习天梯榜（2026-11-17）：页面模型、倒计时、段位表与课程服务一致、入口与页面注册
const { LADDER_TIERS, durationText, hoursText, countdownText, normalizeLadder, ladderView } = require('../utils/ladder-view')

const tier = (key, label) => ({ key, label, next: null })
const RAW = {
  day: '2026-11-17',
  settleAt: '2026-11-17T16:00:00.000Z',
  now: '2026-11-17T15:00:00.000Z',
  reward: { top: 3, coins: 100 },
  stats: { learners: 5, passes: 20, minutes: 778 },
  rows: [
    { rank: 1, name: '李*', grade: '初一', avatarUrl: 'https://x/a.png', passes: 10, minutes: 90, tier: tier('platinum', '铂金'), podium: true, me: false },
    { rank: 2, name: '张小明', grade: '初一', avatarUrl: null, passes: 6, minutes: 61, tier: tier('gold', '黄金'), podium: true, me: true },
    { rank: 4, name: '王*芳', grade: '五年级', avatarUrl: 'http://insecure', passes: 2, minutes: 30, tier: tier('bronze', '青铜'), podium: false, me: false },
    { rank: 5, name: '赵*', grade: '', avatarUrl: null, passes: 0, minutes: 5, tier: tier('nope', '?'), podium: false, me: false }
  ],
  me: { rank: 2, name: '张小明', passes: 6, minutes: 61, tier: tier('gold', '黄金'), toPodium: 0 },
  yesterday: {
    day: '2026-11-16', settling: false, learners: 9,
    podium: [{ rank: 1, name: '张小明', grade: '初一', avatarUrl: null, passes: 9, minutes: 88, coins: 100, me: true }],
    myAward: { rank: 1, coins: 100, status: 'granted' }
  }
}

test('时长写法与倒计时', () => {
  assert.equal(durationText(45), '45 分钟')
  assert.equal(durationText(60), '1 小时')
  assert.equal(durationText(135), '2 小时 15 分')
  assert.equal(hoursText(778), '13 小时')
  assert.equal(hoursText(30), '30 分钟')
  const now = Date.parse('2026-11-17T15:00:00.000Z')
  assert.equal(countdownText('2026-11-17T16:00:00.000Z', now, 0), '01:00:00')
  assert.equal(countdownText('2026-11-17T16:00:00.000Z', now, 59_500), '00:59:00')
  assert.equal(countdownText('2026-11-17T16:00:00.000Z', now + 7200_000, 0), '00:00:00')
  assert.equal(countdownText('', now, 0), '--:--:--')
})

test('回包不像样按读取失败处理', () => {
  assert.equal(normalizeLadder(null), null)
  assert.equal(normalizeLadder({ rows: [] }), null)
  assert.ok(normalizeLadder(RAW))
})

test('页面模型：领奖台按 2、1、3 摆，空位虚位以待；第四名起进列表；只认 https 头像', () => {
  const view = ladderView(RAW)
  assert.deepEqual(view.seats.map((seat) => [seat.rank, seat.empty]), [[2, false], [1, false], [3, true]])
  assert.equal(view.seats[1].row.avatar, 'https://x/a.png')
  assert.equal(view.seats[0].row.me, true)
  assert.deepEqual(view.rest.map((row) => row.rank), [4, 5])
  assert.equal(view.rest[0].avatar, '')
  assert.equal(view.rest[0].initial, '王')
  assert.equal(view.rest[0].percent, 20)
  assert.equal(view.rest[1].percent, 4, '没闯关的也留一点进度条')
  assert.deepEqual(view.rest[1].tier, { key: 'rookie', label: '?' }, '认不出的段位按见习画')
  assert.deepEqual(view.stats, { learners: 5, hours: '13 小时', passes: 20 })
  assert.equal(view.me.rankText, '第 2 名')
  assert.equal(view.me.top, true)
  assert.equal(view.me.tip, '你在前三！守住到 24 点就有金币')
  assert.deepEqual(view.rungs.map((rung) => rung.key), ['king', 'platinum', 'gold', 'silver', 'bronze', 'rookie'])
  assert.equal(view.rungs.find((rung) => rung.here).key, 'gold')
  assert.equal(view.award, '昨天你拿了第 1 名，100 金币已到账！')
  assert.equal(view.yesterday.podium[0].score, '9 关 · 1 小时 28 分')
})

test('我的名次提示', () => {
  const base = { ...RAW, me: { rank: null, passes: 0, minutes: 0, tier: tier('rookie', '见习'), toPodium: 1 } }
  assert.equal(ladderView(base).me.rankText, '未上榜')
  assert.equal(ladderView(base).me.tip, '再闯 1 关就能冲进前三')
  assert.equal(ladderView({ ...base, me: { ...base.me, toPodium: 0 } }).me.tip, '前三还有空位，闯过 1 关就能冲上去')
  assert.equal(ladderView({ ...base, yesterday: { ...RAW.yesterday, myAward: { rank: 3, coins: 100, status: 'pending' } } }).award, '昨天你拿了第 3 名，100 金币正在发放。')
})

test('段位表与课程服务 lib/course/ladder-rules.ts 一致', () => {
  const rules = path.join(__dirname, '../../tmp/course-ladder/lib/course/ladder-rules.ts')
  if (!fs.existsSync(rules)) return // 课程服务不在旁边时跳过
  const source = fs.readFileSync(rules, 'utf8')
  for (const t of LADDER_TIERS) assert.match(source, new RegExp(`key: '${t.key}', label: '${t.label}', min: ${t.min} `))
})

test('页面已注册、学习页有入口', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  const learning = app.subpackages.find((pkg) => pkg.root === 'learning')
  assert.ok(learning.pages.includes('ladder/index'))
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/learning/index.wxml'), 'utf8')
  assert.match(wxml, /bindtap="openLadder"/)
  const js = fs.readFileSync(path.join(__dirname, '../pages/learning/index.js'), 'utf8')
  assert.match(js, /\/learning\/ladder\/index/)
})
