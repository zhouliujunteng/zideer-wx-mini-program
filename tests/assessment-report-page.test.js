// 学科测评报告页（assessment/report，设计稿 ui-ref M17，2026-09-30）：
// 视图模型只用真实报告数据（雷达图按教材单元、薄弱点按判定、路径按判定排阶段，不估周数、不画同龄段），
// 页面读测评、未提交的转回答题页、下一轮、逐题回顾配图、分享长图。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const ROOT = path.join(__dirname, '..')
const { buildReportModel, unitParts } = require('../utils/assessment-report')
const { drawReportShare } = require('../assessment/report/share-image')

function loadService() {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'services/assessment.js'), 'utf8'), { module, exports: module.exports, require: (name) => name === '../utils/question-timing' ? require('../utils/question-timing') : ({ requestK12Assessment: async () => ({}) }) })
  return module.exports
}
const { reportView } = loadService()

const topic = (topicId, name, state, extra = {}) => ({ topicId, name, state, tier: 'A', weight: 4, n: 4, c: state === 'mastered' ? 4 : state === 'reinforce' ? 2 : 0, answered: state === 'pending' ? 0 : 4, ...extra })
const unit = (unitId, name, order) => ({ unitId, unit: name, unitOrder: order })

function sampleReport(overrides = {}) {
  return {
    attemptId: 31,
    scope: { id: 146, name: '7年级数学 · 上学期 · 摸底诊断' },
    totalScore: 62.5,
    round: 1, roundCount: 3, completedRounds: 1, isFinal: false, nextRound: 2,
    notice: '已完成 1/3 轮。',
    masteredCount: 3, reinforceCount: 2, notMasteredCount: 2, pendingCount: 2,
    topics: [
      topic(1, '正数和负数', 'mastered', unit(71, '第一章 有理数', 1)),
      topic(2, '数轴', 'not_mastered', { ...unit(71, '第一章 有理数', 1), tier: 'B', weight: 2 }),
      topic(3, '有理数的乘法', 'not_mastered', unit(72, '第二章 有理数的运算', 2)),
      topic(4, '有理数的加法', 'reinforce', unit(72, '第二章 有理数的运算', 2)),
      topic(5, '代数式', 'mastered', unit(73, '第三章 代数式', 3)),
      topic(6, '合并同类项', 'reinforce', { ...unit(74, '第四章 整式的加减', 4), tier: 'C', weight: 1 }),
      topic(7, '去括号', 'mastered', unit(74, '第四章 整式的加减', 4)),
      topic(8, '一元一次方程', 'pending', unit(75, '第五章 一元一次方程', 5)),
      topic(9, '几何图形', 'pending', unit(76, '第六章 几何图形初步', 6))
    ],
    review: [{ questionId: 7, number: 1, prompt: '题', correct: false, selected: 'A', answer: 'B', options: [{ value: 'A', label: 'a' }, { value: 'B', label: 'b' }], figures: [], explanationFigures: [] }],
    ...overrides
  }
}

test('the radar groups judged topics by textbook unit with the same weighting as the overall score', () => {
  const model = buildReportModel(reportView(sampleReport()), { name: '小鹿', avatarUrl: '' })
  // 第五、六章只有待测知识点，不进雷达图
  assert.deepEqual(model.radar.map((item) => [item.label, item.value]), [['有理数', 67], ['有理数的运算', 25], ['代数式', 100], ['整式的加减', 90]])
  assert.deepEqual(model.cover.insightPills.map((item) => item.text), ['优势 · 代数式 100%', '优先提升 · 有理数的运算 25%'])
  assert.equal(model.cover.scoreText, '62.5')
  assert.equal(model.context, '7年级数学 · 上学期')
  assert.equal(model.period, '第 1 轮 / 共 3 轮')
})

