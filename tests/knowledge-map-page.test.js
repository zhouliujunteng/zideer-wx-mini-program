const assert = require('node:assert/strict')
const test = require('node:test')

const identity = require('../services/identity')
const pagePath = require.resolve('../pages/knowledge-map/index.js')

function loadPage(loadMap, loadTopic) {
  const original = identity.loadKnowledgeMap
  const originalTopic = identity.loadKnowledgeTopic
  identity.loadKnowledgeTopic = loadTopic || (async id => ({id, label: '一次函数', prerequisiteLinks: [], successorLinks: []}))
  identity.loadKnowledgeMap = loadMap || (async () => ({
    subjects: [{ key: 'Mathematics', name: '数学' }],
    activeSubject: '数学',
    activeSubjectKey: 'Mathematics',
    grade: '七年级',
    stats: { mastered: 0, learning: 0, weak: 0, unknown: 1 },
    nodes: [{ id: '81', label: '一次函数' }],
    edges: []
  }))
  delete require.cache[pagePath]

  let definition = null
  const navigations = []
  global.getApp = () => ({ globalData: { navigation: {} } })
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    showToast() {}
  }
  require(pagePath)
  identity.loadKnowledgeMap = original
  identity.loadKnowledgeTopic = originalTopic

  const instance = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

function prepareLiveLoader(instance) {
  for (const key of ['cancelSelectionFlowAnimation','cancelGraphDraw','stopMetricsPanel']) instance[key] = () => {}
  instance._metrics = { reset() {}, now: () => 1, record() {} }
  instance._frameLatencyTracker = { reset() {} }
}

function prepareRelations(instance) {
  prepareLiveLoader(instance)
  instance.requestGraphDraw = () => {}
  instance.buildGraphScene = () => {}
  instance.resetGraphView = () => {}
  instance._overviewGraphModel = {nodes:[{id:'81',label:'一次函数',status:'mastered'}],edges:[],radial:true}
  instance._graphModel = instance._overviewGraphModel
}

test('graph opens the matching subject diagnosis and resumes its existing report',()=>{
  const {instance,navigations}=loadPage();
  instance.data.activeSubjectKey='math';
  instance.data.diagnostic={mode:'start',scopeId:1};
  instance.openDiagnosis();
  assert.equal(navigations[0].url,'/assessment/short/index?scopeId=1&subjectKey=math');
  instance.data.diagnostic={mode:'report',scopeId:1,attemptId:12};
  instance.openDiagnosis();
  assert.equal(navigations[1].url,'/assessment/short/index?attemptId=12');
  instance.data.diagnostic={mode:'unavailable'};
  instance.openDiagnosis();
  assert.equal(navigations.length,2);
});

test('view switch initializes the graph only when it becomes visible and releases it on return to universe', () => {
  const { instance } = loadPage()
  let canvasInitializations = 0
  instance._pageReady = true
  instance.initializeCanvas = () => { canvasInitializations += 1 }
  instance.setData = function (values, callback) { Object.assign(this.data, values); if (callback) callback() }

  instance.switchMapView({ currentTarget: { dataset: { view: 'graph' } } })
  assert.equal(instance.data.activeView, 'graph')
  assert.equal(canvasInitializations, 1)

  instance.cancelSelectionFlowAnimation = () => {}
  instance.cancelGraphDraw = () => {}
  instance.stopMetricsPanel = () => {}
  instance._canvas = { id: 'graph' }
  instance._graphScene = { cards: [] }
  instance._graphView = { scale: 1 }
  instance.switchMapView({ currentTarget: { dataset: { view: 'universe' } } })
  assert.equal(instance.data.activeView, 'universe')
  assert.equal(instance._canvas, null)
  assert.equal(instance._graphScene, null)
})

