// 再测对比（2026-10-06，更新日志 1.0.3「可以多次答题，每次对比」）：卷级前后对比。
// 历次成绩来自测评动作流 catalog 回包里每个范围的 entry.history（scripts/assessment/diagnostic-service.js 的 paperHistory：
// 只列做完整张卷的，attemptId / number / completedAt / totalScore / band），知识点变化读上一次的报告（read）。
// 报告页做完过两次以上才显示「和上次比」「历次成绩」；测评列表、测评中心的记录标「比上次 +X 分」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const ROOT = path.join(__dirname, '..')

function loadService() {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'services/assessment.js'), 'utf8'), { module, exports: module.exports, require: (name) => name === '../utils/question-timing' ? require('../utils/question-timing') : ({ requestK12Assessment: async () => ({}) }) })
  return module.exports
}
const service = loadService()
const plain = (value) => JSON.parse(JSON.stringify(value)) // vm 里建的数组跨 realm，先转成本地值再比

// 回包顺序故意打乱：页面自己按第几次从新到旧排
const HISTORY = [
  { attemptId: 31, number: 1, completedAt: '2026-09-20T12:00:00.000Z', totalScore: 48.5, band: '需系统重建' },
  { attemptId: 77, number: 3, completedAt: '2026-10-05T12:00:00.000Z', totalScore: 72.3, band: '基本掌握' },
  { attemptId: 52, number: 2, completedAt: '2026-09-28T12:00:00.000Z', totalScore: 64.5, band: '薄弱' }
]
const topic = (topicId, name, state, tier = 'A') => ({ topicId, name, state, tier, n: 4, answered: state === 'pending' ? 2 : 4, c: state === 'mastered' ? 4 : state === 'reinforce' ? 2 : 0 })
const CURRENT_REPORT = {
  attemptId: 77, scope: { id: 146, subject: 'math', name: '7年级数学 · 上学期 · 摸底诊断' }, totalScore: 72.3, band: '基本掌握',
  round: 3, roundCount: 3, completedRounds: 3, isFinal: true, nextRound: null,
  masteredCount: 3, reinforceCount: 1, notMasteredCount: 1, pendingCount: 1,
  topics: [
    topic(1, '正数和负数', 'mastered'), topic(2, '数轴', 'mastered', 'B'), topic(3, '有理数的乘法', 'reinforce'),
    topic(4, '有理数的加法', 'not_mastered'), topic(5, '代数式', 'mastered'), topic(6, '合并同类项', 'pending')
  ],
  review: []
}
const PREVIOUS_REPORT = {
  attemptId: 52, totalScore: 64.5, band: '薄弱',
  topics: [
    topic(1, '正数和负数', 'mastered'), topic(2, '数轴', 'not_mastered', 'B'), topic(3, '有理数的乘法', 'not_mastered'),
    topic(4, '有理数的加法', 'reinforce'), topic(5, '代数式', 'pending'), topic(6, '合并同类项', 'mastered')
  ]
}

// ── 视图模型 ──

test('history is listed newest first with date, score and band, whatever order the flow returns', () => {
  const list = plain(service.paperHistoryView(HISTORY))
  assert.deepEqual(list.map((item) => item.number), [3, 2, 1])
  assert.deepEqual(list.map((item) => [item.attemptId, item.dateLabel, item.scoreLabel, item.bandLabel, item.bandTone]), [
    ['77', '2026.10.05', '72.3 分', '基本掌握', 'steady'],
    ['52', '2026.09.28', '64.5 分', '薄弱', 'weak'],
    ['31', '2026.09.20', '48.5 分', '需系统重建', 'rebuild']
  ])
  // 没有分数的一次显示「待测」，残缺的记录不进列表
  const odd = plain(service.paperHistoryView([{ attemptId: 9, number: 1, totalScore: null, band: null }, { attemptId: null, number: 2 }, null]))
  assert.deepEqual(odd.map((item) => [item.scoreLabel, item.bandLabel, item.dateLabel]), [['待测', '待测', '']])
})