test('with fewer than three judged units (round 1 of a multi-round paper) the radar falls back to judged knowledge points', () => {
  const twoUnits = sampleReport()
  twoUnits.topics = twoUnits.topics.filter((item) => item.unitId === 71 || item.unitId === 72)
  const model = buildReportModel(reportView(twoUnits), null)
  assert.equal(model.radarLabel, '各知识点掌握度雷达图')
  // 已判定的 4 个知识点全进雷达图，按教材顺序；数值是各自的答对率
  assert.deepEqual(model.radar.map((item) => [item.label, item.value]), [['正数和负数', 100], ['数轴', 0], ['有理数的乘法', 0], ['有理数的加法', 50]])
  assert.deepEqual(model.cover.insightPills.map((item) => item.text), ['优势 · 正数和负数 100%', '优先提升 · 数轴 0%'])
  assert.equal(model.student.name, '')

  // 旧版动作流没有单元信息：同样按知识点画
  const noUnits = sampleReport()
  noUnits.topics = noUnits.topics.map(({ unit: _u, unitId: _i, unitOrder: _o, ...rest }) => rest)
  assert.equal(buildReportModel(reportView(noUnits), null).radar.length, 6)

  // 单元够 3 个仍按单元画
  assert.equal(buildReportModel(reportView(sampleReport()), null).radarLabel, '各单元掌握度雷达图')

  // 已判定的知识点不足 3 个：不画雷达图，也没有胶囊
  const few = sampleReport()
  few.topics = [topic(1, '甲', 'mastered', unit(1, '一', 1)), topic(2, '乙', 'reinforce', unit(1, '一', 1)), topic(3, '丙', 'pending', unit(2, '二', 2))]
  const none = buildReportModel(reportView(few), null)
  assert.deepEqual(none.radar, [])
  assert.deepEqual(none.cover.insightPills, [])
})

test('the knowledge-point radar keeps six points, core tiers and heavier weights first', () => {
  const report = sampleReport()
  report.topics = Array.from({ length: 9 }, (_, index) => topic(index + 1, `点${index + 1}`, 'mastered', { ...unit(1, '第一章 甲', 1), tier: index < 3 ? 'C' : index < 5 ? 'B' : 'A', weight: index < 3 ? 1 : index < 5 ? 2 : 4 }))
  const model = buildReportModel(reportView(report), null)
  assert.deepEqual(model.radar.map((item) => item.label), ['点4', '点5', '点6', '点7', '点8', '点9'])
})

test('more than six judged units keeps the six carrying the most weight, in textbook order', () => {
  const report = sampleReport()
  report.topics = Array.from({ length: 8 }, (_, index) => topic(index + 1, `知识点${index}`, 'mastered', { ...unit(index + 1, `第${index + 1}章 单元${index}`, index), weight: index === 2 ? 1 : 4 }))
  const model = buildReportModel(reportView(report), null)
  assert.equal(model.radar.length, 6)
  assert.ok(!model.radar.some((item) => item.label === '单元2'))
  assert.deepEqual(model.radar.map((item) => item.label), ['单元0', '单元1', '单元3', '单元4', '单元5', '单元6'])
})

test('unit labels drop the chapter number and bracketed lesson list, falling back to the number on clashes', () => {
  assert.equal(unitParts('第一章 有理数').short, '有理数')
  assert.equal(unitParts('第二单元 课文（小蝌蚪找妈妈、我是什么）').short, '课文')
  assert.equal(unitParts('Unit 3 My friends').short, 'My friends')
  const report = sampleReport()
  report.topics = [1, 2, 3].map((index) => topic(index, `课${index}`, 'mastered', unit(index, `第${index}单元 课文（第${index}组）`, index)))
  assert.deepEqual(buildReportModel(reportView(report), null).radar.map((item) => item.label), ['第1单元', '第2单元', '第3单元'])
})