for (const [width,height] of [[320,568],[390,762]]) test(`sheet drags to the bottom and back up at ${width} x ${height}`, () => {
  const {instance} = loadPage()
  global.wx.getWindowInfo = () => ({windowWidth:width,windowHeight:height,statusBarHeight:20})
  instance.onLoad()
  const initialHeight=instance.data.canvasClipHeight
  instance.handleMapSheetTouchStart({touches:[{clientX:120,clientY:400}]})
  instance.handleMapSheetTouchMove({touches:[{clientX:120,clientY:1400}]})
  instance.handleMapSheetTouchEnd()
  assert.ok(instance.data.sheetVisualOffset < 0, 'downward movement must pass the initial sheet position')
  assert.equal(instance.data.sheetVisualOffset,instance.data.sheetMinOffset)
  const peek=height-(instance.data.sheetStart*width/750-instance.data.sheetVisualOffset)
  assert.ok(peek>=44 && peek<=60, 'keep a reachable handle above the tab bar')
  assert.ok(instance.data.canvasClipHeight>initialHeight)
  assert.equal(instance.data.canvasClipHeight,instance.data.canvasHeight)
  assert.equal(instance.data.canvasControlOffset,0)
  assert.equal(instance.data.canvasFollowOffset,0)
  instance.handleMapSheetTouchStart({touches:[{clientX:120,clientY:height-25}]})
  instance.handleMapSheetTouchMove({touches:[{clientX:120,clientY:-1000}]})
  instance.handleMapSheetTouchEnd()
  assert.equal(instance.data.sheetVisualOffset,instance.data.sheetTrigger)
  assert.ok(instance.data.canvasClipHeight<initialHeight)
})

test('horizontal subject scrolling leaves the sheet position unchanged', () => {
  const {instance} = loadPage()
  instance.handleMapSheetTouchStart({touches:[{clientX:150,clientY:500}]})
  instance.handleMapSheetTouchMove({touches:[{clientX:40,clientY:510}]})
  instance.handleMapSheetTouchEnd()
  assert.equal(instance.data.sheetVisualOffset,0)
  assert.equal(instance._sheetGesture,null)
})

test('release settles at the lower stop and tapping the grip brings the sheet back', t => {
  t.mock.timers.enable({apis:['setTimeout']})
  const {instance} = loadPage()
  global.wx.getWindowInfo = () => ({windowWidth:390,windowHeight:762,statusBarHeight:20})
  instance.onLoad()
  instance.handleMapSheetTouchStart({touches:[{clientX:100,clientY:500}]})
  instance.handleMapSheetTouchMove({touches:[{clientX:100,clientY:540}]})
  instance.handleMapSheetTouchEnd()
  assert.equal(instance.data.sheetVisualOffset,instance.data.sheetMinOffset)
  assert.equal(instance.data.sheetSnapping,true)
  t.mock.timers.tick(420)
  assert.equal(instance.data.sheetSnapping,false)
  instance.toggleMapSheet()
  assert.equal(instance.data.sheetVisualOffset,instance.data.sheetTrigger)
  t.mock.timers.tick(420)
  assert.equal(instance._isMapSheetSnapping,false)
  instance.toggleMapSheet()
  assert.equal(instance.data.sheetVisualOffset,instance.data.sheetMinOffset)
  t.mock.timers.tick(420)
})

test('selecting and following prerequisites expands the graph without detail navigation', async () => {
  const calls = []
  const {instance,navigations} = loadPage(null, async id => {
    calls.push(id)
    return {id,label:id,prerequisiteLinks:id==='81'?[{id:'7',label:'有理数',gradeLabel:'七年级'}]:[],successorLinks:[]}
  })
  prepareRelations(instance)
  await instance.selectKnowledgeNode(instance._graphModel.nodes[0])
  assert.equal(instance.data.relationMode,true)
  assert.equal(instance._graphModel.nodes[0].status,'mastered')
  assert.equal(instance.data.prerequisiteLinks[0].id,'7')
  await instance.selectRelatedNode({currentTarget:{dataset:{id:'7'}}})
  assert.equal(instance._graphModel.nodes[0].id,'7')
  assert.deepEqual(instance.data.prerequisiteLinks,[])
  assert.equal(instance.data.relationLoading,false)
  await instance.selectRelatedNode({currentTarget:{dataset:{id:'forged'}}})
  assert.deepEqual(calls,['81','7'])
  assert.deepEqual(navigations,[])
})

