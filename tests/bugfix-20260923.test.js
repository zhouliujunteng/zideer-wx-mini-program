const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

function loadPage(path, extraGlobals = {}) {
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({})
  global.wx = { getStorageSync() {}, setStorageSync() {}, request() {}, navigateTo(options) { global.__navigations.push(options.url) }, ...extraGlobals }
  global.__navigations = []
  delete require.cache[require.resolve(path)]
  require(path)
  return definition
}

test('assessment-center records open that attempt, not the subject picker', () => {
  const page = loadPage('../assessment/center/index.js')
  page.handleAction({ currentTarget: { dataset: { type: 'record', attemptId: '31' } } })
  assert.deepEqual(global.__navigations, ['/assessment/short/index?attemptId=31'])
  const template = readFileSync(require.resolve('../assessment/center/index.wxml'), 'utf8')
  assert.match(template, /class="history-card" data-type="record" data-attempt-id="\{\{item\.id\}\}"/)
})

test('dragging the universe sheet never rotates the globe behind it', () => {
  const page = loadPage('../pages/knowledge-universe/index.js')
  const rotations = []
  const instance = Object.assign(Object.create(page), {
    data: { ...page.data, sheetTop: 400, sheetExpanded: false },
    setData(values) { Object.assign(this.data, values) },
    updateGlobeCards() {},
    _globe: { setAutoRotation() {}, rotateBy(dx, dy) { rotations.push([dx, dy]) }, getZoomScale: () => 1 }
  })
  // 手指落在面板上：面板在拖，球不动
  instance.handleSheetTouchStart({ touches: [{ clientY: 420 }] })
  instance.handleGlobeTouchStart({ touches: [{ clientX: 100, clientY: 420 }] })
  instance.handleGlobeTouchMove({ touches: [{ clientX: 160, clientY: 480 }] })
  instance.handleSheetTouchEnd()
  instance.handleGlobeTouchEnd({ touches: [] })
  // 面板拉到顶后，任何位置的手势都不给球
  instance.data.sheetExpanded = true
  instance.handleGlobeTouchStart({ touches: [{ clientX: 100, clientY: 120 }] })
  instance.handleGlobeTouchMove({ touches: [{ clientX: 160, clientY: 200 }] })
  instance.handleGlobeTouchEnd({ touches: [] })
  assert.deepEqual(rotations, [])
  // 面板在默认位置、手指在球上：正常拖动
  instance.data.sheetExpanded = false
  instance.handleGlobeTouchStart({ touches: [{ clientX: 100, clientY: 120 }] })
  instance.handleGlobeTouchMove({ touches: [{ clientX: 130, clientY: 120 }] })
  assert.deepEqual(rotations, [[30, 0]])
})

test('teacher student detail lists assessment records and opens the read-only report', () => {
  const template = readFileSync(require.resolve('../teacher/student-detail/index.wxml'), 'utf8')
  assert.match(template, /测评记录/)
  assert.match(template, /bindtap="openAssessment"/)
  const page = readFileSync(require.resolve('../teacher/student-detail/index.js'), 'utf8')
  assert.match(page, /\/teacher\/assessment-report\/index\?studentProfileId=/)
  const report = readFileSync(require.resolve('../teacher/assessment-report/index.wxml'), 'utf8')
  assert.match(report, /学生答案/)
  assert.doesNotMatch(report, /bindtap="(start|submit|answer)/)
})

test('assessment-center history lists only finished rounds', () => {
  const source = readFileSync(require.resolve('../assessment/center/index.js'), 'utf8')
  assert.match(source, /const history = attempts\.filter\(attemptIsComplete\)/)
  const template = readFileSync(require.resolve('../assessment/center/index.wxml'), 'utf8')
  assert.match(template, /loaded && !model\.history\.records\.length/)
})