test('weak points list not-mastered before reinforce, core tiers first, and the path follows the same order', () => {
  const model = buildReportModel(reportView(sampleReport()), { name: '小鹿' })
  assert.deepEqual(model.weakPoints.map((item) => [item.title, item.category]), [
    ['有理数的乘法', '核心 · 未掌握'], ['数轴', '重要 · 未掌握'], ['有理数的加法', '核心 · 待巩固'], ['合并同类项', '基础 · 待巩固']
  ])
  assert.ok(model.weakPoints.every((item) => item.reason && !/\d/.test(item.reason)))
  assert.equal(model.advice, '先补有理数的乘法，再巩固有理数的加法。')
  assert.deepEqual(model.pendingPoints, ['一元一次方程', '几何图形'])
  assert.deepEqual(model.summary.map((item) => [item.label, item.value]), [['已掌握', '3'], ['待巩固', '2'], ['未掌握', '2'], ['待测', '2']])
  assert.deepEqual(model.pathStages.map((item) => [item.number, item.phase, item.focus, item.duration]), [
    ['01', '先补基础', '有理数的乘法 → 数轴', '2 个知识点'],
    ['02', '再做巩固', '有理数的加法 → 合并同类项', '2 个知识点'],
    ['03', '继续测评', '第 2 轮测评', '2 个待测']
  ])
  assert.equal(model.pathEstimate, '4 个知识点 · 分 3 步')
  // 不估学习周数 / 单元数
  assert.ok(!/周|单元/.test(JSON.stringify(model.pathStages) + model.pathEstimate))
})

test('an all-mastered final report has no path, and a report with nothing judged yet shows no score', () => {
  const allGood = sampleReport({ isFinal: true, nextRound: null, round: 3, completedRounds: 3, notMasteredCount: 0, reinforceCount: 0, pendingCount: 0, masteredCount: 2 })
  allGood.topics = [topic(1, '甲', 'mastered', unit(1, '一', 1)), topic(2, '乙', 'mastered', unit(2, '二', 2))]
  const model = buildReportModel(reportView(allGood), null)
  assert.deepEqual(model.pathStages, [])
  assert.deepEqual(model.weakPoints, [])
  assert.equal(model.period, '已完成全部 3 轮')
  assert.equal(model.advice, '这次的知识点都掌握了，保持练习。')

  const nothing = sampleReport({ totalScore: null, masteredCount: 0, reinforceCount: 0, notMasteredCount: 0, pendingCount: 2 })
  nothing.topics = [topic(1, '甲', 'pending'), topic(2, '乙', 'pending')]
  const empty = buildReportModel(reportView(nothing), null)
  assert.equal(empty.cover.score, null)
  assert.equal(empty.cover.scoreText, '—')
  assert.equal(empty.advice, '做完后续轮次后给出知识点判定。')
})

// ── 页面 ──
const pagePath = require.resolve('../assessment/report/index.js')
const assessmentPath = require.resolve('../services/assessment.js')
const identityPath = require.resolve('../services/identity.js')

function stub(file, exports) { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

function loadPage({ read, start, user = { profile: { nickname: '小鹿', avatar_url: 'https://img/avatar.png' } }, pages = [{ route: 'assessment/center/index' }, { route: 'assessment/report/index' }] } = {}) {
  delete require.cache[pagePath]
  const calls = { ops: [], redirect: [], navigate: [], back: [], switchTab: [], toast: [], previews: [], saved: [], modal: [] }
  stub(assessmentPath, {
    reportView,
    call: async (op, payload) => {
      calls.ops.push([op, payload])
      if (op === 'read') { const value = typeof read === 'function' ? read(payload) : read; if (value instanceof Error) throw value; return value }
      if (op === 'start') { const value = typeof start === 'function' ? start(payload) : start; if (value instanceof Error) throw value; return value }
      throw new Error(`unexpected ${op}`)
    }
  })
  stub(identityPath, { loadCurrentUser: async () => { if (user instanceof Error) throw user; return user } })
  let definition = null
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pages
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20, pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 24, width: 87, height: 32 }),
    redirectTo: (options) => calls.redirect.push(options.url),
    navigateTo: (options) => calls.navigate.push(options.url),
    navigateBack: (options) => calls.back.push(options.delta),
    switchTab: (options) => calls.switchTab.push(options.url),
    showToast: (options) => calls.toast.push(options.title),
    showModal: (options) => calls.modal.push(options.title),
    previewImage: (options) => calls.previews.push(options),
    createSelectorQuery: () => ({ in() { return this }, select() { return this }, fields() { return this }, boundingClientRect() { return this }, exec() {} }),
    getImageInfo: (options) => options.success({ path: `wxfile://${path.basename(options.src)}` }),
    createCanvasContext: () => fakeContext(),
    canvasToTempFilePath: (options) => options.success({ tempFilePath: 'wxfile://report.png' }),
    saveImageToPhotosAlbum: (options) => { calls.saved.push(options.filePath); options.success() }
  }
  require(pagePath)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values, done) { Object.assign(this.data, values); if (done) done() } }
  return { page, calls }
}