test('rapid relation selection ignores late results and clears stale lists while loading', async () => {
  const pending = {}
  const {instance} = loadPage(null,id=>new Promise(resolve=>{pending[id]=resolve}))
  prepareRelations(instance)
  instance.data.prerequisiteLinks = [{id:'old'}]
  const first = instance.selectKnowledgeNode({id:'a',label:'甲'})
  const second = instance.selectKnowledgeNode({id:'b',label:'乙'})
  assert.deepEqual(instance.data.prerequisiteLinks,[])
  pending.b({id:'b',label:'乙',successorLinks:[{id:'c',label:'丙'}]}); await second
  pending.a({id:'a',label:'甲'}); await first
  assert.equal(instance.data.selectedNode.id,'b')
  assert.equal(instance._graphModel.nodes[0].id,'b')
  assert.equal(instance.data.successorLinks[0].id,'c')
})

test('relation failure stays on selected center and can retry without false empty state', async () => {
  let fail = true
  const {instance} = loadPage(null,async id=>{if(fail) throw new Error('网络断开'); return {id,label:'一次函数'}})
  prepareRelations(instance)
  await instance.selectKnowledgeNode(instance._graphModel.nodes[0])
  assert.equal(instance.data.relationError,'网络断开')
  assert.equal(instance._graphModel.nodes.length,1)
  fail=false
  await instance.retryRelations()
  assert.equal(instance.data.relationError,'')
  assert.equal(instance.data.relationLoading,false)
})

test('focused graph fits the exposed canvas and pinch starts without a zoom jump', () => {
  const {instance} = loadPage()
  prepareLiveLoader(instance)
  instance.requestGraphDraw = () => {}
  instance._canvas = {width:320,height:380}
  instance._graphScene = {cards:Array(8).fill({}),bounds:{x:-400,y:-230,width:800,height:460}}
  instance.data.relationMode=true
  instance.data.selectedNode={id:'81'}
  instance._selectedNodeId='81'
  instance.data.canvasClipHeight=220
  instance.data.canvasFollowOffset=25
  instance.resetGraphView()
  const view=instance._graphView
  assert.equal(view.y,135)
  assert.ok(view.y - 230 * view.scale >= 25)
  assert.ok(view.y + 230 * view.scale <= 245)
  assert.ok(instance._graphPresentation.minScale <= view.scale)
  assert.deepEqual(instance.clampGraphView(view.scale,view.x,view.y),view)
  assert.equal(instance.data.selectedNode.id,'81')
})

test('a short screen raises the relation sheet and returning restores its previous position', async () => {
  const {instance} = loadPage()
  global.wx.getWindowInfo = () => ({windowWidth:320,windowHeight:568,statusBarHeight:20})
  instance.onLoad()
  prepareRelations(instance)
  await instance.selectKnowledgeNode(instance._graphModel.nodes[0])
  assert.ok(instance.data.sheetVisualOffset > 0)
  assert.ok(instance.data.sheetStart * 320 / 750 - instance.data.sheetVisualOffset + 500 * 320 / 750 <= 568)
  instance.returnToOverview()
  assert.equal(instance.data.sheetVisualOffset,0)
})

for (const action of ['returnToOverview','resetMap','onHide','onUnload','loadKnowledgeMapCourse']) {
  test(`${action} invalidates pending relation results`, async () => {
    let resolve
    const {instance} = loadPage(null,()=>new Promise(done=>{resolve=done}))
    prepareRelations(instance)
    const overview=instance._overviewGraphModel
    const request=instance.selectKnowledgeNode(overview.nodes[0])
    await instance[action]()
    resolve({id:'81',label:'过期',successorLinks:[{id:'old',label:'过期关联'}]})
    await request
    assert.equal(instance._graphModel.nodes.some(n=>n.id==='old'),false)
    if (action==='returnToOverview'||action==='resetMap') {
      assert.equal(instance._graphModel,overview)
      assert.equal(instance.data.selectedNode,null)
      assert.equal(instance.data.relationMode,false)
    }
  })
}

