const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { deepAssessmentView, rewardView } = require('../utils/deep-assessment-view')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const subject = (key, name, mode, extra = {}) => ({ key, name, readyCount: mode === 'unavailable' ? 0 : 1, scopes: [{ entry: { mode, ...extra } }] })
const center = (reward) => ({
  subjects: [
    subject('chi', '语文', 'report'),
    subject('math', '数学', 'continue'),
    subject('eng', '英语', 'start'),
    subject('sci', '科学', 'unavailable'),
    // 最新一张卷在重测，但以前做完过：算测过
    subject('pol', '道德与法治', 'resume', { history: [{ attemptId: 9, number: 1 }] })
  ],
  reward
})
const REWARD = { coinsPerTest: 2000, limit: 5, used: 1, left: 4, totalCoins: 10000, earnedCoins: 2000, inProgress: 2, member: false, freeLeft: 2 }

test('学科分成已测评 / 测评中 / 未测评 / 准备中；准备中的不计入进度', () => {
  const view = deepAssessmentView(center(null))
  assert.deepEqual(view.subjects.map((s) => s.state), ['done', 'doing', 'todo', 'unready', 'done'])
  assert.equal(view.progressText, '已测 2 / 4 科')
  assert.equal(view.reward, null)
  assert.ok(view.subjects.every((s) => s.coinLabel === '' && !s.locked))
})

test('有奖励时：没做完的学科标出做完得多少金币；免费版说清一共几次、共多少钱、怎样才能提现', () => {
  const view = deepAssessmentView(center(REWARD))
  assert.deepEqual(view.subjects.map((s) => s.coinText), ['再测一次可得 2000 金币', '完成可得 2000 金币', '完成可得 2000 金币', '', '再测一次可得 2000 金币'])
  // 拿过奖励的学科写已获得，不再预告
  const rewarded = deepAssessmentView({ subjects: [{ key: 'chi', name: '语文', readyCount: 1, scopes: [{ scopeId: '8', entry: { mode: 'report' } }] }], reward: { ...REWARD, rewardedScopeIds: [8] } })
  assert.equal(rewarded.subjects[0].coinText, '已获得 2000 金币')
  assert.equal(rewarded.subjects[0].coinTone, 'earned')
  // 一共可获得 / 已获得 / 未获得，和结算规则
  assert.deepEqual([view.reward.totalCoins, view.reward.earnedCoins, view.reward.remainingCoins], [10000, 2000, 8000])
  assert.deepEqual([view.reward.totalYuan, view.reward.earnedYuan, view.reward.remainingYuan], ['100', '20', '80'])
  assert.equal(view.reward.rules.length, 4)
  assert.match(view.reward.rules[1], /每个学科只奖励一次/)
  assert.match(view.reward.rules[3], /家长绑定你、并开通会员后才能提现/)
  assert.equal(view.reward.headline, '每做完一科得 2000 金币')
  assert.equal(view.reward.totalText, '5 次共 10000 金币（可兑 100 元）')
  assert.equal(view.reward.free, true)
  assert.match(view.reward.freeNotice, /一共 5 次/)
  assert.match(view.reward.freeNotice, /还可以再开 2 科/)
  assert.match(view.reward.freeNotice, /家长绑定你、并开通会员后才能提现/)
})

test('免费版次数用完：没开始的学科锁住，做了一半的照常；会员不提示、不锁', () => {
  const used = deepAssessmentView(center({ ...REWARD, freeLeft: 0 }))
  assert.deepEqual(used.subjects.map((s) => s.locked), [false, false, true, false, false])
  assert.match(used.reward.freeNotice, /次数已经用完/)
  const member = deepAssessmentView(center({ ...REWARD, member: true, freeLeft: null }))
  assert.equal(member.reward.free, false)
  assert.equal(member.reward.freeNotice, '')
  assert.ok(member.subjects.every((s) => !s.locked))
  // 读不到会员状态（null）按不拦处理
  assert.equal(rewardView({ ...REWARD, member: null }).free, false)
  // 奖励领完：不再标金币
  const done = deepAssessmentView(center({ ...REWARD, used: 5, left: 0, member: true }))
  assert.ok(done.subjects.every((s) => s.coinText === ''))
  assert.equal(done.reward.headline, '5 次测评奖励已全部领完')
})

test('宇宙页有深度测评入口，测评中心读得到奖励，金币页提示会员才能提现', () => {
  const wxml = read('pages/knowledge-universe/index.wxml')
  assert.match(wxml, /universe-deep-card[^>]*bindtap="openDeepAssessment"/)
  assert.match(read('pages/knowledge-universe/index.js'), /url: '\/assessment\/center\/index'/)
  assert.match(read('services/identity.js'), /reward: data\.reward \|\| null/)
  assert.match(read('services/identity.js'), /free_limit_reached/)
  assert.match(read('assessment/center/index.js'), /remindFreeLimit/)
  assert.match(read('growth/coins/index.js'), /exchange\.memberRequired/)
  assert.match(read('services/coin-exchange.js'), /MEMBER_REQUIRED/)
})