// 旧版画布上下文的替身：记下画了什么，measureText 按字数估宽度。
function fakeContext(log = []) {
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return (text) => ({ width: String(text).length * (target.fontSize || 10) * 0.9 })
      if (key === 'setFontSize') return (size) => { target.fontSize = size }
      if (key === 'fillText') return (text) => log.push(String(text))
      if (key === 'draw') return (flag, done) => done && done()
      if (key === 'log') return log
      return () => {}
    }
  })
  return ctx
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const submitted = (report = sampleReport()) => ({ attempt: { id: 31, status: 'submitted', report } })

test('the page reads the attempt and the student together, and builds the report model', async () => {
  const { page, calls } = loadPage({ read: submitted() })
  page.onLoad({ attemptId: '31' })
  await flush()
  assert.deepEqual(calls.ops, [['read', { attemptId: '31' }]])
  assert.equal(page.data.model.student.name, '小鹿')
  assert.equal(page.data.model.student.avatarUrl, 'https://img/avatar.png')
  assert.equal(page.data.model.radar.length, 4)
  assert.equal(page.data.failed, false)
})

test('an attempt that is not submitted goes back to the answering page; a failed first read shows retry', async () => {
  const draft = loadPage({ read: { attempt: { id: 31, status: 'draft', report: null } } })
  draft.page.onLoad({ attemptId: '31' })
  await flush()
  assert.deepEqual(draft.calls.redirect, ['/assessment/short/index?attemptId=31'])
  assert.equal(draft.page.data.model, null)

  const broken = loadPage({ read: new Error('网络不太好'), user: new Error('x') })
  broken.page.onLoad({ attemptId: '31' })
  await flush()
  assert.equal(broken.page.data.failed, true)
  assert.equal(broken.page.data.error, '网络不太好')

  const missing = loadPage({ read: submitted() })
  missing.page.onLoad({ attemptId: 'abc' })
  await flush()
  assert.equal(missing.calls.ops.length, 0)
  assert.equal(missing.page.data.failed, true)
})

test('the student name falls back when the profile cannot be read, without failing the report', async () => {
  const { page } = loadPage({ read: submitted(), user: new Error('profile down') })
  page.onLoad({ attemptId: '31' })
  await flush()
  assert.equal(page.data.model.student.name, '同学')
  assert.equal(page.data.model.student.avatarUrl, '')
})

test('the next round starts on the same scope and continues on the answering page', async () => {
  const { page, calls } = loadPage({ read: submitted(), start: { attempt: { id: 44, status: 'draft' } } })
  page.onLoad({ attemptId: '31' })
  await flush()
  await page.startNextRound()
  assert.deepEqual(calls.ops[1], ['start', { scopeId: 146 }])
  assert.deepEqual(calls.redirect, ['/assessment/short/index?attemptId=44'])

  const failing = loadPage({ read: submitted(), start: new Error('题库准备中') })
  failing.page.onLoad({ attemptId: '31' })
  await flush()
  await failing.page.startNextRound()
  assert.deepEqual(failing.calls.toast, ['题库准备中'])
  assert.equal(failing.page.data.busy, false)
})