test('rapid subject changes keep the latest live graph and never show an earlier result', async () => {
  const pending = {}
  const {definition,instance} = loadPage(subject => new Promise(resolve => {pending[subject] = resolve}))
  prepareLiveLoader(instance)
  const math = definition.loadKnowledgeMapCourse.call(instance, 'math')
  const chi = definition.loadKnowledgeMapCourse.call(instance, 'chi')
  const model = subject => ({subjects:[{key:'math',name:'数学'},{key:'chi',name:'语文'}],activeSubjectKey:subject,grade:'八年级',stats:{},nodes:[{id:subject,label:subject}],edges:[]})
  pending.chi(model('chi')); await chi
  pending.math(model('math')); await math
  assert.equal(instance.data.activeSubjectKey,'chi')
  assert.equal(instance._graphModel.nodes[0].id,'chi')
  assert.equal(instance.data.model.courses.length,2)
})

test('a live graph failure clears prior nodes and exposes an error without demo fallback', async () => {
  const {definition,instance} = loadPage(async () => {throw new Error('服务暂不可用')})
  prepareLiveLoader(instance)
  instance._graphModel = {nodes:[{id:'old'}],edges:[]}
  await definition.loadKnowledgeMapCourse.call(instance,'math')
  assert.deepEqual(instance._graphModel.nodes,[])
  assert.equal(instance.data.loadError,'服务暂不可用')
  assert.deepEqual(instance.data.model,{})
})
test('returning from profile changes hides the previous grade during reload and labels the new semester', async () => {
  let resolve
  const {definition,instance} = loadPage(() => new Promise(done => {resolve=done}))
  prepareLiveLoader(instance)
  instance.data.model = {courses:[{title:'八年级数学'}]}
  const pending = definition.loadKnowledgeMapCourse.call(instance,'math')
  assert.deepEqual(instance.data.model, {})
  resolve({subjects:[{key:'math',name:'数学'}],activeSubjectKey:'math',grade:'七年级',semester:'下学期',stats:{},nodes:[],edges:[]})
  await pending
  assert.match(instance.data.model.courses[0].meta, /下学期/)
  assert.match(instance.data.model.scopeLabel, /七年级.*下学期/)
  assert.equal(instance.data.model.courses[0].title, '数学')
})

test('knowledge map opens the current node detail and has no obsolete candidate placeholder action', () => {
  const { definition, instance, navigations } = loadPage()
  instance.setData({ selectedNode: { id: '81' }, activeSubjectKey: 'Mathematics' })

  definition.openTopicDetail.call(instance)

  assert.deepEqual(navigations, [{
    url: '/diagnosis/topic/index?topicId=81&subjectKey=Mathematics'
  }])
  assert.equal(definition.addToPlan, undefined)
})

test('knowledge map does not navigate when no node is selected', () => {
  const { definition, instance, navigations } = loadPage()

  definition.openTopicDetail.call(instance)

  assert.deepEqual(navigations, [])
})

test('knowledge map starts the assessment flow for the active subject', () => {
  const { definition, instance, navigations } = loadPage()
  instance.setData({ activeSubjectKey: 'Mathematics' })

  definition.openSubjectAssessment.call(instance)

  assert.deepEqual(navigations, [{ url: '/assessment/short/index?subjectKey=Mathematics' }])
})

test('tapping selects without navigating and tapping blank space clears selection', () => {
  const { definition, instance, navigations } = loadPage()
  prepareLiveLoader(instance)
  instance._canvas = {}
  instance.requestGraphDraw = () => {}
  instance.buildGraphScene = () => {}
  instance.resetGraphView = () => {}
  instance.getCanvasTouch = touch => touch
  const node = { id: '81', label: '一次函数' }
  instance.findNodeAt = () => node
  instance._mapGesture = { type: 'pan' }
  definition.handleMapTouchEnd.call(instance, { changedTouches: [{ x: 1, y: 1 }] })
  assert.equal(instance.data.selectedNode, node)
  assert.equal(instance._selectedNodeId, '81')
  assert.deepEqual(navigations, [])
  instance.findNodeAt = () => null
  instance._mapGesture = { type: 'pan' }
  definition.handleMapTouchEnd.call(instance, { changedTouches: [{ x: 100, y: 100 }] })
  assert.equal(instance.data.selectedNode, null)
  assert.equal(instance._selectedNodeId, null)
})