// 点学科直接进测评（2026-11-14）：不再经过「学科摸底诊断」范围列表。
function loadCenter(centerData, startResult) {
  const vm = require('node:vm')
  let definition
  const calls = { nav: [], start: [], modal: [] }
  vm.runInNewContext(read('assessment/center/index.js'), {
    Page: (p) => { definition = p },
    encodeURIComponent,
    getCurrentPages: () => [1, 2],
    require: (name) => name.endsWith('/identity')
      ? { loadAssessmentCenter: async () => centerData, requestK12Assessment: async (payload) => { calls.start.push(payload); if (startResult instanceof Error) throw startResult; return startResult } }
      : name.endsWith('/ui-assets') ? { attachUiAssets() {} }
        : name.endsWith('/deep-assessment-view') ? require('../utils/deep-assessment-view') : require('../utils/screen'),
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {},
      navigateTo: (o) => calls.nav.push(o.url),
      showModal: (o) => { calls.modal.push(o); if (o.success && o.showCancel !== false) o.success({ confirm: true }) },
      showActionSheet: (o) => o.success({ tapIndex: 0 })
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  return { page, calls }
}
const tap = (page, key) => page.handleAction({ currentTarget: { dataset: { type: 'subject', subjectKey: key } } })
const scoped = (key, name, entry) => ({ key, name, readyCount: 1, scopes: [{ scopeId: '146', name: name + '上册', ready: true, entry }] })

test('没测过的学科：先说做完预计奖励多少金币，确认后开卷直接进题目', async () => {
  const { page, calls } = loadCenter({ subjects: [scoped('math', '数学', { mode: 'start' })], attempts: [], reward: { ...REWARD, member: true, freeLeft: null } }, { attempt: { id: 77, status: 'draft' } })
  await page.loadPage()
  tap(page, 'math')
  await new Promise((r) => setTimeout(r, 0))
  assert.match(calls.modal[0].content, /预计奖励 2000 金币（100 金币 = 1 元，约 20 元）/)
  assert.equal(calls.start[0].operation, 'start')
  assert.equal(calls.start[0].scopeId, '146')
  assert.deepEqual(calls.nav, ['/assessment/short/index?attemptId=77'])
})

test('做了一半的接着做，做完的看报告，免费版次数用完的开不了', async () => {
  const resume = loadCenter({ subjects: [scoped('math', '数学', { mode: 'resume', attemptId: 21 })], attempts: [], reward: null })
  await resume.page.loadPage(); tap(resume.page, 'math')
  assert.deepEqual(resume.calls.nav, ['/assessment/short/index?attemptId=21'])

  const done = loadCenter({ subjects: [scoped('math', '数学', { mode: 'report', attemptId: 31 })], attempts: [], reward: null })
  await done.page.loadPage(); tap(done.page, 'math')
  assert.deepEqual(done.calls.nav, ['/assessment/report/index?attemptId=31'])

  const locked = loadCenter({ subjects: [scoped('math', '数学', { mode: 'start' })], attempts: [], reward: { ...REWARD, freeLeft: 0 } })
  await locked.page.loadPage(); tap(locked.page, 'math')
  assert.equal(locked.calls.start.length, 0)
  assert.equal(locked.calls.modal.at(-1).title, '免费次数已用完')
})

test('测评中心顶部标出剩余次数和金币换算；学科卡片写预计奖励', () => {
  const reward = deepAssessmentView(center(REWARD)).reward
  assert.equal(reward.leftText, '免费版还剩 2 次')
  assert.equal(reward.rateText, '100 金币 = 1 元')
  assert.equal(reward.perTestText, '做完一科 2000 金币 ≈ 20 元')
  assert.equal(rewardView({ ...REWARD, member: true, freeLeft: null }).leftText, '有奖测评还剩 4 次')
  const wxml = read('assessment/center/index.wxml')
  assert.match(wxml, /reward\.leftText/)
  assert.match(wxml, /reward\.rateText/)
  for (const label of ['一共可获得', '已获得', '未获得', '金币结算规则']) assert.ok(wxml.includes(label), label)
  assert.match(wxml, /class="module is-\{\{item\.state\}\}/)
  assert.match(wxml, /item\.coinText/)
  // 没测的学科整块是灰的
  assert.match(read('assessment/center/index.wxss'), /\.module\.is-todo, \.module\.is-unready \{ background: #F7F7F5; \}/)
  // 开发版预览只认 develop
  assert.match(read('utils/deep-assessment-view.js'), /envVersion === 'develop'/)
  // 奖励横幅在统计和学科列表前面
  assert.ok(wxml.indexOf('coin-card') < wxml.indexOf('stats-section'))
})
