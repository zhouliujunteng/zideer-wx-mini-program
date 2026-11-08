const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 按目标测评 + 目标导图（2026-10-10 用户规则）：先定目标 → 围绕目标出题 → 错了往前置知识点挖 → 导图。
const { layoutGoalMap, initialScale, progressView, summaryView, entrySummary, wrapText } = require('../utils/goal-map')

const root = path.join(__dirname, '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

// 与课程服务 lib/goal-diagnosis/engine.ts mapView 回包同形（先序，带 parentId）
const NODES = [
  { id: 'g', parentId: null, kind: 'goal', label: '期末数学函数不丢分', level: 0, status: 'gap', alias: false, current: false },
  { id: 'c1', parentId: 'g', kind: 'condition', label: '一次函数图像', note: '看图像是基础', level: 1, status: 'gap', alias: false, current: false },
  { id: 't101', parentId: 'c1', kind: 'topic', label: '一次函数的图像', gradeLabel: '初二', level: 2, status: 'gap', alias: false, current: false },
  { id: 't201', parentId: 't101', kind: 'topic', label: '正比例函数', gradeLabel: '初二', level: 3, status: 'root_gap', alias: false, current: false },
  { id: 't202', parentId: 't101', kind: 'topic', label: '平面直角坐标系', gradeLabel: '初一', level: 3, status: 'mastered', alias: false, current: false },
  { id: 'c2', parentId: 'g', kind: 'condition', label: '函数应用', level: 1, status: 'testing', alias: false, current: false },
  { id: 't102', parentId: 'c2', kind: 'topic', label: '一次函数的应用', level: 2, status: 'testing', alias: false, current: true },
  { id: 't101@t102', parentId: 't102', kind: 'topic', label: '一次函数的图像', level: 3, status: 'gap', alias: true, current: false }
]

test('lays the map out left to right, one column per level, parents centred on their children', () => {
  const map = layoutGoalMap(NODES)
  const card = (id) => map.cards.find((item) => item.id === id)
  assert.equal(map.cards.length, NODES.length)
  assert.ok(card('g').x < card('c1').x && card('c1').x < card('t101').x && card('t101').x < card('t201').x)
  assert.equal(card('t201').x, card('t202').x)
  // 父卡片竖直居中于两个孩子
  const mid = (c) => c.y + c.height / 2
  assert.ok(Math.abs(mid(card('t101')) - (mid(card('t201')) + mid(card('t202'))) / 2) <= 1)
  // 卡片不重叠
  for (const a of map.cards) for (const b of map.cards) {
    if (a === b || a.x !== b.x) continue
    assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} overlaps ${b.id}`)
  }
  assert.ok(map.width >= card('t201').x + card('t201').width)
  assert.equal(card('t201').statusText, '根源卡点')
  assert.equal(card('t201').tone, 'root')
  assert.equal(card('t101@t102').statusText, '卡点 · 同上')
  assert.equal(card('t102').current, true)
  // 通往卡点的连线标暖色
  // 曲线：每条连线是两段四分之一椭圆；通往卡点的那条标暖色
  assert.deepEqual(map.lines.filter((line) => line.id.startsWith('t101-t201')).map((line) => line.type), ['ur1', 'ur2'])
  assert.ok(map.lines.filter((line) => line.id.startsWith('t101-t201')).every((line) => line.hot))
  assert.ok(map.lines.filter((line) => line.id.startsWith('t101-t202')).every((line) => !line.hot))
  for (const line of map.lines) assert.ok(line.width >= 0 && line.height >= 0)
})

test('wraps long labels to at most three lines with an ellipsis', () => {
  const lines = wrapText('这是一个非常非常长的知识点名称用来测试折行和省略号是否正常工作好不好', 100, 13, 3)
  assert.equal(lines.length, 3)
  assert.ok(lines[2].endsWith('…'))
  assert.deepEqual(wrapText('', 100, 13, 3), [''])
})

test('fits a wide map into the box but never below 55%', () => {
  assert.equal(initialScale(300, 200, 340, 420), 1)
  assert.equal(initialScale(680, 300, 340, 420), 0.55)
  assert.equal(initialScale(500, 300, 400, 420), 0.8)
})

test('progress shows conditions explored, never a question count', () => {
  const view = progressView({ nodes: NODES, summary: { conditionsSettled: 0 } })
  assert.deepEqual(view, { total: 2, settled: 0, dots: [{ id: 'c1', tone: 'gap', label: '一次函数图像' }, { id: 'c2', tone: 'testing', label: '函数应用' }] })
  // 老回包没有 summary：卡点还在往下挖的不算探明
  assert.equal(progressView({ nodes: NODES }).settled, 0)
})

test('summary and the universe entry read the server conclusion', () => {
  const diagnosis = {
    status: 'finished',
    map: { nodes: NODES, summary: { mastered: 3, gaps: 2, rootGaps: [{ topicId: 201, label: '正比例函数', gradeLabel: '初二' }], path: [{ topicId: 201, label: '正比例函数', root: true }, { topicId: 101, label: '一次函数的图像', root: false }], conditions: 2, conditionsSettled: 2 } }
  }
  const summary = summaryView(diagnosis)
  assert.equal(summary.roots[0].label, '正比例函数')
  assert.deepEqual(summary.path.map((item) => item.step), [1, 2])
  assert.equal(entrySummary({ goal: null }).text, '先定学习目标，再围绕目标测一轮')
  assert.equal(entrySummary({ goal: { text: 'x' }, diagnosis: null }).action, '去测评')
  assert.equal(entrySummary({ goal: { text: 'x' }, diagnosis, goalChanged: true }).action, '去测评')
  assert.equal(entrySummary({ goal: { text: 'x' }, diagnosis: { status: 'paused' } }).action, '继续')
  assert.equal(entrySummary({ goal: { text: 'x' }, diagnosis }).text, '找到 1 个根源卡点：正比例函数')
})

test('page is registered and reachable from the goal page, test center, universe card and teacher detail', () => {
  const app = JSON.parse(read('app.json'))
  const learning = app.subpackages.find((item) => item.root === 'learning')
  assert.ok(learning.pages.includes('goal-diagnosis/index'))
  assert.match(read('learning/learning-goal/index.js'), /\/learning\/goal-diagnosis\/index\?autostart=1/)
  assert.match(read('assessment/center/index.js'), /\/learning\/goal-diagnosis\/index/)
  assert.match(read('pages/knowledge-universe/index.js'), /switchTab\(\{ url: '\/pages\/goal\/index' \}\)/)
  assert.match(read('teacher/student-detail/index.js'), /\/learning\/goal-diagnosis\/index\?studentProfileId=/)
  // 学生看不到题量：页面不显示第几题 / 共几题
  const wxml = read('learning/goal-diagnosis/index.wxml')
  assert.doesNotMatch(wxml, /第\s*\{\{|共\s*\{\{|题\s*\/\s*\{\{/)
  // 内联样式不写 rpx（大屏下会放大）
  assert.doesNotMatch(wxml, /style="[^"]*rpx/)
})

// 「目标」tab（2026-10-10）：游客画示例导图；学生的结果页把课挂在卡点下面，点了进课程详情
function loadGoalTab({ session = true, overview, failure } = {}) {
  const navigations = []
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({})
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32, left: 300, right: 380, bottom: 58, width: 80 }),
    navigateTo: (o) => navigations.push(o.url),
    switchTab: (o) => navigations.push(o.url),
    showToast() {},
    getStorageSync: () => ''
  }
  const identityPath = require.resolve('../services/identity')
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: {
    hasSession: () => session,
    loadGoalDiagnosis: async () => { if (failure) throw failure; return overview },
    goalDiagnosis: async () => ({ items: [] }),
    accessOfError: (error) => (error && error.access) || ''
  } }
  const pagePath = require.resolve('../pages/goal/index.js')
  delete require.cache[pagePath]
  require(pagePath)
  const page = { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value.bind(page)
  delete require.cache[identityPath]
  return { page, navigations }
}

test('goal tab shows a sample goal map to guests and people without a profile', async () => {
  const { page } = loadGoalTab({ session: false })
  await page.load()
  assert.equal(page.data.view, 'sample')
  assert.equal(page.data.access, 'guest')
  assert.ok(page.data.nodes.length > 5)
  const { page: noProfile } = loadGoalTab({ failure: Object.assign(new Error('x'), { access: 'profile' }) })
  await noProfile.load()
  assert.equal(noProfile.data.view, 'sample')
  assert.equal(noProfile.data.access, 'profile')
})

test('goal tab lists the courses linked to each gap and opens the course detail', async () => {
  const nodes = NODES.map((node) => node.id === 't201' ? { ...node, topicId: 201, courses: [{ stageId: 'stage-abc', title: '正比例函数入门', state: 'ready' }, { stageId: 'stage-wip', title: '制作中的课', state: 'making' }] } : node)
  const overview = {
    goal: { text: '期末数学函数部分不丢分', direction: '', deadline: '' },
    goalChanged: false,
    diagnosis: { id: 3, status: 'finished', subjectName: '数学', goal: { text: 'x' }, map: { nodes, summary: { mastered: 1, gaps: 2, rootGaps: [{ topicId: 201, label: '正比例函数' }], path: [{ topicId: 201, label: '正比例函数', root: true }] } } }
  }
  const { page, navigations } = loadGoalTab({ overview })
  await page.load()
  assert.equal(page.data.view, 'result')
  // 学生只看到能学的课
  assert.deepEqual(page.data.summary.path[0].courses.map((c) => c.stageId), ['stage-abc'])
  page.openCourse({ currentTarget: { dataset: { stage: 'stage-abc', state: 'ready' } } })
  page.openCourse({ detail: { stageId: 'stage-wip', state: 'making' } })
  assert.deepEqual(navigations, ['/learning/agent-course/index?stageId=stage-abc'])
})

test('goal tab sends people without a goal to set one, and an unfinished test back to it', async () => {
  const { page } = loadGoalTab({ overview: { goal: null, diagnosis: null } })
  await page.load()
  assert.equal(page.data.view, 'no_goal')
  const { page: testing } = loadGoalTab({ overview: { goal: { text: 'x' }, goalChanged: false, diagnosis: { id: 1, status: 'active', map: { nodes: NODES, summary: { conditionsSettled: 0 } } } } })
  await testing.load()
  assert.equal(testing.data.view, 'testing')
  const { page: changed } = loadGoalTab({ overview: { goal: { text: 'y' }, goalChanged: true, diagnosis: { id: 1, status: 'finished', map: { nodes: NODES, summary: {} } } } })
  await changed.load()
  assert.equal(changed.data.view, 'start')
})

// 诊断会议（2026-10-10 用户要求）：老师 AI 开场就看到目标导图的卡点，定纲按导图来，不再从头摸底
test('the meeting baseline carries a compact goal map without questions or answers', () => {
  const { summarizeGoalMap } = require('../utils/learner-baseline')
  assert.equal(summarizeGoalMap(null).status, 'unavailable')
  assert.equal(summarizeGoalMap({ goal: { text: 'x' }, diagnosis: null }).status, 'none')
  const nodes = NODES.map((node) => (node.kind === 'topic' ? { ...node, topicId: Number(node.id.replace(/\D/g, '')) || 0 } : node))
    .map((node) => (node.id === 't201' ? { ...node, courses: [{ stageId: 's1', title: '正比例函数入门', state: 'ready' }] } : node))
  const view = {
    goal: { text: 'x' },
    goalChanged: false,
    diagnosis: {
      status: 'finished', subjectName: '数学', goal: { title: '函数不丢分', text: '期末数学函数部分不丢分' },
      question: { prompt: '不该出现', options: [] },
      map: { nodes, summary: { rootGaps: [{ topicId: 201, label: '正比例函数', gradeLabel: '初二' }], path: [{ topicId: 201, label: '正比例函数', root: true }, { topicId: 101, label: '一次函数的图像', root: false }] } }
    }
  }
  const goalMap = summarizeGoalMap(view)
  assert.equal(goalMap.status, 'set')
  assert.equal(goalMap.subject, '数学')
  assert.deepEqual(goalMap.rootGaps, [{ id: 201, name: '正比例函数', grade: '初二' }])
  assert.deepEqual(goalMap.studyOrder.map((item) => item.id), [201, 101])
  assert.deepEqual(goalMap.mastered.map((item) => item.name), ['平面直角坐标系'])
  assert.deepEqual(goalMap.coursesDone, [{ id: 201, name: '正比例函数', courses: ['正比例函数入门'] }])
  // 同上节点不重复
  assert.equal(goalMap.gaps.filter((item) => item.name === '一次函数的图像').length, 1)
  assert.doesNotMatch(JSON.stringify(goalMap), /不该出现/)
})

test('the meeting opening tells the teacher to plan from the goal map and tag lessons with goalTopicIds', () => {
  const { buildLiveSessionOpening } = require('../utils/live-session-brief')
  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '王', diagnosis: { status: 'unavailable' } })
  assert.match(text, /goalMap\.rootGaps/)
  assert.match(text, /不要再从头摸底/)
  assert.match(text, /goalTopicIds/)
  assert.match(text, /goalChanged/)
  // 学生的诊断室开场这一轮仍然不排课、不出选项
  assert.match(text, /本轮是开场，\*\*不要排课/)
})

test('the teacher live room links to the student goal map when opened from the student detail', () => {
  assert.match(read('teacher/student-detail/index.js'), /teacher\/live-room\/index\?inviteId=.*&studentProfileId=/)
  assert.match(read('teacher/live-room/index.js'), /\/learning\/goal-diagnosis\/index\?studentProfileId=/)
  assert.match(read('teacher/live-room/index.wxml'), /bindtap="openGoalMap"/)
})

// 2026-10-11：考试类目标显示这轮测评覆盖了本学期几个单元
test('summaryView spells out how much of the exam scope was tested', () => {
  const { summaryView } = require('../utils/goal-map')
  const view = (scope) => summaryView({ map: { nodes: [], summary: { scope } } }).scopeText
  assert.equal(view({ label: '三年级上学期', units: 8, covered: 8, missing: [] }), '考试范围：三年级上学期共 8 个单元，每个单元都测到了')
  assert.equal(view({ label: '三年级上学期', units: 8, covered: 7, missing: ['第八单元'] }), '考试范围：三年级上学期共 8 个单元，测到 7 个（还没测：第八单元）')
  assert.equal(view(undefined), '')
})