test('two or more finished papers compare against the one before: score delta, band change and knowledge points', () => {
  const view = plain(service.retakeCompareView(HISTORY, 77, CURRENT_REPORT, PREVIOUS_REPORT))
  assert.equal(view.previousAttemptId, '52')
  assert.deepEqual(view.history.map((item) => [item.number, item.isCurrent]), [[3, true], [2, false], [1, false]])
  const change = view.change
  assert.equal(change.previousNumber, 2)
  assert.equal(change.previousScoreText, '64.5')
  assert.equal(change.currentScoreText, '72.3')
  // 72.3 - 64.5 浮点差是 7.799…，按一位小数显示
  assert.equal(change.scoreDeltaLabel, '↑ 7.8 分')
  assert.equal(change.scoreTone, 'up')
  assert.equal(change.bandChanged, true)
  assert.equal(change.bandDirection, 'up')
  assert.deepEqual([change.previousBand, change.currentBand], ['薄弱', '基本掌握'])
  // 只比两次都判定过的知识点（代数式、合并同类项有一次是待测，不算）；进步在前，核心在重要前
  assert.deepEqual(change.topics.items.map((item) => [item.name, `${item.fromLabel} → ${item.toLabel}`, item.tone]), [
    ['有理数的乘法', '未掌握 → 待巩固', 'up'],
    ['数轴', '未掌握 → 掌握', 'up'],
    ['有理数的加法', '待巩固 → 未掌握', 'down']
  ])
  assert.equal(change.topics.summary, '进步 2 个 · 退步 1 个 · 不变 1 个')
  assert.equal(change.topics.more, 0)
})

test('a lower score shows a down arrow with the absolute difference; an equal score is flat', () => {
  const history = [{ attemptId: 1, number: 1, totalScore: 80, band: '基本掌握' }, { attemptId: 2, number: 2, totalScore: 66.5, band: '薄弱' }]
  const down = plain(service.retakeCompareView(history, 2, { totalScore: 66.5 }, null)).change
  assert.equal(down.scoreDeltaLabel, '↓ 13.5 分')
  assert.equal(down.scoreTone, 'down')
  assert.equal(down.bandDirection, 'down')
  // 上一次的报告读不到：只比分数与档位
  assert.equal(down.topics, null)

  const same = [{ attemptId: 1, number: 1, totalScore: 70, band: '基本掌握' }, { attemptId: 2, number: 2, totalScore: 70, band: '基本掌握' }]
  const flat = plain(service.retakeCompareView(same, 2, {}, null)).change
  assert.equal(flat.scoreDeltaLabel, '持平')
  assert.equal(flat.scoreTone, 'flat')
  assert.equal(flat.bandChanged, false)
  assert.deepEqual(plain(service.historyChange(same, 2)), { deltaLabel: '与上次持平', deltaTone: 'flat' })
})

test('only one finished paper (or a report not in the history) shows no comparison', () => {
  assert.equal(service.retakeCompareView([HISTORY[0]], 31, CURRENT_REPORT, null), null)
  assert.equal(service.retakeCompareView([], 31, CURRENT_REPORT, null), null)
  assert.equal(service.retakeCompareView(undefined, 31, CURRENT_REPORT, null), null)
  assert.equal(service.retakeCompareView(HISTORY, 999, CURRENT_REPORT, null), null)
  assert.deepEqual(plain(service.historyChange([HISTORY[0]], 31)), { deltaLabel: '', deltaTone: '' })
  // 正在看第 1 次：有历次成绩，没有「上一次」可比
  const first = plain(service.retakeCompareView(HISTORY, 31, CURRENT_REPORT, null))
  assert.equal(first.change, null)
  assert.equal(first.previousAttemptId, '')
  assert.equal(first.history.length, 3)
})

test('list labels: records and the finished scope row say how much the score moved since last time', () => {
  assert.deepEqual(plain(service.historyChange(HISTORY, 77)), { deltaLabel: '比上次 +7.8 分', deltaTone: 'up' })
  assert.deepEqual(plain(service.historyChange(HISTORY, 52)), { deltaLabel: '比上次 +16 分', deltaTone: 'up' })
  assert.deepEqual(plain(service.historyChange(HISTORY, 31)), { deltaLabel: '', deltaTone: '' })
  const finished = service.entryView({ roundCount: 3, entry: { mode: 'report', attemptId: 77, completedRounds: 3, paperNumber: 3, canRetake: true, history: HISTORY } })
  assert.equal(finished.detail, '第 3 次 · 已完成全部 3 轮')
  assert.equal(finished.deltaLabel, '比上次 +7.8 分')
  // 最新一张卷还在做：入口不标对比
  const doing = service.entryView({ roundCount: 3, entry: { mode: 'resume', attemptId: 90, round: 1, completedRounds: 0, paperNumber: 4, history: HISTORY } })
  assert.equal(doing.deltaLabel, '')
})

// ── 报告页 ──

