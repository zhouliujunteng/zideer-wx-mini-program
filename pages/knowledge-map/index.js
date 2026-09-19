const { loadKnowledgeMap, loadKnowledgeTopic } = require('../../services/identity')
const { buildKnowledgeRelationGraph } = require('../../utils/knowledge-map-relations')
const { layoutKnowledgeRadially, spaceRadialCards } = require('../../utils/knowledge-map-radial')
const { attachUiAssets } = require('../../services/ui-assets')
const {
  getKnowledgeMapTextCardMetrics,
  getKnowledgeMapLayoutProfile,
  projectKnowledgeMapPoint,
  getKnowledgeMapCardMetrics,
  buildBezierEdgeGeometry,
  getKnowledgeMapPresentation,
  distanceToRoundedRect,
  shouldShowKnowledgeMapLabel,
  getKnowledgeMapStatusMarkMetrics,
  getKnowledgeMapConnectionPortMetrics,
  getVisibleCanvasRect,
  pointInRoundedRect,
  rectIntersectsRect,
  expandRect,
  getBounds
} = require('../../utils/knowledge-map-geometry')
const {
  createFrameLatencyTracker,
  createPerfMetrics
} = require('../../utils/perf-metrics')

const CANVAS_SHEET_FOLLOW_RATIO = 0.16
const SHEET_DIRECTION_EPSILON = 8
const SHEET_SETTLE_EPSILON = 2
const SHEET_ANIMATION_DURATION = 420
const GRAPH_DPR_LIMIT = 2
const SELECTION_FLOW_FRAME_MS = 34
const STATUS_STYLES = {
  provisional: { fill: '#F0F4F8', stroke: '#7893AC', text: '#39443F', marker: '#7893AC' },
  assessed_stable: { fill: '#EDF5EF', stroke: '#4B8764', text: '#39443F', marker: '#4B8764' },
  unknown: { fill: '#FFFFFF', stroke: '#D8D8D5', text: '#39443F', marker: '#929995' },
  reinforce: { fill: '#FFFFFF', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' },
  learning: { fill: '#FFF2E8', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' },
  mastered: { fill: '#FFF2E8', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' }
}
const STATUS_LABELS = {
  unknown: '待测',
  provisional: '初测待复测',
  reinforce: '需巩固',
  assessed_stable: '测评较稳',
  learning: '学习中',
  mastered: '已掌握'
}

// Enrich a graph node in place with the display fields the topic sheet renders.
// Mutating keeps `selectedNode` identity stable for canvas hit-test comparisons.
function applyTopicDisplay(node) {
  const status = node.status || 'unknown'
  node.status = status
  node.statusLabel = STATUS_LABELS[status] || STATUS_LABELS.unknown
  node.metaLine = [node.gradeLabel, node.subjectName, node.volume, node.unit].filter(Boolean).join(' · ')
  if (Array.isArray(node.relatedLinks)) {
    const seen = new Set([String(node.id)])
    node.relatedLinks = node.relatedLinks.filter((link) => {
      if (!link || link.id == null || seen.has(String(link.id))) return false
      seen.add(String(link.id))
      return true
    })
  }
  return node
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}
function getTouchMidpoint(touches) {
  return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 }
}
function isDevelopEnvironment() {
  try {
    const accountInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return Boolean(accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion === 'develop')
  } catch (error) {
    return false
  }
}
function getUtf8Size(value) {
  try {
    return encodeURIComponent(JSON.stringify(value)).replace(/%[0-9A-F]{2}|./g, 'x').length
  } catch (error) {
    return 0
  }
}
function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}
function getBezierPoint(geometry, progress) {
  const t = clamp(progress, 0, 1)
  const inverse = 1 - t
  const { start, cp1, cp2, end } = geometry
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * cp1.x + 3 * inverse * t ** 2 * cp2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * cp1.y + 3 * inverse * t ** 2 * cp2.y + t ** 3 * end.y
  }
}
function liveGraphModel(map) {
  const status = { provisional:'provisional', assessed_stable:'assessed_stable', weak: 'reinforce', mastered: 'mastered', learning: 'learning', unknown: 'unknown' }
  const nodes = layoutKnowledgeRadially(map.nodes || [], map.edges || []).map(node => ({ ...node, status: status[node.status] || 'unknown', coreScore: 0.5 }))
  const universe = map.universe || {}
  const universeTopics = nodes
    .filter(node => node.status !== 'unknown')
    .sort((left, right) => {
      const priority = { mastered: 0, learning: 1, reinforce: 2, provisional: 3, assessed_stable: 4 }
      return (priority[left.status] || 9) - (priority[right.status] || 9)
    })
    .slice(0, 12)
    .map(node => ({
      id: node.id,
      label: node.label,
      status: node.status,
      statusLabel: STATUS_LABELS[node.status] || STATUS_LABELS.unknown,
      evidence: node.evidence || '学习记录已同步'
    }))
  return {
    viewModel: { notifications: { count: 0 }, legend: [{ key: 'unknown', label: '待测' }, { key: 'provisional', label: '初测待复测' }, { key: 'reinforce', label: '需巩固' }, { key: 'assessed_stable', label: '测评较稳' }, { key: 'learning', label: '学习中' }, { key: 'mastered', label: '已掌握' }], courses: (map.subjects || []).map(subject => ({ id: subject.key, title: subject.name, meta: map.semester || '当前年级知识点' })), activeCourseId: map.activeSubjectKey, activeCourse: {}, scopeLabel: [map.grade, map.semester].filter(Boolean).join(' · '), universeStats: [{key:'mastered',label:'累计掌握',value:Number(universe.masteredCount||0)},{key:'assessment',label:'测评证据',value:Number(universe.assessmentEvidenceCount||0)},{key:'course',label:'课程证据',value:Number(universe.courseEvidenceCount||0)}], universeTopics, emptyCopy: map.general ? '完成课程并通过 AI 复述验收后，新的知识点会进入你的学习宇宙。' : '完成首次测评，或通过一门课程的 AI 复述验收后，新的知识点会进入你的学习宇宙。', learningSummary: nodes.length ? `这个学习宇宙已累积 ${Number(universe.evidenceCount||0)} 条证据。当前学科已掌握 ${map.stats.mastered || 0} 个，需巩固 ${map.stats.weak || map.stats.reinforce || 0} 个。` : map.general ? '完成一门课程的 AI 复述验收后，你的学习宇宙会从第一个知识点开始生长。' : '完成首次测评后，你的学习宇宙会从第一个知识点开始生长。', termNote: map.unassignedTermCount ? `包含 ${map.unassignedTermCount} 个全年通用或来源未划分学期的知识点。` : '', tip: '点击知识图谱，查看知识点的前后关系。', isStressFixture: false },
    graphModel: { nodes, edges: map.edges || [], radial: true }
  }
}