test('continue returns to the assessment center already in the stack, otherwise opens it', async () => {
  const inStack = loadPage({ read: submitted(), pages: [{ route: 'pages/me/index' }, { route: 'assessment/center/index' }, { route: 'assessment/short/index' }, { route: 'assessment/report/index' }] })
  inStack.page.openAssessmentCenter()
  assert.deepEqual(inStack.calls.back, [2])
  const fresh = loadPage({ read: submitted(), pages: [{ route: 'assessment/report/index' }] })
  fresh.page.openAssessmentCenter()
  assert.deepEqual(fresh.calls.navigate, ['/assessment/center/index'])
  fresh.page.handleBack()
  assert.deepEqual(fresh.calls.redirect, ['/assessment/short/index'])
})

test('review figures preview as one group per question', async () => {
  const figure = (name) => ({ url: `https://img/${name}.png`, width: 800, height: 600 })
  const report = sampleReport({ review: [{ questionId: 7, number: 1, prompt: '题', figures: [figure('r-stem')], options: [{ value: 'A', label: 'a', figures: [figure('r-a')] }], explanationFigures: [figure('r-exp')] }] })
  const { page, calls } = loadPage({ read: submitted(report) })
  page.onLoad({ attemptId: '31' })
  await flush()
  page.previewFigure({ currentTarget: { dataset: { url: 'https://img/r-exp.png', group: 7 } } })
  assert.deepEqual(JSON.parse(JSON.stringify(calls.previews[0].urls)), ['https://img/r-stem.png', 'https://img/r-a.png', 'https://img/r-exp.png'])
})

test('the template renders review figures through the wxs helper and never shows peer comparison', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'assessment/report/index.wxml'), 'utf8')
  assert.match(wxml, /<wxs module="QF" src="\.\.\/\.\.\/utils\/question-figure\.wxs" \/>/)
  for (const list of ['item.figures', 'option.figures', 'item.explanationFigures']) {
    assert.ok(wxml.includes(`wx:for="{{${list}}}"`), `missing figures loop: ${list}`)
  }
  const images = wxml.match(/<image [^>]*class="review-figure-image"[^>]*>/g) || []
  assert.equal(images.length, 3)
  images.forEach((tag) => assert.match(tag, /binderror="figureFailed"/))
  assert.ok(!/同龄|peer/.test(wxml))
  // 素材路径都经 UA.src；头像经 UA.avatar
  assert.match(wxml, /UA\.avatar\(ui, model\.student\.avatarUrl\)/)
})

test('the share long image is measured, drawn at that height and can be saved or posted to moments', async () => {
  const { page, calls } = loadPage({ read: submitted() })
  page.onLoad({ attemptId: '31' })
  await flush()
  page.openShare()
  await flush()
  assert.equal(page.data.shareImagePath, 'wxfile://report.png')
  assert.equal(page.data.shareImageLoading, false)
  assert.ok(page.data.shareCanvasHeight > 900)
  page.handleShareAction({ currentTarget: { dataset: { action: 'save' } } })
  assert.deepEqual(calls.saved, ['wxfile://report.png'])
  assert.equal(page.data.shareVisible, false)
  page.setData({ shareVisible: true })
  page.handleShareAction({ currentTarget: { dataset: { action: 'timeline' } } })
  assert.deepEqual(calls.modal, ['长图已保存到相册'])
  const share = page.onShareAppMessage()
  assert.equal(share.path, '/pages/home/index')
  assert.equal(share.imageUrl, 'wxfile://report.png')
  assert.match(share.title, /小鹿的7年级数学 · 上学期测评报告/)
})

test('the share drawing skips sections without data and grows with the content', () => {
  const full = buildReportModel(reportView(sampleReport()), { name: '小鹿' })
  const log = []
  const fullHeight = drawReportShare(fakeContext(log), full, { width: 327, topInset: 40, scale: 1.5, images: {} })
  for (const title of ['掌握情况', '知识薄弱点', '提升路径', '待补齐证据 · 2 个知识点', '本轮小建议']) assert.ok(log.includes(title), `missing ${title}`)
  assert.ok(!log.some((line) => /同龄/.test(line)))

  const allGood = sampleReport({ isFinal: true, nextRound: null, notMasteredCount: 0, reinforceCount: 0, pendingCount: 0 })
  allGood.topics = [topic(1, '甲', 'mastered')]
  const shortLog = []
  const shortHeight = drawReportShare(fakeContext(shortLog), buildReportModel(reportView(allGood), { name: '小鹿' }), { width: 327, topInset: 40, scale: 1.5, images: {} })
  assert.ok(!shortLog.includes('知识薄弱点') && !shortLog.includes('提升路径'))
  assert.ok(shortHeight < fullHeight)
})

