const { getKnowledgeMapModel } = require('../../services/mock-service')
const { loadKnowledgeMap } = require('../../services/identity')
const {
  fitTextLines,
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
  unknown: { fill: '#FFFFFF', stroke: '#D8D8D5', text: '#39443F', marker: '#929995' },
  reinforce: { fill: '#FFFFFF', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' },
  learning: { fill: '#FFF2E8', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' },
  mastered: { fill: '#FFF2E8', stroke: '#FD7C02', text: '#39443F', marker: '#FD7C02' }
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
  const status = { weak: 'reinforce', mastered: 'mastered', learning: 'learning', unknown: 'unknown' }
  const nodes = (map.nodes || []).map((node, index) => ({ ...node, status: status[node.status] || 'unknown', nodeType: index === 0 ? 'domain_root' : 'topic', coreScore: 0.5, layout: { x: 260 + (index % 5) * 220, y: 220 + Math.floor(index / 5) * 180, level: Math.floor(index / 5) } }))
  return {
    viewModel: { notifications: { count: 0 }, legend: [{ key: 'unknown', label: '待了解' }, { key: 'reinforce', label: '需巩固' }, { key: 'learning', label: '学习中' }, { key: 'mastered', label: '已掌握' }], courses: [{ id: map.activeSubjectKey, title: `${map.grade}${map.activeSubject}`, meta: '当前知识图谱', progress: null, progressLabel: '', hasProgress: false }], activeCourseId: map.activeSubjectKey, activeCourse: {}, learningSummary: `已掌握 ${map.stats.mastered || 0} 个，需巩固 ${map.stats.weak || 0} 个知识点。`, tip: '节点和连线来自当前学生的知识图谱数据。', isStressFixture: false },
    graphModel: { nodes, edges: map.edges || [] }
  }
}

Page({
  data: {
    model: {}, statusBarHeight: 20, navigationBarHeight: 44, menuButtonHeight: 32,
    contentTop: 80, canvasHeight: 620, sheetStart: 860, sheetTrigger: 100,
    canvasClipHeight: 620, canvasFollowOffset: 0, sheetSnapping: false, sheetVisualOffset: 0,
    notificationTop: 26, notificationRight: 100, metricsVisible: false, metricsCollapsed: false, metricsRows: [],
    zoomPercent: 100
  },

  onLoad() {
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
    const contentTop = statusBarHeight + navigationBarHeight + 10
    const sheetStart = Math.round(contentTop * 750 / windowWidth + 760)
    const sheetStartPx = sheetStart * windowWidth / 750
    const sheetTrigger = Math.max(0, Math.round(sheetStartPx - (windowInfo.windowHeight || 667) / 2))
    const canvasHeight = Math.max(180, sheetStartPx - contentTop)
    this.loadKnowledgeMapCourse(undefined, {
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop,
      canvasHeight,
      canvasClipHeight: canvasHeight,
      sheetStart,
      sheetTrigger,
      sheetVisualOffset: 0,
      canvasFollowOffset: 0,
      sheetSnapping: false,
      notificationTop: menuButton.top,
      notificationRight: windowWidth - menuButton.left + 8
    })
  },

  onReady() {
    this._pageReady = true
    this.initializeCanvas()
  },
  async onShow() {
    this._isPageVisible = true
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/knowledge-map/index')
    if (this._canvas) this.requestGraphDraw()
    if (this.data.metricsVisible && !this.data.metricsCollapsed && !this._metricsTimer) this.startMetricsPanel()
    try {
      const map = await loadKnowledgeMap()
      const live = liveGraphModel(map)
      this._graphModel = live.graphModel
      this._selectedNodeId = null
      this.setData({ model: live.viewModel }, () => { if (this._canvas) { this.buildGraphScene(); this.resetGraphView() } })
    } catch (error) { wx.showToast({ title: error.message || '知识图谱加载失败', icon: 'none' }) }
  },
  onHide() {
    this._isPageVisible = false
    this.stopMetricsPanel()
    this.cancelSelectionFlowAnimation()
    this.cancelGraphDraw()
    this._frameLatencyTracker.reset()
  },
  onUnload() {
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

  loadKnowledgeMapCourse(courseId, extraData = {}) {
    this.cancelSelectionFlowAnimation()
    this.cancelGraphDraw()
    this.stopMetricsPanel()
    this._metrics.reset()
    this._frameLatencyTracker.reset()
    const startedAt = this._metrics.now()
    const { viewModel, graphModel } = getKnowledgeMapModel(courseId)
    this._metrics.record('model', this._metrics.now() - startedAt)
    this._graphModel = graphModel
    this._selectedNodeId = null
    this._viewModelBytes = getUtf8Size(viewModel)
    const metricsVisible = this._isDevelop && viewModel.isStressFixture
    const shouldResizeCanvas = extraData.canvasHeight !== undefined
    this.setData({ model: viewModel, metricsVisible, metricsCollapsed: false, metricsRows: [], ...extraData }, () => {
      if (metricsVisible && this._isPageVisible) this.startMetricsPanel()
      if (!this._pageReady) return
      if (!this._canvas || shouldResizeCanvas) this.initializeCanvas()
      else {
        this.buildGraphScene()
        this.resetGraphView()
      }
    })
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
    const cards = nodes.map((node, drawIndex) => {
      const point = this.graphPoint(node)
      const metrics = this.getNodeCardMetrics(node)
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
        lineHeight: metrics.fontSize * 1.22,
        node,
        drawIndex,
        portSides: new Set()
      }
      context.font = `${metrics.fontWeight} ${metrics.fontSize}px sans-serif`
      card.lines = fitTextLines(node.label, metrics.width - 24, (text) => context.measureText(text).width, 2)
      return card
    })
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
      viewportHeight: height
    })
  },
  resetGraphView() {
    if (!this._canvas || !this._graphScene) return
    this._graphPresentation = this.getGraphPresentation()
    const scale = this._graphPresentation.defaultScale
    const bounds = this._graphScene.bounds
    const rootCard = this._graphScene.rootCard
    const focusRoot = this._graphPresentation.initialFocus === 'root' && rootCard
    this._graphView = focusRoot
      ? {
          scale,
          x: this._canvas.width * 0.24 - rootCard.centerX * scale,
          y: this._canvas.height / 2 - rootCard.centerY * scale
        }
      : {
          scale,
          x: this._canvas.width / 2 - (bounds.x + bounds.width / 2) * scale,
          y: this._canvas.height / 2 - (bounds.y + bounds.height / 2) * scale
        }
    this._graphView = this.clampGraphView(scale, this._graphView.x, this._graphView.y)
    this._selectedNodeId = null
    this.cancelSelectionFlowAnimation()
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
      Boolean(this._mapGesture)
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
    context.lineWidth = (strength === 'hard' ? 1.25 : 0.9) * inverseScale
    context.strokeStyle = strength === 'hard'
      ? `rgba(210, 112, 31, ${dimmed ? 0.2 : 0.58})`
      : `rgba(221, 166, 119, ${dimmed ? 0.14 : 0.48})`
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
      const towardSelected = edge.to === this._selectedNodeId ? travel : 1 - travel
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
    const style = STATUS_STYLES[card.node.status] || STATUS_STYLES.unknown
    const isSelected = card.node.id === this._selectedNodeId
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

    const showText = shouldShowKnowledgeMapLabel(
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
    context.fillStyle = '#FD7C02'
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
    const { width, height } = this._canvas
    const bounds = this._graphScene && this._graphScene.bounds
    if (!bounds) return { scale, x, y }
    const panPadding = (this._graphPresentation && this._graphPresentation.panPadding) || 28
    const scaledWidth = bounds.width * scale
    const scaledHeight = bounds.height * scale
    const centeredX = (width - scaledWidth) / 2 - bounds.x * scale
    const centeredY = (height - scaledHeight) / 2 - bounds.y * scale
    let minX
    let maxX
    let minY
    let maxY
    if (scaledWidth <= width) {
      minX = centeredX - panPadding
      maxX = centeredX + panPadding
    } else {
      minX = width - panPadding - (bounds.x + bounds.width) * scale
      maxX = panPadding - bounds.x * scale
    }
    if (scaledHeight <= height) {
      minY = centeredY - panPadding
      maxY = centeredY + panPadding
    } else {
      minY = height - panPadding - (bounds.y + bounds.height) * scale
      maxY = panPadding - bounds.y * scale
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
    if (!gesture || this._mapDidMove || gesture.type !== 'pan' || !this._canvas) {
      this.requestGraphDraw()
      return
    }
    const touch = (e.changedTouches || [])[0]
    const hitNode = touch && this.findNodeAt(this.getCanvasTouch(touch))
    if (!hitNode) {
      if (this._selectedNodeId) {
        this._selectedNodeId = null
        this.cancelSelectionFlowAnimation()
      }
      this.requestGraphDraw()
      return
    }
    this._selectedNodeId = hitNode.id
    this._selectionFlowStartedAt = this._metrics.now()
    this.requestGraphDraw()
    wx.showToast({ title: `演示知识点：${hitNode.label}`, icon: 'none' })
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
  resetMap() { this.resetGraphView() },

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
    this.updateMapSheetPosition(clamp(gesture.startTop - offsetY, 0, this.data.sheetTrigger))
  },
  handleMapSheetTouchEnd() {
    if (!this._sheetGesture) return
    const gesture = this._sheetGesture
    this._sheetGesture = null
    if (gesture.kind !== 'vertical') return
    this.snapMapSheet(gesture.startTop)
  },
  updateMapSheetPosition(scrollTop) {
    const boundedTop = clamp(scrollTop, 0, this.data.sheetTrigger)
    this._mapSheetOffset = boundedTop
    this.setData({
      sheetVisualOffset: boundedTop,
      canvasFollowOffset: Math.round(boundedTop * CANVAS_SHEET_FOLLOW_RATIO * 10) / 10,
      canvasClipHeight: Math.max(0, this.data.canvasHeight - boundedTop)
    })
  },
  snapMapSheet(startTop) {
    const current = this._mapSheetOffset || 0
    const delta = current - startTop
    let target
    if (delta > SHEET_DIRECTION_EPSILON) target = this.data.sheetTrigger
    else if (delta < -SHEET_DIRECTION_EPSILON) target = 0
    else target = current >= this.data.sheetTrigger / 2 ? this.data.sheetTrigger : 0
    if (Math.abs(target - current) <= SHEET_SETTLE_EPSILON) {
      this.updateMapSheetPosition(target)
      return
    }
    this._isMapSheetSnapping = true
    this.setData({
      sheetSnapping: true,
      sheetVisualOffset: target,
      canvasFollowOffset: Math.round(target * CANVAS_SHEET_FOLLOW_RATIO * 10) / 10,
      canvasClipHeight: Math.max(0, this.data.canvasHeight - target)
    })
    this._mapSheetSnapTimer = setTimeout(() => {
      this._mapSheetOffset = target
      this._isMapSheetSnapping = false
      this._mapSheetSnapTimer = null
      this.setData({
        sheetSnapping: false,
        sheetVisualOffset: target,
        canvasFollowOffset: Math.round(target * CANVAS_SHEET_FOLLOW_RATIO * 10) / 10,
        canvasClipHeight: Math.max(0, this.data.canvasHeight - target)
      })
    }, SHEET_ANIMATION_DURATION)
  },
  selectCourse(e) {
    const courseId = e.currentTarget.dataset.id
    if (!courseId || courseId === this.data.model.activeCourseId) return
    this.loadKnowledgeMapCourse(courseId)
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },
  openSubjectAssessment() {
    const subjectKey = String(this.data.activeSubjectKey || '')
    if (!subjectKey) return wx.showToast({ title: '请先选择一个学科', icon: 'none' })
    wx.navigateTo({ url: `/assessment/context/index?subjectKey=${encodeURIComponent(subjectKey)}` })
  },
  openTopicDetail() {
    const node = this.data.selectedNode
    if (!node || !node.id) return
    wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${encodeURIComponent(node.id)}&subjectKey=${encodeURIComponent(this.data.activeSubjectKey)}` })
  }
})