function diagnosisView(map) {
  const entry=map.diagnostic||{mode:'unavailable'}
  const subject=map.activeSubject||'当前学科'
  const buttons={start:'开始测评',resume:'继续测评',report:'查看报告',unavailable:'题库准备中'}
  return {...entry,button:buttons[entry.mode]||buttons.unavailable,
    title:entry.mode==='report'?`${subject}测评后，看看我的掌握情况`:entry.mode==='resume'?'上次测评还没完成，继续了解自己':'这些知识点，我掌握了多少？',
    description:entry.mode==='unavailable'?`${subject}当前年级、学期的测评正在准备`:entry.mode==='report'?'图谱已根据作答更新，未测部分仍标为待测':`${subject} · ${map.semester||''} · 约 10–20 分钟 · 首次免费`}
}

Page({
  data: {
    model: {}, statusBarHeight: 20, navigationBarHeight: 44, menuButtonHeight: 32,
    contentTop: 80, canvasHeight: 620, sheetStart: 860, sheetTrigger: 100,
    canvasClipHeight: 620, canvasFollowOffset: 0, canvasControlOffset: 0, sheetMinOffset: 0, sheetSnapping: false, sheetVisualOffset: 0,
    notificationTop: 26, notificationRight: 100, metricsVisible: false, metricsCollapsed: false, metricsRows: [],
    zoomPercent: 100, diagnostic: null, diagnosticTop: 80,
    relationMode: false, relationLoading: false, relationError: '', prerequisiteLinks: [], successorLinks: [],
    activeView: 'universe'
  },

  onLoad() {
    attachUiAssets(this)
    this._mapSheetOffset = 0
    this._isMapSheetSnapping = false
    this._sheetGesture = null
    this._canvasInitGeneration = 0
    this._isPageVisible = true
    this._metrics = createPerfMetrics({ capacity: 180 })
    this._frameLatencyTracker = createFrameLatencyTracker((latency) => {
      this._metrics.record('frame-latency', latency)
    })
    this._isDevelop = isDevelopEnvironment()
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 32, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    // The diagnostic banner was removed from the template; the canvas starts
    // directly below the custom navigation bar instead of reserving its height.
    const diagnosticTop = statusBarHeight + navigationBarHeight + 10
    const contentTop = diagnosticTop
    const sheetStart = Math.round(contentTop * 750 / windowWidth + 760)
    const sheetStartPx = sheetStart * windowWidth / 750
    const sheetTrigger = Math.max(0, Math.round(sheetStartPx - (windowInfo.windowHeight || 667) / 2))
    const baseCanvasHeight = Math.max(180, sheetStartPx - contentTop)
    // windowHeight already excludes the native tab bar. Keep the grip inside that window.
    const collapsedPeek = 44 + 18 * windowWidth / 750
    const sheetMinOffset = Math.min(0, sheetStartPx - (windowInfo.windowHeight || 667) + collapsedPeek)
    const canvasHeight = baseCanvasHeight - sheetMinOffset
    this._baseCanvasHeight = baseCanvasHeight
    this._relationSheetOffset = clamp(sheetStartPx + 660 * windowWidth / 750 - (windowInfo.windowHeight || 667), 0, sheetTrigger)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop, diagnosticTop,
      canvasHeight,
      canvasClipHeight: baseCanvasHeight,
      canvasControlOffset: -sheetMinOffset,
      sheetMinOffset,
      sheetStart,
      sheetTrigger,
      sheetVisualOffset: 0,
      canvasFollowOffset: 0,
      sheetSnapping: false,
      notificationTop: menuButton.top,
      notificationRight: windowWidth - menuButton.left + 8,
      assessmentRight: windowWidth - menuButton.left + 8 + menuButton.height + 12
    })
  },

  openAssessmentCenter() {
    wx.navigateTo({ url: '/assessment/center/index' })
  },

  onReady() {
    this._pageReady = true
    if (this.data.activeView === 'graph') this.initializeCanvas()
  },
  async onShow() {
    this._isPageVisible = true
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/knowledge-map/index')
    if (this.data.activeView === 'graph' && this._canvas) this.requestGraphDraw()
    if (this.data.metricsVisible && !this.data.metricsCollapsed && !this._metricsTimer) this.startMetricsPanel()
    await this.loadKnowledgeMapCourse(this.data.activeSubjectKey)
  },
  onHide() {
    this._relationGeneration = (this._relationGeneration || 0) + 1
    this._knowledgeLoadGeneration = (this._knowledgeLoadGeneration || 0) + 1
    this._isPageVisible = false
    this.stopMetricsPanel()
    this.cancelSelectionFlowAnimation()
    this.cancelGraphDraw()
    this._frameLatencyTracker.reset()
  },
  onUnload() {
    this._relationGeneration = (this._relationGeneration || 0) + 1
    this._knowledgeLoadGeneration = (this._knowledgeLoadGeneration || 0) + 1
    this._isPageVisible = false
    this._canvasInitGeneration += 1
    if (this._mapSheetSnapTimer) clearTimeout(this._mapSheetSnapTimer)
    this.stopMetricsPanel()
    this.cancelSelectionFlowAnimation()
    this.cancelGraphDraw()
    this._canvas = null
    this._graphScene = null
    this._graphView = null
    this._mapGesture = null
    this._frameLatencyTracker.reset()
  },
  showNotifications() { wx.navigateTo({ url: '/pages/messages/index' }) },
  switchMapView(e) {
    const activeView = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.view
    if (!['universe', 'graph'].includes(activeView) || activeView === this.data.activeView) return
    if (activeView === 'universe') {
      this._canvasInitGeneration += 1
      this.cancelSelectionFlowAnimation()
      this.cancelGraphDraw()
      this.stopMetricsPanel()
      this._canvas = null
      this._graphScene = null
      this._graphView = null
      this.setData({ activeView, metricsVisible: false })
      return
    }
    this.setData({ activeView, metricsVisible: false }, () => {
      if (this._pageReady && this.data.activeView === 'graph') this.initializeCanvas()
    })
  },
  openDiagnosis() {
    const d=this.data.diagnostic
    if(this.data.loading||!d||d.mode==='unavailable')return
    const url=d.attemptId?`/assessment/short/index?attemptId=${encodeURIComponent(d.attemptId)}`:`/assessment/short/index?scopeId=${encodeURIComponent(d.scopeId)}&subjectKey=${encodeURIComponent(this.data.activeSubjectKey)}`
    wx.navigateTo({url})
  },
  editLearningScope() { wx.navigateTo({ url: '/pages/profile-setup/index?edit=1' }) },

  async loadKnowledgeMapCourse(courseId) {
    this._relationGeneration = (this._relationGeneration || 0) + 1
    this._overviewGraphModel = null
    this._overviewGraphView = null
    const generation = (this._knowledgeLoadGeneration || 0) + 1
    this._knowledgeLoadGeneration = generation
    this.cancelSelectionFlowAnimation()
    this.cancelGraphDraw()
    this.stopMetricsPanel()
    this._metrics.reset()
    this._frameLatencyTracker.reset()
    const startedAt = this._metrics.now()
    this._graphModel = { nodes: [], edges: [] }
    this._selectedNodeId = null
    this.setData({ loading: true, loadError: '', diagnostic: null, selectedNode: null, model: {}, relationMode: false, relationLoading: false, relationError: '', prerequisiteLinks: [], successorLinks: [] }, () => {
      if (this._canvas) { this.buildGraphScene(); this.requestGraphDraw() }
    })
    try {
      const map = await loadKnowledgeMap(courseId)
      if (generation !== this._knowledgeLoadGeneration) return
      const { viewModel, graphModel } = liveGraphModel(map)
      this._metrics.record('model', this._metrics.now() - startedAt)
      this._graphModel = graphModel
      this._overviewGraphModel = graphModel
      this._viewModelBytes = getUtf8Size(viewModel)
      this.setData({ model: viewModel, diagnostic: diagnosisView(map), activeSubjectKey: map.activeSubjectKey, loading: false, metricsVisible: false, metricsRows: [] }, () => {
        if (!this._pageReady || this.data.activeView !== 'graph') return
        if (!this._canvas) this.initializeCanvas()
        else { this.buildGraphScene(); this.resetGraphView() }
      })
    } catch (error) {
      if (generation !== this._knowledgeLoadGeneration) return
      this.setData({ loading: false, loadError: error.message || '知识图谱加载失败', model: {} })
      wx.showToast({ title: error.message || '知识图谱加载失败', icon: 'none' })
    }
  },

  async selectKnowledgeNode(node) {
    if (!node || !node.id) return
    const generation = (this._relationGeneration || 0) + 1
    this._relationGeneration = generation
    if (!this.data.relationMode) {
      this._overviewGraphModel = this._graphModel
      this._overviewGraphView = this._graphView && { ...this._graphView }
      this._overviewSheetOffset = this._mapSheetOffset || 0
      if (this._relationSheetOffset > this._overviewSheetOffset) this.updateMapSheetPosition(this._relationSheetOffset)
    }
    this.cancelSelectionFlowAnimation()
    this._selectedNodeId = String(node.id)
    this._selectionFlowStartedAt = this._metrics.now()
    this._graphModel = buildKnowledgeRelationGraph({ id: node.id, label: node.label }, (this._overviewGraphModel || {}).nodes)
    this.setData({ selectedNode: applyTopicDisplay(node), relationMode: true, relationLoading: true, relationError: '', prerequisiteLinks: [], successorLinks: [] })
    this.buildGraphScene()
    this.resetGraphView()
    try {
      const detail = await loadKnowledgeTopic(node.id)
      if (generation !== this._relationGeneration || this._isPageVisible === false) return
      const graph = buildKnowledgeRelationGraph(detail, (this._overviewGraphModel || {}).nodes)
      this._graphModel = graph
      this.setData({ selectedNode: applyTopicDisplay(graph.nodes[0]), relationLoading: false, prerequisiteLinks: graph.prerequisites, successorLinks: graph.successors })
      this.buildGraphScene()
      this.resetGraphView()
    } catch (error) {
      if (generation !== this._relationGeneration || this._isPageVisible === false) return
      this.setData({ relationLoading: false, relationError: error.message || '关联知识点加载失败，请重试' })
    }
  },
  selectRelatedNode(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this._selectedNodeId) return
    const node = (this._graphModel.nodes || []).find(item => item.id === id)
    if (node) return this.selectKnowledgeNode(node)
    // Related links are not part of the drawn relation graph; their chips still
    // carry enough identity (id + label) to load a full detail view directly.
    const selected = this.data.selectedNode || {}
    const link = [].concat(selected.relatedLinks || [], this.data.prerequisiteLinks, this.data.successorLinks)
      .find(item => item && String(item.id) === id)
    if (link) this.selectKnowledgeNode({ id: link.id, label: link.label })
  },
  noopSheetTouch() {},
  retryRelations() { return this.selectKnowledgeNode(this.data.selectedNode) },
  returnToOverview() {
    this._relationGeneration = (this._relationGeneration || 0) + 1
    this.cancelSelectionFlowAnimation()
    this._selectedNodeId = null
    this._graphModel = this._overviewGraphModel || this._graphModel
    if (this._overviewSheetOffset != null && this.data.sheetTrigger != null) this.updateMapSheetPosition(this._overviewSheetOffset)
    this.setData({ selectedNode: null, relationMode: false, relationLoading: false, relationError: '', prerequisiteLinks: [], successorLinks: [] })
    this.buildGraphScene()
    this.resetGraphView()
    if (this._overviewGraphView && this._canvas) {
      this._graphView = { ...this._overviewGraphView }
      this.setData({ zoomPercent: Math.round(this._graphView.scale * 100) })
      this.requestGraphDraw()
    }
  },

  initializeCanvas() {
    const generation = ++this._canvasInitGeneration
    const query = wx.createSelectorQuery().in(this)
    query.select('#knowledge-map-canvas').fields({ node: true, size: true })
    query.select('#knowledge-map-canvas').boundingClientRect()
    query.exec((result) => {
      if (generation !== this._canvasInitGeneration) return
      const info = result[0]
      const rect = result[1]
      if (!info || !info.node || !info.width || !info.height) return
      this.cancelGraphDraw()
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const pixelRatio = Math.min(windowInfo.pixelRatio || 1, GRAPH_DPR_LIMIT)
      const context = info.node.getContext('2d')
      info.node.width = Math.round(info.width * pixelRatio)
      info.node.height = Math.round(info.height * pixelRatio)
      context.scale(pixelRatio, pixelRatio)
      this._canvas = {
        node: info.node,
        context,
        width: info.width,
        height: info.height,
        left: rect ? rect.left : 0,
        top: rect ? rect.top : 0,
        pixelRatio
      }
      this.buildGraphScene()
      this.resetGraphView()
    })
  },

  graphPoint(node) {
    return projectKnowledgeMapPoint(node.layout, this._graphLayoutProfile)
  },
  getNodeCardMetrics(node) {
    return getKnowledgeMapCardMetrics(node.nodeType)
  },
  buildGraphScene() {
    if (!this._canvas) return
    const startedAt = this._metrics.now()
    const { context } = this._canvas
    const { nodes = [], edges = [] } = this._graphModel || {}
    this._graphLayoutProfile = getKnowledgeMapLayoutProfile(nodes.length)
    if (this._graphModel.radial) this._graphLayoutProfile = { ...this._graphLayoutProfile, scaleX: 1, scaleY: 1 }
    let cards = nodes.map((node, drawIndex) => {
      const point = this.graphPoint(node)
      const base = this.getNodeCardMetrics(node)
      context.font = `${base.fontWeight} ${base.fontSize}px sans-serif`
      const metrics = getKnowledgeMapTextCardMetrics(node.nodeType, node.label, text => context.measureText(text).width)
      const card = {
        x: point.x - metrics.width / 2,
        y: point.y - metrics.height / 2,
        width: metrics.width,
        height: metrics.height,
        radius: metrics.radius,
        centerX: point.x,
        centerY: point.y,
        fontSize: metrics.fontSize,
        fontWeight: metrics.fontWeight,
        lineHeight: metrics.lineHeight,
        lines: metrics.lines,
        node,
        drawIndex,
        portSides: new Set()
      }
      return card
    })
    if (this._graphModel.radial) cards = spaceRadialCards(cards)
    const cardById = Object.create(null)
    cards.forEach((card) => { cardById[card.node.id] = card })
    const resolvedEdges = []
    edges.forEach((edge) => {
      const fromCard = cardById[edge.from]
      const toCard = cardById[edge.to]
      if (!fromCard || !toCard) return
      const geometry = buildBezierEdgeGeometry(fromCard, toCard, 0, Number(edge.id) % 2 ? 1 : -1)
      fromCard.portSides.add(geometry.sourceSide)
      toCard.portSides.add(geometry.targetSide)
      resolvedEdges.push({ ...edge, geometry })
    })
    const bounds = getBounds(cards, 22)
    const rootCard = cards.find((card) => card.node.nodeType === 'domain_root') || cards[0] || null
    this._graphScene = { cards, cardById, edges: resolvedEdges, bounds, rootCard }
    this._metrics.record('scene', this._metrics.now() - startedAt)
  },
  getGraphPresentation() {
    const scene = this._graphScene
    const { width, height } = this._canvas
    return getKnowledgeMapPresentation({
      nodeCount: scene ? scene.cards.length : 0,
      bounds: scene && scene.bounds,
      viewportWidth: width,
      viewportHeight: this.data.canvasClipHeight || height
    })
  },
  resetGraphView() {
    if (!this._canvas || !this._graphScene) return
    this._graphPresentation = this.getGraphPresentation()
    if (this.data.relationMode) {
      const visible = getVisibleCanvasRect(this._canvas.width, this._canvas.height, this.data.canvasClipHeight, this.data.canvasFollowOffset, true)
      const bounds = this._graphScene.bounds
      // Fit symmetrically around the selected center, inside the visible canvas above the sheet.
      const halfWidth = Math.max(Math.abs(bounds.x), Math.abs(bounds.x + bounds.width), 1)
      const halfHeight = Math.max(Math.abs(bounds.y), Math.abs(bounds.y + bounds.height), 1)
      const scale = Math.max(0.1, Math.min(1, (visible.width - 32) / (halfWidth * 2), (visible.height - 100) / (halfHeight * 2)))
      this._graphPresentation.minScale = Math.min(this._graphPresentation.minScale, scale)
      this._graphView = { scale, x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 }
      this.setData({ zoomPercent: Math.round(scale * 100) })
      this.requestGraphDraw()
      return
    }
    const scale = this._graphPresentation.defaultScale
    const visible = this.getVisibleCanvasRect()
    const bounds = this._graphScene.bounds
    const rootCard = this._graphScene.rootCard
    const focusRoot = this._graphPresentation.initialFocus === 'root' && rootCard
    this._graphView = focusRoot
      ? {
          scale,
          x: this._canvas.width * (this._graphModel.radial ? 0.5 : 0.24) - rootCard.centerX * scale,
          y: visible.y + visible.height / 2 - rootCard.centerY * scale
        }
      : {
          scale,
          x: this._canvas.width / 2 - (bounds.x + bounds.width / 2) * scale,
          y: visible.y + visible.height / 2 - (bounds.y + bounds.height / 2) * scale
        }
    this._graphView = this.clampGraphView(scale, this._graphView.x, this._graphView.y)
    this._selectedNodeId = null
    this.cancelSelectionFlowAnimation()
    this.setData({ selectedNode: null })
    const zoomPercent = Math.round(scale * 100)
    if (this.data.zoomPercent !== zoomPercent) this.setData({ zoomPercent })
    this.requestGraphDraw()
  },

  cancelGraphDraw() {
    if (this._drawHandle == null) return
    if (this._drawHandleType === 'raf' && this._canvas && this._canvas.node.cancelAnimationFrame) {
      this._canvas.node.cancelAnimationFrame(this._drawHandle)
    } else {
      clearTimeout(this._drawHandle)
    }
    this._drawHandle = null
    this._drawHandleType = null
    this._frameLatencyTracker.reset()
  },
  requestGraphDraw() {
    if (!this._canvas || this._drawHandle != null) return
    this._frameLatencyTracker.request(this._metrics.now(), Boolean(this._mapGesture))
    const draw = () => {
      this._drawHandle = null
      this._drawHandleType = null
      this._frameLatencyTracker.finish(this._metrics.now())
      this.drawGraph()
    }
    if (this._canvas.node.requestAnimationFrame) {
      this._drawHandleType = 'raf'
      this._drawHandle = this._canvas.node.requestAnimationFrame(draw)
    } else {
      this._drawHandleType = 'timer'
      this._drawHandle = setTimeout(draw, 16)
    }
  },
  getVisibleCanvasRect() {
    const { width, height } = this._canvas
    return getVisibleCanvasRect(
      width,
      height,
      this.data.canvasClipHeight,
      this.data.canvasFollowOffset,
      true
    )
  },
  getVisibleWorldRect(canvasRect) {
    const { scale, x, y } = this._graphView
    return expandRect({
      x: (canvasRect.x - x) / scale,
      y: (canvasRect.y - y) / scale,
      width: canvasRect.width / scale,
      height: canvasRect.height / scale
    }, 28 / scale)
  },
  drawGraph() {
    if (!this._canvas || !this._graphView || !this._graphScene) return
    const startedAt = this._metrics.now()
    const { context, width, height } = this._canvas
    const { scale, x, y } = this._graphView
    const visibleCanvasRect = this.getVisibleCanvasRect()
    const viewport = this.getVisibleWorldRect(visibleCanvasRect)
    const gestureLod = Boolean(this._mapGesture)
    const visibleEdges = this._graphScene.edges.filter((edge) =>
      (!gestureLod || edge.strength === 'hard') && rectIntersectsRect(edge.geometry.bounds, viewport)
    )
    const visibleCards = this._graphScene.cards.filter((card) => rectIntersectsRect(card, viewport))
    const selectedNodeId = this._selectedNodeId
    const relatedEdges = selectedNodeId
      ? visibleEdges.filter((edge) => edge.from === selectedNodeId || edge.to === selectedNodeId)
      : []
    const relatedEdgeIds = new Set(relatedEdges.map((edge) => edge.id))
    const baseEdges = selectedNodeId
      ? visibleEdges.filter((edge) => !relatedEdgeIds.has(edge.id))
      : visibleEdges

    context.clearRect(0, 0, width, height)
    this.drawDotField(context, visibleCanvasRect)
    context.save()
    context.beginPath()
    context.rect(
      visibleCanvasRect.x,
      visibleCanvasRect.y,
      visibleCanvasRect.width,
      visibleCanvasRect.height
    )
    context.clip()
    context.translate(x, y)
    context.scale(scale, scale)
    this.drawEdgeGroup(context, baseEdges.filter((edge) => edge.strength === 'hard'), 'hard', scale, Boolean(selectedNodeId))
    if (!gestureLod) this.drawEdgeGroup(context, baseEdges.filter((edge) => edge.strength !== 'hard'), 'soft', scale, Boolean(selectedNodeId))
    if (relatedEdges.length) this.drawConvergenceEdges(context, relatedEdges, scale)

    const selectedCard = visibleCards.find((card) => card.node.id === selectedNodeId)
    visibleCards.forEach((card) => {
      if (!selectedCard || card !== selectedCard) {
        this.drawNodeCard(context, card, scale, gestureLod)
      }
    })
    if (selectedCard) this.drawNodeCard(context, selectedCard, scale, gestureLod)
    context.restore()

    this._lastVisibleCounts = { nodes: visibleCards.length, edges: visibleEdges.length }
    this._metrics.increment('render')
    this._metrics.record(gestureLod ? 'draw-gesture' : 'draw-full', this._metrics.now() - startedAt)
    if (selectedNodeId && relatedEdges.length && !gestureLod) this.scheduleSelectionFlowAnimation()
  },
  drawDotField(context, canvasRect) {
    const right = canvasRect.x + canvasRect.width
    const bottom = canvasRect.y + canvasRect.height
    const startX = Math.floor(canvasRect.x / 26) * 26
    const startY = Math.floor(canvasRect.y / 26) * 26
    context.save()
    context.beginPath()
    context.rect(canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height)
    context.clip()
    context.fillStyle = 'rgba(220, 170, 126, 0.24)'
    context.beginPath()
    for (let x = startX; x < right + 26; x += 26) {
      for (let y = startY; y < bottom + 26; y += 26) {
        context.moveTo(x + 1, y)
        context.arc(x, y, 1, 0, Math.PI * 2)
      }
    }
    context.fill()
    context.restore()
  },
  drawEdgeGroup(context, edges, strength, scale, dimmed = false) {
    if (!edges.length) return
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const inverseScale = 1 / Math.max(scale, 0.16)
    context.lineWidth = (strength === 'hard' ? 0.8 : 0.65) * inverseScale
    context.strokeStyle = strength === 'hard'
      ? `rgba(210, 112, 31, ${dimmed ? 0.045 : 0.12})`
      : `rgba(221, 166, 119, ${dimmed ? 0.03 : 0.08})`
    context.setLineDash(strength === 'hard' ? [] : [4 * inverseScale, 5 * inverseScale])
    context.beginPath()
    edges.forEach((edge) => {
      const { start, cp1, cp2, end } = edge.geometry
      context.moveTo(start.x, start.y)
      context.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y)
    })
    context.stroke()
    context.setLineDash([])
    context.restore()
  },
  drawConvergenceEdges(context, edges, scale) {
    if (!edges.length || !this._selectedNodeId) return
    const inverseScale = 1 / Math.max(scale, 0.16)
    const elapsed = this._metrics.now() - (this._selectionFlowStartedAt || 0)
    const phase = ((elapsed % 1350) + 1350) % 1350 / 1350
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = 2.15 * inverseScale
    context.strokeStyle = 'rgba(253, 124, 2, 0.88)'
    context.setLineDash([7 * inverseScale, 7 * inverseScale])
    context.lineDashOffset = -phase * 28 * inverseScale
    context.beginPath()
    edges.forEach((edge) => {
      const { start, cp1, cp2, end } = edge.geometry
      context.moveTo(start.x, start.y)
      context.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y)
    })
    context.stroke()
    context.setLineDash([])

    edges.slice(0, 80).forEach((edge, index) => {
      const travel = (phase + index * 0.11) % 1
      const towardSelected = this.data.relationMode || edge.to === this._selectedNodeId ? travel : 1 - travel
      const point = getBezierPoint(edge.geometry, towardSelected)
      context.beginPath()
      context.arc(point.x, point.y, 2.25 * inverseScale, 0, Math.PI * 2)
      context.fillStyle = '#FD7C02'
      context.fill()
      context.lineWidth = 0.8 * inverseScale
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      context.stroke()
    })
    context.restore()
  },
  drawRoundedRect(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.moveTo(x + corner, y)
    context.lineTo(x + width - corner, y)
    context.quadraticCurveTo(x + width, y, x + width, y + corner)
    context.lineTo(x + width, y + height - corner)
    context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height)
    context.lineTo(x + corner, y + height)
    context.quadraticCurveTo(x, y + height, x, y + height - corner)
    context.lineTo(x, y + corner)
    context.quadraticCurveTo(x, y, x + corner, y)
    context.closePath()
  },
  drawNodeCard(context, card, scale, gestureLod) {
    const isSelected = card.node.id === this._selectedNodeId
    const style = isSelected
      ? { fill: '#FD7C02', stroke: '#FD7C02', text: '#FFFFFF', marker: '#FFFFFF' }
      : STATUS_STYLES[card.node.status] || STATUS_STYLES.unknown
    context.save()
    if (isSelected) {
      context.shadowColor = 'rgba(120, 72, 31, 0.24)'
      context.shadowBlur = 10
      context.shadowOffsetY = 3
    }
    this.drawRoundedRect(context, card.x, card.y, card.width, card.height, card.radius)
    context.fillStyle = style.fill
    context.fill()
    context.shadowColor = 'transparent'
    context.shadowBlur = 0
    context.shadowOffsetY = 0
    context.lineWidth = (card.node.nodeType === 'domain_root' ? 1.6 : 1.05) / scale
    context.strokeStyle = style.stroke
    context.stroke()
    this.drawStatusMark(context, card, style.marker, scale)

    const showText = this.data.relationMode || shouldShowKnowledgeMapLabel(
      card.fontSize,
      scale,
      card.node.nodeType,
      gestureLod,
      isSelected,
      Boolean(this.data.model.isStressFixture)
    )
    if (showText && card.lines.length) {
      context.fillStyle = style.text
      context.font = `${card.fontWeight} ${card.fontSize}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const firstY = card.centerY - (card.lines.length - 1) * card.lineHeight / 2
      card.lines.forEach((line, index) => context.fillText(line, card.centerX, firstY + index * card.lineHeight))
    }
    this.drawConnectionPorts(context, card, scale)
    context.restore()
  },
  drawConnectionPorts(context, card, scale) {
    if (!card.portSides || !card.portSides.size) return
    const metrics = getKnowledgeMapConnectionPortMetrics(scale, card.height)
    const anchors = {
      top: { x: card.centerX, y: card.y },
      right: { x: card.x + card.width, y: card.centerY },
      bottom: { x: card.centerX, y: card.y + card.height },
      left: { x: card.x, y: card.centerY }
    }
    context.save()
    context.fillStyle = card.node.id === this._selectedNodeId ? '#FD7C02' : 'rgba(253, 124, 2, 0.28)'
    context.strokeStyle = '#FFFFFF'
    context.lineWidth = metrics.strokeWidth
    card.portSides.forEach((side) => {
      const anchor = anchors[side]
      if (!anchor) return
      context.beginPath()
      context.arc(anchor.x, anchor.y, metrics.radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    })
    context.restore()
  },
  drawStatusMark(context, card, color, scale) {
    const status = card.node.status
    const metrics = getKnowledgeMapStatusMarkMetrics(scale, card.height)
    const x = card.x + card.width - metrics.xInset
    const y = card.y + metrics.xInset
    context.save()
    context.strokeStyle = color
    context.fillStyle = color
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = metrics.lineWidth
    if (status === 'unknown') {
      context.beginPath()
      context.arc(x, y, metrics.radius, 0, Math.PI * 2)
      context.stroke()
    } else if (status === 'reinforce') {
      context.beginPath()
      context.moveTo(x - metrics.halfWidth, y)
      context.lineTo(x + metrics.halfWidth, y)
      context.stroke()
    } else if (status === 'mastered') {
      context.beginPath()
      context.moveTo(x - metrics.halfWidth, y)
      context.lineTo(x - metrics.lineWidth, y + metrics.checkDrop)
      context.lineTo(x + metrics.checkRun, y - metrics.checkRise)
      context.stroke()
    } else {
      context.beginPath()
      context.arc(x, y, metrics.radius, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  },

  getCanvasTouch(touch) {
    return {
      x: touch.clientX - this._canvas.left,
      y: touch.clientY - this._canvas.top + (this.data.canvasFollowOffset || 0)
    }
  },
  clampGraphView(scale, x, y) {
    const viewport = getVisibleCanvasRect(this._canvas.width, this._canvas.height, this.data.canvasClipHeight, this.data.canvasFollowOffset, true)
    const { width, height } = viewport
    let bounds = this._graphScene && this._graphScene.bounds
    if (!bounds) return { scale, x, y }
    if (this.data.relationMode) {
      const halfWidth = Math.max(Math.abs(bounds.x), Math.abs(bounds.x + bounds.width))
      const halfHeight = Math.max(Math.abs(bounds.y), Math.abs(bounds.y + bounds.height))
      bounds = { x: -halfWidth, y: -halfHeight, width: halfWidth * 2, height: halfHeight * 2 }
    }
    const panPadding = (this._graphPresentation && this._graphPresentation.panPadding) || 28
    const scaledWidth = bounds.width * scale
    const scaledHeight = bounds.height * scale
    const centeredX = viewport.x + (width - scaledWidth) / 2 - bounds.x * scale
    const centeredY = viewport.y + (height - scaledHeight) / 2 - bounds.y * scale
    let minX
    let maxX
    let minY
    let maxY
    if (scaledWidth <= width) {
      minX = centeredX - panPadding
      maxX = centeredX + panPadding
    } else {
      minX = viewport.x + width - panPadding - (bounds.x + bounds.width) * scale
      maxX = viewport.x + panPadding - bounds.x * scale
    }
    if (scaledHeight <= height) {
      minY = centeredY - panPadding
      maxY = centeredY + panPadding
    } else {
      minY = viewport.y + height - panPadding - (bounds.y + bounds.height) * scale
      maxY = viewport.y + panPadding - bounds.y * scale
    }
    return { scale, x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) }
  },

  handleMapTouchStart(e) {
    if (!this._canvas || this._isMapSheetSnapping) return
    this.cancelSelectionFlowAnimation()
    const touches = e.touches || []
    this._mapDidMove = false
    this._frameLatencyTracker.reset()
    if (touches.length >= 2) {
      const middle = getTouchMidpoint(touches)
      this._mapGesture = { type: 'pinch', distance: getTouchDistance(touches), midpoint: this.getCanvasTouch({ clientX: middle.x, clientY: middle.y }), startView: { ...this._graphView } }
      this.requestGraphDraw()
      return
    }
    if (touches.length) {
      this._mapGesture = { type: 'pan', point: this.getCanvasTouch(touches[0]), startView: { ...this._graphView } }
      this.requestGraphDraw()
    }
  },
  handleMapTouchMove(e) {
    const touches = e.touches || []
    if (!this._canvas || !this._mapGesture || !touches.length) return
    this._metrics.increment('touch')
    if (touches.length >= 2) {
      if (this._mapGesture.type !== 'pinch') { this.handleMapTouchStart(e); return }
      const middle = getTouchMidpoint(touches)
      const midpoint = this.getCanvasTouch({ clientX: middle.x, clientY: middle.y })
      const gesture = this._mapGesture
      const profile = this._graphPresentation
      const scale = clamp(gesture.startView.scale * getTouchDistance(touches) / Math.max(gesture.distance, 1), profile.minScale, profile.maxScale)
      const worldX = (gesture.midpoint.x - gesture.startView.x) / gesture.startView.scale
      const worldY = (gesture.midpoint.y - gesture.startView.y) / gesture.startView.scale
      this._graphView = this.clampGraphView(scale, midpoint.x - worldX * scale, midpoint.y - worldY * scale)
      this._mapDidMove = true
    } else if (this._mapGesture.type === 'pan') {
      const point = this.getCanvasTouch(touches[0])
      const dx = point.x - this._mapGesture.point.x
      const dy = point.y - this._mapGesture.point.y
      if (Math.abs(dx) + Math.abs(dy) > 3) this._mapDidMove = true
      this._graphView = this.clampGraphView(this._mapGesture.startView.scale, this._mapGesture.startView.x + dx, this._mapGesture.startView.y + dy)
    }
    this.requestGraphDraw()
  },
  handleMapTouchEnd(e) {
    const gesture = this._mapGesture
    this._mapGesture = null
    this._frameLatencyTracker.reset()
    if (gesture && gesture.type === 'pinch' && this._graphView) {
      const zoomPercent = Math.round(this._graphView.scale * 100)
      if (this.data.zoomPercent !== zoomPercent) this.setData({ zoomPercent })
    }
    if (e.type === 'touchcancel' || !gesture || this._mapDidMove || gesture.type !== 'pan' || !this._canvas) {
      this.requestGraphDraw()
      return
    }
    const touch = (e.changedTouches || [])[0]
    const hitNode = touch && this.findNodeAt(this.getCanvasTouch(touch))
    if (!hitNode) {
      if (this._selectedNodeId) {
        this.returnToOverview()
      }
      this.requestGraphDraw()
      return
    }
    if (hitNode.id !== this._selectedNodeId) return this.selectKnowledgeNode(hitNode)
  },
  findNodeAt(point) {
    if (!this._graphScene || !this._graphView) return null
    const scale = this._graphView.scale
    const graphPoint = {
      x: (point.x - this._graphView.x) / scale,
      y: (point.y - this._graphView.y) / scale
    }
    const cards = this._graphScene.cards
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      if (pointInRoundedRect(graphPoint, cards[index], 0)) return cards[index].node
    }

    const maxDistance = 9 / scale
    let nearestCard = null
    let nearestDistance = Infinity
    for (let index = cards.length - 1; index >= 0; index -= 1) {
      const distance = distanceToRoundedRect(graphPoint, cards[index])
      if (distance <= maxDistance && distance < nearestDistance) {
        nearestCard = cards[index]
        nearestDistance = distance
      }
    }
    return nearestCard ? nearestCard.node : null
  },
  resetMap() { if (this.data.relationMode) this.returnToOverview(); else this.resetGraphView() },

  cancelSelectionFlowAnimation() {
    if (this._selectionFlowTimer) clearTimeout(this._selectionFlowTimer)
    this._selectionFlowTimer = null
  },
  scheduleSelectionFlowAnimation() {
    if (this._selectionFlowTimer || !this._selectedNodeId || !this._isPageVisible || this._mapGesture) return
    this._selectionFlowTimer = setTimeout(() => {
      this._selectionFlowTimer = null
      if (this._selectedNodeId && this._isPageVisible && !this._mapGesture) this.requestGraphDraw()
    }, SELECTION_FLOW_FRAME_MS)
  },

  startMetricsPanel() {
    this.stopMetricsPanel()
    this.updateMetricsPanel()
    this._metricsTimer = setInterval(() => this.updateMetricsPanel(), 500)
  },
  toggleMetricsPanel() {
    if (!this.data.metricsVisible) return
    const metricsCollapsed = !this.data.metricsCollapsed
    if (metricsCollapsed) this.stopMetricsPanel()
    this.setData({ metricsCollapsed }, () => {
      if (!metricsCollapsed && this._isPageVisible) this.startMetricsPanel()
    })
  },
  stopMetricsPanel() {
    if (this._metricsTimer) clearInterval(this._metricsTimer)
    this._metricsTimer = null
  },
  updateMetricsPanel() {
    if (!this.data.metricsVisible || this.data.metricsCollapsed || !this._canvas) return
    const full = this._metrics.summary('draw-full')
    const gesture = this._metrics.summary('draw-gesture')
    const frame = this._metrics.summary('frame-latency')
    const scene = this._metrics.summary('scene')
    const counts = this._lastVisibleCounts || { nodes: 0, edges: 0 }
    const totalNodes = (this._graphModel && this._graphModel.nodes.length) || 0
    const totalEdges = (this._graphModel && this._graphModel.edges.length) || 0
    const rows = [
      `总量 ${totalNodes} 节点 · ${totalEdges} 连线`,
      `可见 ${counts.nodes} 节点 · ${counts.edges} 连线`,
      `完整帧 ${formatMetric(full.median)} / ${formatMetric(full.p95)} / ${formatMetric(full.max)} ms`,
      `手势帧 ${formatMetric(gesture.median)} / ${formatMetric(gesture.p95)} / ${formatMetric(gesture.max)} ms`,
      `慢帧 >16.7 ${full.over16 + gesture.over16} · >33.3 ${full.over33 + gesture.over33} · 排队延迟 ${frame.over33}`,
      `触摸/绘制 ${this._metrics.count('touch')}/${this._metrics.count('render')} · DPR ${this._canvas.pixelRatio}`,
      `场景 ${formatMetric(scene.max)} ms · 数据 ${(this._viewModelBytes / 1024).toFixed(1)} KB`
    ]
    this.setData({ metricsRows: rows })
  },

  handleMapSheetTouchStart(e) {
    if (this._isMapSheetSnapping) return
    const touch = (e.touches || [])[0]
    if (!touch) return
    this._sheetGesture = { startX: touch.clientX, startY: touch.clientY, startTop: this._mapSheetOffset || 0, kind: null }
  },
  handleMapSheetTouchMove(e) {
    const touch = (e.touches || [])[0]
    if (!touch || !this._sheetGesture) return
    const gesture = this._sheetGesture
    const offsetX = touch.clientX - gesture.startX
    const offsetY = touch.clientY - gesture.startY
    if (!gesture.kind) {
      if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) < SHEET_DIRECTION_EPSILON) return
      gesture.kind = Math.abs(offsetY) > Math.abs(offsetX) ? 'vertical' : 'horizontal'
      if (gesture.kind === 'horizontal') return
    }
    if (gesture.kind !== 'vertical') return
    this.updateMapSheetPosition(gesture.startTop - offsetY)
  },
  handleMapSheetTouchEnd(e = {}) {
    if (!this._sheetGesture) return
    const gesture = this._sheetGesture
    this._sheetGesture = null
    if (gesture.kind !== 'vertical') return
    this.snapMapSheet(e.type === 'touchcancel' ? this._mapSheetOffset : gesture.startTop)
  },
  updateMapSheetPosition(scrollTop) {
    const boundedTop = clamp(scrollTop, this.data.sheetMinOffset || 0, this.data.sheetTrigger)
    const baseHeight = this._baseCanvasHeight == null ? this.data.canvasHeight : this._baseCanvasHeight
    const canvasClipHeight = clamp(baseHeight - boundedTop, 0, this.data.canvasHeight)
    this._mapSheetOffset = boundedTop
    this.setData({
      sheetVisualOffset: boundedTop,
      canvasFollowOffset: Math.round(Math.max(0, boundedTop) * CANVAS_SHEET_FOLLOW_RATIO * 10) / 10,
      canvasClipHeight,
      canvasControlOffset: this.data.canvasHeight - canvasClipHeight
    })
    if (this._canvas) this.requestGraphDraw()
  },
  toggleMapSheet() {
    if (this._isMapSheetSnapping) return
    const current = this._mapSheetOffset || 0
    const midpoint = ((this.data.sheetMinOffset || 0) + this.data.sheetTrigger) / 2
    this.snapMapSheet(current > midpoint ? current + 20 : current - 20)
  },
  snapMapSheet(startTop) {
    const current = this._mapSheetOffset || 0
    const delta = current - startTop
    let target
    if (delta > SHEET_DIRECTION_EPSILON) target = this.data.sheetTrigger
    else if (delta < -SHEET_DIRECTION_EPSILON) target = this.data.sheetMinOffset || 0
    else target = current >= ((this.data.sheetMinOffset || 0) + this.data.sheetTrigger) / 2 ? this.data.sheetTrigger : (this.data.sheetMinOffset || 0)
    if (Math.abs(target - current) <= SHEET_SETTLE_EPSILON) {
      this.updateMapSheetPosition(target)
      return
    }
    this._isMapSheetSnapping = true
    this.setData({ sheetSnapping: true })
    this.updateMapSheetPosition(target)
    this._mapSheetSnapTimer = setTimeout(() => {
      this._mapSheetOffset = target
      this._isMapSheetSnapping = false
      this._mapSheetSnapTimer = null
      this.setData({ sheetSnapping: false })
    }, SHEET_ANIMATION_DURATION)
  },
  selectCourse(e) {
    const courseId = e.currentTarget.dataset.id
    if (!courseId) return
    if (courseId === this.data.model.activeCourseId) { if (this.data.relationMode) this.returnToOverview(); return }
    this.loadKnowledgeMapCourse(courseId)
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },
  openSubjectAssessment() {
    const subjectKey = String(this.data.activeSubjectKey || '')
    if (!subjectKey) return wx.showToast({ title: '请先选择一个学科', icon: 'none' })
    wx.navigateTo({ url: `/assessment/short/index?subjectKey=${encodeURIComponent(subjectKey)}` })
  },
  openTopicDetail() {
    const node = this.data.selectedNode
    if (!node || !node.id) return
    wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${encodeURIComponent(node.id)}&subjectKey=${encodeURIComponent(node.subjectKey || this.data.activeSubjectKey)}` })
  }
})