const pagePath = require.resolve('../assessment/report/index.js')
const assessmentPath = require.resolve('../services/assessment.js')
const identityPath = require.resolve('../services/identity.js')
function stub(file, exports) { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

function loadReportPage({ reports, history = HISTORY, catalogError = null, pages = [{ route: 'assessment/report/index' }] }) {
  delete require.cache[pagePath]
  const calls = { ops: [], navigate: [], redirect: [] }
  stub(assessmentPath, {
    ...service,
    call: async (op, payload) => {
      calls.ops.push([op, payload])
      if (op === 'read') {
        const value = reports[String(payload.attemptId)]
        if (value instanceof Error) throw value
        return value
      }
      if (op === 'catalog') {
        if (catalogError) throw catalogError
        return { scopes: [{ id: 145, entry: { history: [] } }, { id: 146, entry: { mode: 'report', history } }], attempts: [] }
      }
      throw new Error(`unexpected ${op}`)
    }
  })
  stub(identityPath, { loadCurrentUser: async () => ({ profile: { nickname: '小鹿' } }) })
  let definition = null
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pages
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20, pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 24, width: 87, height: 32 }),
    navigateTo: (options) => calls.navigate.push(options.url),
    redirectTo: (options) => calls.redirect.push(options.url),
    createSelectorQuery: () => ({ in() { return this }, select() { return this }, fields() { return this }, boundingClientRect() { return this }, exec() {} })
  }
  require(pagePath)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values, done) { Object.assign(this.data, values); if (done) done() } }
  return { page, calls }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const finalRead = (report, retake) => ({ attempt: { id: report.attemptId, status: 'submitted', report, retake } })

test('the report page loads the scope history after the report and compares with the previous paper', async () => {
  const { page, calls } = loadReportPage({
    reports: {
      77: finalRead(CURRENT_REPORT, { mode: 'retake', paperNumber: 3, paperCount: 3, isLatest: true }),
      52: finalRead(PREVIOUS_REPORT, { mode: 'retake', paperNumber: 2, paperCount: 3, isLatest: false })
    }
  })
  page.onLoad({ attemptId: '77' })
  await flush()
  assert.deepEqual(calls.ops, [['read', { attemptId: '77' }], ['catalog', { subject: 'math' }], ['read', { attemptId: '52' }]])
  assert.equal(page.data.model.period, '第 3 次 · 已完成全部 3 轮')
  const compare = page.data.compare
  assert.equal(compare.change.scoreDeltaLabel, '↑ 7.8 分')
  assert.equal(compare.change.topics.items.length, 3)
  assert.deepEqual(compare.history.map((item) => item.number), [3, 2, 1])

  // 点历次成绩里的另一次打开那次的报告；点本次不动
  page.openHistoryReport({ currentTarget: { dataset: { attemptId: '52' } } })
  page.openHistoryReport({ currentTarget: { dataset: { attemptId: '77' } } })
  assert.deepEqual(calls.navigate, ['/assessment/report/index?attemptId=52'])
})

test('the previous report failing to load still compares score and band', async () => {
  const { page } = loadReportPage({
    reports: { 77: finalRead(CURRENT_REPORT, { mode: 'retake', paperNumber: 3, paperCount: 3 }), 52: new Error('网络不太好') }
  })
  page.onLoad({ attemptId: '77' })
  await flush()
  assert.equal(page.data.compare.change.scoreDeltaLabel, '↑ 7.8 分')
  assert.equal(page.data.compare.change.topics, null)
})

test('a single paper, an unfinished retake or an unreadable catalog shows no comparison and no placeholder', async () => {
  // 只做过一次：不读目录
  const once = loadReportPage({ reports: { 77: finalRead(CURRENT_REPORT, { mode: 'retake', paperNumber: 1, paperCount: 1 }) } })
  once.page.onLoad({ attemptId: '77' })
  await flush()
  assert.deepEqual(once.calls.ops.map(([op]) => op), ['read'])
  assert.equal(once.page.data.compare, null)

  // 多轮卷的中间轮次（没有 retake）：不比
  const midway = loadReportPage({ reports: { 77: finalRead({ ...CURRENT_REPORT, isFinal: false, nextRound: 3 }, null) } })
  midway.page.onLoad({ attemptId: '77' })
  await flush()
  assert.equal(midway.page.data.compare, null)

  // 第二张卷还没做完：历次成绩只有一张，不显示
  const unfinished = loadReportPage({ reports: { 31: finalRead({ ...CURRENT_REPORT, attemptId: 31 }, { mode: 'resume', paperNumber: 1, paperCount: 2, attemptId: 90 }) }, history: [HISTORY[0]] })
  unfinished.page.onLoad({ attemptId: '31' })
  await flush()
  assert.deepEqual(unfinished.calls.ops.map(([op]) => op), ['read', 'catalog'])
  assert.equal(unfinished.page.data.compare, null)

  // 目录读不到：报告照常，不提示、不显示对比
  const offline = loadReportPage({ reports: { 77: finalRead(CURRENT_REPORT, { mode: 'retake', paperNumber: 3, paperCount: 3 }) }, catalogError: new Error('offline') })
  offline.page.onLoad({ attemptId: '77' })
  await flush()
  assert.equal(offline.page.data.compare, null)
  assert.equal(offline.page.data.failed, false)
  assert.ok(offline.page.data.model)
})