test('finished report can retake after confirmation; an older report resumes the newer paper', async () => {
  const read = submitted(sampleReport({ isFinal: true, nextRound: null }));
  read.attempt.retake = { mode: 'retake', paperNumber: 1, paperCount: 1, isLatest: true };
  const { page, calls } = loadPage({ read, start: { attempt: { id: 99, status: 'draft' } } });
  page.onLoad({ attemptId: '31' }); await flush();
  assert.equal(page.data.retakeLabel, '再测一次');
  let modal; wx.showModal = options => { modal = options };
  page.retake(); modal.success({ confirm: false }); await flush();
  assert.equal(calls.ops.filter(([op]) => op === 'start').length, 0);
  page.retake(); modal.success({ confirm: true }); await flush();
  assert.deepEqual(calls.ops.find(([op]) => op === 'start'), ['start', { scopeId: 146, retake: true }]);
  assert.equal(calls.redirect.at(-1), '/assessment/short/index?attemptId=99');
  page.setData({ retake: { mode: 'resume', paperNumber: 1, paperCount: 2, attemptId: 99 } });
  page.retake();
  assert.equal(calls.ops.filter(([op]) => op === 'start').length, 1);
  assert.equal(calls.redirect.at(-1), '/assessment/short/index?attemptId=99');
});

test('per-question evidence is visible and exported, with unknown and subsecond times distinguished', () => {
  const rows = [
    {questionId:1,number:1,round:1,prompt:'第一题',selected:'B',correct:true,secondsUsed:70,timingMethod:'foreground-v1',previous:{secondsUsed:90,correct:false,timingMethod:'foreground-v1'}},
    {questionId:2,number:2,round:1,prompt:'第二题',selected:'A',correct:false,secondsUsed:null},
    {questionId:3,number:1,round:2,prompt:'第三题',selected:'A',correct:true,secondsUsed:0},
  ]
  const model=buildReportModel(reportView(sampleReport({questionTimings:rows})),{name:'测试学生'})
  assert.equal(model.questionTimings[0].timingLabel,'1分10秒')
  assert.equal(model.questionTimings[1].timingLabel,'未记录')
  assert.equal(model.questionTimings[2].timingLabel,'不足1秒')
  const log=[]
  drawReportShare(fakeContext(log),model,{width:327,topInset:40,scale:1.5,images:{}})
  const serialized=JSON.stringify(log)
  for (const text of ['逐题用时','1分10秒','未记录','不足1秒','上次 1分30秒']) assert.ok(serialized.includes(text),text)
})

test('long papers export all questions across bounded canvases and save every page',async()=>{
 const {reportSharePages}=require('../assessment/report/share-image')
 const rows=Array.from({length:100},(_,i)=>({questionId:i+1,number:i+1,round:1,prompt:'长题干'.repeat(30),selected:'A',secondsUsed:10,timingMethod:'foreground-v1'}))
 const report=sampleReport({questionTimings:rows})
 const model=buildReportModel(reportView(report),{name:'测试'})
 const measure=m=>drawReportShare(fakeContext([]),m,{width:327,topInset:40,scale:1.5,images:{}})
 const pages=reportSharePages(model,measure,4000/1.5)
 assert.ok(pages.length>1)
 assert.equal(pages.flatMap(p=>p.questionTimings).length,100)
 assert.ok(pages.every(p=>measure(p)*1.5<=4000))
 const {page,calls}=loadPage({read:submitted(report)})
 page.onLoad({attemptId:'31'});await flush();page.openShare();await flush()
 assert.equal(page.data.shareImagePaths.length,pages.length)
 page.handleShareAction({currentTarget:{dataset:{action:'save'}}})
 assert.equal(calls.saved.length,pages.length)
})