test('selected cards paint theme orange with white text without changing mastery status', () => {
  const { definition, instance } = loadPage()
  instance._selectedNodeId = '81'
  instance.drawRoundedRect = () => {}
  instance.drawStatusMark = () => {}
  instance.drawConnectionPorts = () => {}
  const fills = [], texts = []
  const context = { save() {}, restore() {}, stroke() {}, fill() { fills.push(this.fillStyle) }, fillText() { texts.push(this.fillStyle) } }
  const card = { node: { id:'81', status:'mastered', nodeType:'topic' }, lines:['知识点'], fontSize:10, lineHeight:12, centerX:0, centerY:0 }
  definition.drawNodeCard.call(instance,context,card,1,false)
  assert.deepEqual(fills,['#FD7C02'])
  assert.deepEqual(texts,['#FFFFFF'])
  assert.equal(card.node.status,'mastered')
  instance._selectedNodeId = null
  definition.drawNodeCard.call(instance,context,card,1,false)
  assert.equal(fills.at(-1),'#FFF2E8')
})

test('selected topic carries sheet detail fields and related chips load nodes outside the graph', async () => {
  const detail = {
    id: '81', label: '一次函数', gradeLabel: '七年级', subjectName: '数学', volume: '下册', unit: '第2章',
    description: '函数入门', masteryStandard: '能画出一次函数图像', evidence: '已汇集 2 条学习证据',
    prerequisiteLinks: [], successorLinks: [],
    relatedLinks: [{ id: '9', label: '平面直角坐标系', gradeLabel: '七年级' }, { id: '9', label: '重复项' }, { id: '81', label: '自身' }]
  }
  const { instance } = loadPage(null, async id => String(id) === '81'
    ? detail
    : { id: String(id), label: '平面直角坐标系', prerequisiteLinks: [], successorLinks: [], relatedLinks: [] })
  prepareRelations(instance)
  await instance.selectKnowledgeNode(instance._graphModel.nodes[0])
  const node = instance.data.selectedNode
  assert.equal(node.status, 'mastered')
  assert.equal(node.statusLabel, '已掌握')
  assert.equal(node.metaLine, '七年级 · 数学 · 下册 · 第2章')
  assert.deepEqual(node.relatedLinks.map(link => link.id), ['9'])
  await instance.selectRelatedNode({ currentTarget: { dataset: { id: '9' } } })
  assert.equal(instance.data.selectedNode.id, '9')
  assert.equal(instance.data.selectedNode.label, '平面直角坐标系')
  assert.equal(instance.data.relationLoading, false)
})

for (const scenario of [
  { name: 'cancelled touch', type: 'touchcancel', gesture: 'pan', moved: false },
  { name: 'drag', type: 'touchend', gesture: 'pan', moved: true },
  { name: 'pinch', type: 'touchend', gesture: 'pinch', moved: false }
]) test(`${scenario.name} preserves selection without interpreting release as a tap`, () => {
  const { definition, instance, navigations } = loadPage()
  prepareLiveLoader(instance)
  instance._canvas = {}
  instance.requestGraphDraw = () => {}
  instance.getCanvasTouch = touch => touch
  const selected = { id: 'existing' }
  instance._selectedNodeId = selected.id
  instance.data.selectedNode = selected
  instance.findNodeAt = () => ({ id: 'unintended' })
  instance._mapGesture = { type: scenario.gesture }
  instance._mapDidMove = scenario.moved
  definition.handleMapTouchEnd.call(instance, { type: scenario.type, changedTouches: [{ x: 1, y: 1 }] })
  assert.equal(instance._selectedNodeId, selected.id)
  assert.equal(instance.data.selectedNode, selected)
  assert.equal(instance._mapGesture, null)
  assert.deepEqual(navigations, [])
})