test('the template draws the comparison only from loaded data', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'assessment/report/index.wxml'), 'utf8')
  assert.match(wxml, /<view wx:if="\{\{compare\.change\}\}" class="report-card-shell">/)
  assert.match(wxml, /<view wx:if="\{\{compare\.history\.length > 1\}\}" class="report-card-shell">/)
  assert.match(wxml, /bindtap="openHistoryReport"/)
  // 对比区块没有骨架：骨架段里不出现 compare
  const skeleton = wxml.slice(wxml.indexOf('<block wx:elif="{{!model}}">'), wxml.indexOf('<block wx:else>'))
  assert.ok(!/compare/.test(skeleton))
})

// ── 测评列表与测评中心 ──

test('the assessment list marks finished retakes with the change since last time', async () => {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assessment/short/index.js'), 'utf8'), {
    Page: (p) => { definition = p },
    require: () => ({
      ...service,
      call: async () => ({
        scopes: [{ id: 146, name: '7年级数学', roundCount: 3, entry: { mode: 'report', attemptId: 77, completedRounds: 3, paperNumber: 3, canRetake: true, history: HISTORY } }],
        attempts: [
          { id: 77, status: 'submitted', exam_scope_id: 146, scope_snapshot: { name: '7年级数学' }, paperNumber: 3, paperCount: 3 },
          { id: 52, status: 'submitted', exam_scope_id: 146, scope_snapshot: { name: '7年级数学' }, paperNumber: 2, paperCount: 3 },
          { id: 31, status: 'submitted', exam_scope_id: 146, scope_snapshot: { name: '7年级数学' }, paperNumber: 1, paperCount: 3 },
          { id: 60, status: 'submitted', exam_scope_id: 147, scope_snapshot: { name: '7年级语文' }, paperNumber: 1, paperCount: 1 }
        ]
      })
    }),
    wx: { showModal() {}, navigateTo() {}, showToast() {} },
    Date, setInterval, clearInterval
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({})
  await page.loadPage()
  assert.deepEqual(plain(page.data.records.map((item) => [item.name, item.deltaLabel, item.deltaTone])), [
    ['7年级数学 · 第 3 次', '比上次 +7.8 分', 'up'],
    ['7年级数学 · 第 2 次', '比上次 +16 分', 'up'],
    ['7年级数学 · 第 1 次', '', ''],
    ['7年级语文', '', '']
  ])
  assert.equal(page.data.scopes[0].deltaLabel, '比上次 +7.8 分')
  const wxml = fs.readFileSync(path.join(ROOT, 'assessment/short/index.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{item\.deltaLabel\}\}"/)
})

test('the assessment center marks records with the change since last time', async () => {
  let definition
  const center = {
    profile: null,
    subjects: [{ key: 'math', name: '数学', readyCount: 1, scopes: [{ scopeId: '146', entry: { mode: 'report', history: [{ attemptId: 31, number: 1, totalScore: 80 }, { attemptId: 52, number: 2, totalScore: 74.5 }] } }] }],
    attempts: [
      { id: '52', status: 'submitted', name: '7年级数学', examScopeId: 146, paperNumber: 2, paperCount: 2, submittedAt: '2026-09-28T12:00:00.000Z' },
      { id: '31', status: 'submitted', name: '7年级数学', examScopeId: 146, paperNumber: 1, paperCount: 2, submittedAt: '2026-09-20T12:00:00.000Z' }
    ]
  }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assessment/center/index.js'), 'utf8'), {
    Page: (p) => { definition = p },
    require: (name) => name.endsWith('/identity') ? { loadAssessmentCenter: async () => center } : name.endsWith('/ui-assets') ? { attachUiAssets() {} } : require('../utils/screen'),
    wx: { showToast() {} }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  await page.loadPage()
  assert.deepEqual(plain(page.data.model.history.records.map((item) => [item.subject, item.deltaLabel, item.deltaTone])), [
    ['7年级数学 · 第 2 次', '比上次 -5.5 分', 'down'],
    ['7年级数学 · 第 1 次', '', '']
  ])
  const wxml = fs.readFileSync(path.join(ROOT, 'assessment/center/index.wxml'), 'utf8')
  assert.match(wxml, /class="history-delta \{\{item\.deltaTone\}\}"/)
})
