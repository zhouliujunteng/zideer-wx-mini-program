const { tabletStage } = require('../../utils/tablet-stage')
const { loadKnowledgeUniverse, loadLearningPreference, loadGoalDiagnosis, hasSession, accessOfError } = require('../../services/identity')
const { entrySummary } = require('../../utils/goal-map')
const { isGuardianAccount } = require('../../utils/account-role')
const { summaryText } = require('../../utils/learning-preference')
const { normalizeGoalView, goalSummaryText, goalDeadlineTag } = require('../../utils/learning-goal')
const { attachUiAssets } = require('../../services/ui-assets')
const { openAccessStep } = require('../../utils/access-gate')
const { LARGE_SCREEN_WIDE_COLUMN, isLargeScreen, rpxUnit, columnWidth, getMenuButtonRect } = require('../../utils/screen')

// 「宇宙」Tab（设计稿：ui-ref/pages/knowledge-universe）。3D 球体渲染器与 Three.js
// 在 universe 分包里，页面就绪后 require.async 加载，主包只放这一页的逻辑。
// 球面位置沿用设计稿的 12 个球面点位 + 4 个星环点位，点位上挂的是后端读到的知识点。
const GLOBE_SLOTS = [
  [66, 0], [52, 137], [40, 274], [28, 51], [17, 188], [6, 325],
  [-6, 102], [-17, 239], [-28, 16], [-40, 153], [-52, 290], [-66, 67]
]
const RING_SLOTS = [[36, 2.67], [126, 2.95], [218, 3.25], [309, 3.5]]

// 名称排版：限宽、最多两行，两行放不下时按字数缩小字号（不再用省略号截断）。
// 汉字与全角符号按 1 个字宽、数字字母按 0.55 个字宽估算；返回 rpx 字号与行数。
function textUnits(text) {
  return Array.from(String(text || '')).reduce((sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? 0.55 : 1), 0)
}

function fitName(text, widthRpx, baseSize, minSize) {
  const units = Math.max(1, textUnits(text))
  const size = Math.max(minSize, Math.min(baseSize, Math.floor((widthRpx * 2) / units)))
  return { nameSize: size, nameLines: units * size > widthRpx ? 2 : 1 }
}

// 球面卡片名称区宽 190rpx（卡片最大 224rpx 减去两侧 16rpx 内边距）。
const CARD_NAME_WIDTH = 190
// 最近探索名称区宽约 430rpx（弹窗内白卡减去右侧状态）。
const RECENT_NAME_WIDTH = 430

function fitCard(card) {
  return { ...card, ...fitName(card.name, CARD_NAME_WIDTH, 25, 17) }
}

function placeCards(cards) {
  const knowledgeCards = []
  const ringCards = []
  cards.forEach((card, index) => {
    card = fitCard(card)
    if (index < GLOBE_SLOTS.length) knowledgeCards.push({ ...card, latitude: GLOBE_SLOTS[index][0], longitude: GLOBE_SLOTS[index][1] })
    else if (index - GLOBE_SLOTS.length < RING_SLOTS.length) {
      const slot = RING_SLOTS[index - GLOBE_SLOTS.length]
      ringCards.push({ ...card, id: `ring-${card.id}`, topicId: card.id, angle: slot[0], radius: slot[1] })
    }
  })
  return { knowledgeCards, ringCards }
}

// 背景方块氛围：固定装饰，按设计稿的行数与伪随机透明度生成。
function buildPixelModules() {
  const pixelRows = [16, 15, 14, 15, 13, 12, 13, 11, 10, 11, 9, 8]
  let pixelSeed = 20260923
  const modules = []
  pixelRows.forEach((count, rowIndex) => {
    for (let columnIndex = 0; columnIndex < count; columnIndex += 1) {
      pixelSeed = (pixelSeed * 1664525 + 1013904223) >>> 0
      modules.push({ id: `p-${rowIndex}-${columnIndex}`, right: columnIndex * 40, top: rowIndex * 40, opacity: Number((0.12 + (pixelSeed / 4294967296) * 0.32).toFixed(2)) })
    }
  })
  return modules
}

// 开发版压力测试：球面 200 + 星环 16 个测试知识点（universe/stress-fixture.js），只替换知识卡，
// 资料卡和学习概览仍是真实数据。体验版/正式版不生效；看完效果改成 false。
const UNIVERSE_STRESS_TEST = false

function isDevelopEnvironment() {
  try {
    const accountInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return Boolean(accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion === 'develop')
  } catch (error) {
    return false
  }
}

// 球体下方、面板上沿之上的统计行高度：卡片和锚点不进入这条区域，避免盖住统计文字。
const STAT_STRIP = 34

// 球上只挂少量知识点，统计行告诉学生一共掌握了多少、当前展示了多少。
function universeStatText(total, shown, stress) {
  if (stress) return `测试数据 · 当前展示 ${shown} 个知识点`
  if (!total) return ''
  return total > shown ? `已掌握 ${total} 个知识点 · 当前展示 ${shown} 个` : `已掌握 ${total} 个知识点，已全部展示`
}

// 同一时间最多挂几张知识卡；其余知识点只显示为球面橙点。
const MAX_VISIBLE_CARDS = 10

let globeRendererPromise = null
function loadGlobeRenderer() {
  if (!globeRendererPromise) {
    globeRendererPromise = require.async('../../universe/globe-renderer.js').catch((error) => {
      globeRendererPromise = null
      throw error
    })
  }
  return globeRendererPromise
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getTouchPoint(touch) {
  if (!touch) return null
  const x = typeof touch.clientX === 'number' ? touch.clientX : (typeof touch.x === 'number' ? touch.x : touch.pageX)
  const y = typeof touch.clientY === 'number' ? touch.clientY : (typeof touch.y === 'number' ? touch.y : touch.pageY)
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

function getTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0
  const first = getTouchPoint(touches[0])
  const second = getTouchPoint(touches[1])
  if (!first || !second) return 0
  const dx = first.x - second.x
  const dy = first.y - second.y
  return Math.sqrt(dx * dx + dy * dy)
}

Page({
  data: {
    model: { knowledgeCards: [], ringCards: [] },
    pixelModules: buildPixelModules(),
    loaded: false,
    loadFailed: false,
    // guest 未登录、profile 没完善学习资料（2026-09-27 起未登录也能浏览）：面板换成去登录 / 去完善的提示
    access: '',
    statText: '',
    loadError: '',
    // 「老师备课先看」卡片（学习目标 + 学习偏好）：loading 只画骨架；ready 显示摘要（空串 = 还没填）；failed 提示点开填写
    guardianAccount: false,
    planState: 'loading',
    goalSummary: '',
    goalDeadline: '',
    preferenceSummary: '',
    preferenceTags: [],
    preferenceMore: 0,
    // 目标导图一行（按目标测评，2026-10-10）：loading 骨架 / ready / failed
    goalMapState: 'loading',
    goalMapSummary: '',
    goalMapEmpty: true,
    goalMapAction: '',
    skeletonOverview: [{ id: 'mastered', label: '累计掌握' }, { id: 'assessment', label: '测评报告' }, { id: 'course', label: '课程验收' }],
    viewMode: 'first',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 80,
    streakEntryTop: 26,
    streakEntryRight: 100,
    sheetTop: 430,
    sheetExpandedTop: 250,
    topbarSolid: false,
    visualBottom: 237,
    globeSize: 300,
    globeLeft: 38,
    globeTop: 0,
    globeUnavailable: false,
    globeCards: [],
    // 1rpx 对应的 px：卡片字号、装饰方块是行内样式，按它换算才能跟上大屏的固定比例（utils/screen.js）。
    rpxUnit: 0.5
  },

  onLoad() {
    attachUiAssets(this)
    // 纯 JS 分包不能写进 preloadRule（开发者工具报 not found），进页面就先开始下载渲染器。
    loadGlobeRenderer().catch(() => {})
    if (UNIVERSE_STRESS_TEST && isDevelopEnvironment()) this.loadStressCards()
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this._windowWidth = windowInfo.windowWidth || 375
    this._windowHeight = windowInfo.windowHeight || 667
    this._pixelRatio = windowInfo.pixelRatio || 2
    const menuButton = getMenuButtonRect(windowInfo)
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    const contentTop = statusBarHeight + navigationBarHeight + 12
    const sheetTop = Math.round(this._windowHeight * 0.6)
    this._defaultSheetTop = sheetTop
    const sheetExpandedTop = Math.max(0, contentTop - 6)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop,
      // 学习连胜入口紧贴胶囊左侧 8px，与胶囊顶对齐、同高。
      streakEntryTop: menuButton.top,
      streakEntryRight: this._windowWidth - menuButton.left + 8,
      sheetTop,
      sheetExpandedTop,
      topbarSolid: false,
      visualBottom: Math.max(0, this._windowHeight - sheetTop),
      rpxUnit: rpxUnit(this._windowWidth)
    })
    this.updateGlobeLayout()
    if (wx.onWindowResize) {
      this._resizeHandler = this.handleWindowResize.bind(this)
      wx.onWindowResize(this._resizeHandler)
    }
  },

  onReady() {
    this._pageReady = true
    if (this.data.viewMode === 'first') this.initializeGlobe()
  },

  onShow() {
    this._pageVisible = true
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/knowledge-universe/index')
    // 读到过就后台静默刷新，保留当前内容；第一次读失败才显示错误。
    this.loadUniverse()
    if (this._globe && this.data.viewMode === 'first') {
      this._globe.resize(this.data.globeSize, this.data.globeSize)
      this._globe.resume()
      this._globe.setAutoRotation(true)
      this.updateGlobeCards()
      this.startProjectionTicker()
    }
    else if (this._pageReady && this.data.viewMode === 'first') {
      this._globeInitPending = false
      if (this._globeInitRetry) clearTimeout(this._globeInitRetry)
      this._globeInitRetry = null
      this.initializeGlobe()
    }
  },

  onHide() {
    this._pageVisible = false
    this.pauseGlobe()
  },

  onUnload() {
    this.stopGlobe()
    if (wx.offWindowResize && this._resizeHandler) wx.offWindowResize(this._resizeHandler)
  },

  handleWindowResize(event) {
    const info = event && event.size ? event.size : (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync())
    this._windowWidth = info.windowWidth || this._windowWidth
    this._windowHeight = info.windowHeight || this._windowHeight
    this._defaultSheetTop = Math.round(this._windowHeight * 0.6)
    const sheetExpandedTop = Math.max(0, this.data.contentTop - 6)
    const sheetTop = this.data.sheetExpanded ? sheetExpandedTop : this._defaultSheetTop
    this.setData({
      sheetTop,
      sheetExpandedTop,
      topbarSolid: sheetTop <= this.data.contentTop + 36,
      visualBottom: Math.max(0, this._windowHeight - this._defaultSheetTop),
      rpxUnit: rpxUnit(this._windowWidth)
    })
    this.updateGlobeLayout()
  },

  updateGlobeLayout() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const inset = 56 + Math.max(0, (info.screenHeight || info.windowHeight) - ((info.safeArea && info.safeArea.bottom) || info.screenHeight || info.windowHeight))
    const tabletLayout = tabletStage(this._windowWidth, this._windowHeight, this.data.contentTop, inset)
    if (tabletLayout) {
      this._sheetDragging = false
      this._cardPlacements = {}
      this._cardDisplayPositions = {}
      const height = Math.max(100, tabletLayout.stageHeight - STAT_STRIP)
      const size = Math.round(Math.min(tabletLayout.stageWidth * .88, height * .88, 580))
      this._stageHeight = height
      this.setData({ tabletLayout, sheetExpanded: false, sheetTop: tabletLayout.panelTop,
        visualBottom: this._windowHeight - tabletLayout.visualEnd,
        globeSize: size, globeLeft: Math.round((tabletLayout.stageWidth - size) / 2),
        globeTop: Math.round((height - size) / 2)
      }, () => { if (this._globe) { this._globe.resize(size, size); this.updateGlobeCards() } })
      return
    }
    // Keep the globe fixed to the default sheet stop. Pulling the sheet up should
    // cover the lower globe, not resize or recenter it.
    const stageHeight = Math.max(140, this._defaultSheetTop - this.data.contentTop)
    // 大屏下页面收在居中栏里（本页放宽到 1040px，见 index.wxss），球体按栏宽居中。
    const stageWidth = columnWidth(this._windowWidth, LARGE_SCREEN_WIDE_COLUMN)
    const size = Math.round(Math.min(stageWidth * 0.9, stageHeight * 0.86, 380))
    const left = Math.round((stageWidth - size) / 2)
    const top = Math.round((stageHeight - size) / 2)
    this._stageHeight = stageHeight
    this.setData({ tabletLayout: null, globeSize: size, globeLeft: left, globeTop: top }, () => {
      if (this._globe) {
        this._globe.resize(size, size)
        this.updateGlobeCards()
      }
    })
  },

  initializeGlobe() {
    if (this._globe || this._globeInitPending || this.data.viewMode !== 'first') return
    this._globeInitPending = true
    this._globeQueryRetries = 0
    if (this.data.globeUnavailable) {
      this.setData({ globeUnavailable: false }, () => this.queryGlobeCanvas())
      return
    }
    this.queryGlobeCanvas()
  },

  queryGlobeCanvas() {
    wx.createSelectorQuery().in(this).select('#learning-globe').node().exec((result) => {
      const canvas = result && result[0] && result[0].node
      if (this.data.viewMode !== 'first') {
        this._globeInitPending = false
        return
      }
      if (!canvas) {
        this._globeInitPending = false
        if (this._globeQueryRetries < 8) {
          this._globeQueryRetries += 1
          this._globeInitRetry = setTimeout(() => {
            this._globeInitPending = true
            this.queryGlobeCanvas()
          }, 250)
        } else {
          const message = 'WebGL canvas node unavailable after retries'
          console.error('[knowledge-universe]', message)
          this.setData({ globeUnavailable: true })
        }
        return
      }
      loadGlobeRenderer().then(({ createLearningGlobe }) => {
        if (this._globe || this.data.viewMode !== 'first') return
        this._globe = createLearningGlobe(canvas, this.data.globeSize, this.data.globeSize, this.data.model.knowledgeCards)
        this._canvas = canvas
        if (!this._pageVisible) this.pauseGlobe()
        else {
          this.updateGlobeCards()
          this.startProjectionTicker()
        }
      }).catch((error) => {
        console.error('[knowledge-universe] WebGL globe initialization failed', error)
        this.setData({ globeUnavailable: true })
      }).then(() => {
        this._globeInitPending = false
      })
    })
  },

  async loadUniverse() {
    const generation = (this._loadGeneration || 0) + 1
    this._loadGeneration = generation
    // 游客没有学习宇宙可读，不发请求
    if (!hasSession()) { this.showAccessPrompt('guest'); return }
    this.loadPreferenceEntry()
    this.loadGoalMapEntry()
    // 上次显示的是提示：这次可能刚登录或刚建完档，回到骨架重新读
    if (this.data.access) this.setData({ access: '', loaded: false, loadFailed: false, loadError: '' })
    if (!this.data.loaded && this.data.loadFailed) this.setData({ loadFailed: false, loadError: '' })
    try {
      const universe = await loadKnowledgeUniverse()
      if (generation !== this._loadGeneration) return
      const placed = this._stressCards || placeCards(universe.cards)
      const recentExplorations = (universe.recentExplorations || []).map((item) => ({ ...item, ...fitName(item.name, RECENT_NAME_WIDTH, 24, 18) }))
      this.setData({
        model: { ...universe, ...placed, recentExplorations },
        statText: universeStatText(universe.universeTotal, placed.knowledgeCards.length + placed.ringCards.length, Boolean(this._stressCards)),
        loaded: true,
        loadFailed: false
      }, () => {
        if (!this._globe) return
        this._globe.setKnowledgePoints(placed.knowledgeCards)
        this._cardPlacements = {}
        this.updateGlobeCards()
      })
    } catch (error) {
      if (generation !== this._loadGeneration) return
      // 登录已失效、还没完善学习资料：不算读取失败，换成提示
      const access = accessOfError(error)
      if (access) { this.showAccessPrompt(access); return }
      if (this.data.loaded) return
      this.setData({ loadFailed: true, loadError: error && error.message || '学习宇宙暂时没有读到，请稍后重试。' })
    }
  },

  // 球面上不挂知识点，面板只放去登录 / 去完善的提示
  showAccessPrompt(access) {
    this.setData({ access, loaded: true, loadFailed: false, loadError: '', statText: '', model: { knowledgeCards: [], ringCards: [], recentExplorations: [] } }, () => {
      if (!this._globe) return
      this._globe.setKnowledgePoints([])
      this._cardPlacements = {}
      this.updateGlobeCards()
    })
  },

  openAccessStep() {
    openAccessStep(this.data.access)
  },

  // 「老师备课先看」卡片：偏好接口一次带回学习目标（goal），与学习宇宙分开读，读不到不影响宇宙。
  // 读到过就静默刷新、保留旧内容。偏好最多摆两个标签，其余折成 +N。
  async loadPreferenceEntry() {
    const guardianAccount = isGuardianAccount()
    if (guardianAccount !== this.data.guardianAccount) this.setData({ guardianAccount })
    if (guardianAccount) return
    const generation = (this._preferenceGeneration || 0) + 1
    this._preferenceGeneration = generation
    try {
      const view = await loadLearningPreference()
      if (generation !== this._preferenceGeneration) return
      const set = Boolean(view && view.status === 'set')
      const labels = set && Array.isArray(view.labels) ? view.labels.map(String).filter(Boolean) : []
      const goal = normalizeGoalView(view && view.goal)
      this.setData({
        planState: 'ready',
        goalSummary: goalSummaryText(goal),
        goalDeadline: goalDeadlineTag(goal),
        preferenceSummary: set ? (summaryText(labels, view.note) || '已设置') : '',
        preferenceTags: labels.slice(0, 2),
        preferenceMore: Math.max(0, labels.length - 2)
      })
    } catch (error) {
      if (generation !== this._preferenceGeneration || this.data.planState === 'ready') return
      this.setData({ planState: 'failed' })
    }
  },

  // 目标导图一行：和偏好分开读，读不到不影响别的；读到过就静默刷新
  async loadGoalMapEntry() {
    if (isGuardianAccount()) return
    const generation = (this._goalMapGeneration || 0) + 1
    this._goalMapGeneration = generation
    try {
      const summary = entrySummary(await loadGoalDiagnosis())
      if (generation !== this._goalMapGeneration) return
      this.setData({ goalMapState: 'ready', goalMapSummary: summary.text, goalMapEmpty: summary.empty, goalMapAction: summary.action })
    } catch (error) {
      if (generation !== this._goalMapGeneration || this.data.goalMapState === 'ready') return
      this.setData({ goalMapState: 'failed' })
    }
  },

  // 目标导图在「目标」tab（2026-10-10）
  openGoalDiagnosis() {
    wx.switchTab({ url: '/pages/goal/index' })
  },

  openLearningGoal() {
    wx.navigateTo({ url: '/learning/learning-goal/index' })
  },

  openLearningPreference() {
    wx.navigateTo({ url: '/learning/learning-preference/index' })
  },

  retryUniverse() { this.loadUniverse() },

  loadStressCards() {
    require.async('../../universe/stress-fixture.js').then(({ buildStressCards }) => {
      const stress = buildStressCards(200, 16)
      const placed = { knowledgeCards: stress.knowledgeCards.map(fitCard), ringCards: stress.ringCards.map(fitCard) }
      this._stressCards = placed
      this.setData({
        stressLabel: `测试数据 ${placed.knowledgeCards.length + placed.ringCards.length}`,
        'model.knowledgeCards': placed.knowledgeCards,
        'model.ringCards': placed.ringCards,
        statText: universeStatText(0, placed.knowledgeCards.length + placed.ringCards.length, true)
      }, () => {
        if (!this._globe) return
        this._globe.setKnowledgePoints(placed.knowledgeCards)
        this._cardPlacements = {}
        this.updateGlobeCards()
      })
    }).catch((error) => console.error('[knowledge-universe] stress fixture unavailable', error))
  },

  startProjectionTicker() {
    if (this._projectionTimer) clearInterval(this._projectionTimer)
    this._projectionTimer = setInterval(() => this.updateGlobeCards(), 50)
  },

  stopGlobe() {
    if (this._resumeTimer) clearTimeout(this._resumeTimer)
    if (this._projectionTimer) clearInterval(this._projectionTimer)
    if (this._globeInitRetry) clearTimeout(this._globeInitRetry)
    this._resumeTimer = null
    this._projectionTimer = null
    this._globeInitRetry = null
    this._globeInitPending = false
    if (this._globe) this._globe.destroy()
    this._globe = null
    this._canvas = null
  },

  pauseGlobe() {
    if (this._resumeTimer) clearTimeout(this._resumeTimer)
    if (this._projectionTimer) clearInterval(this._projectionTimer)
    this._resumeTimer = null
    this._projectionTimer = null
    this._isDraggingGlobe = false
    this._isPinchingGlobe = false
    this._touchPoint = null
    if (this._globe) {
      this._globe.setAutoRotation(false)
      this._globe.pause()
    }
  },

  updateGlobeCards() {
    if (!this._globe || this.data.viewMode !== 'first') return
    const cameraDistance = this._globe.getCameraDistance()
    const radius = this.data.globeSize * 0.426 * 8.8 / cameraDistance
    const knowledgeCards = this.data.model.knowledgeCards || []
    const ringCards = this.data.model.ringCards || []
    const projectedPoints = this._globe.projectPoints(knowledgeCards)
    const projectedRingPoints = this._globe.projectRingPoints(ringCards)
    const cardEntries = knowledgeCards.map((item, index) => ({ item, projected: projectedPoints[index], isRingCard: false }))
      .concat(ringCards.map((item, index) => ({ item, projected: projectedRingPoints[index], isRingCard: true })))
    this._cardOpacityState = this._cardOpacityState || {}
    const points = cardEntries.map((entry) => {
      const item = entry.item
      const projected = entry.projected
      const isRingCard = entry.isRingCard
      const depth = projected.depth
      const depthScale = isRingCard ? 1 : 2.2
      const coordinateScale = isRingCard ? 1 / 2.2 : 1
      const perspective = cameraDistance / (cameraDistance - depth * depthScale)
      // Fade across the camera-facing edge; once a point reaches the silhouette
      // it is forced fully invisible, with no CSS transition tail on the back.
      const targetVisibility = depth > 0 ? clamp(depth / 0.22, 0, 1) : 0
      const previousVisibility = this._cardOpacityState[item.id]
      const visibility = depth <= 0
        ? 0
        : previousVisibility === undefined
          ? targetVisibility
          : previousVisibility + (targetVisibility - previousVisibility) * 0.42
      this._cardOpacityState[item.id] = visibility
      const pointX = this.data.globeLeft + this.data.globeSize / 2 + projected.x * radius * coordinateScale * perspective
      const pointY = this.data.globeTop + this.data.globeSize / 2 - projected.y * radius * coordinateScale * perspective
      const pagePointY = this.data.contentTop + pointY
      const cardDistance = isRingCard ? 1.02 : 1.18
      const targetX = this.data.globeLeft + this.data.globeSize / 2 + projected.x * radius * coordinateScale * perspective * cardDistance
      const targetY = this.data.contentTop + this.data.globeTop + this.data.globeSize / 2 - projected.y * radius * coordinateScale * perspective * cardDistance
      return {
        ...item,
        isRingCard,
        x: targetX,
        pageY: targetY,
        pointX: Math.round(pointX),
        pointPageY: Math.round(pagePointY),
        depth,
        opacity: visibility,
        visible: visibility > 0.015,
        // Initialize every rendered overlay, including cards excluded from the
        // collision-placement pass, so a back-side anchor never falls back to
        // the cover-view default opacity of 1.
        anchorOpacity: visibility,
        surfaceOpacity: visibility,
        scale: Number((0.78 + clamp(depth, 0, 1) * 0.18).toFixed(2))
      }
    })

    // 所有知识点都以球面橙点呈现；知识卡只挂给朝向屏幕、互不重叠的少数几个点（最多 MAX_VISIBLE_CARDS 张）。
    // 选卡优先保留上一帧已显示的卡，再按离球心正面的远近补位；落选的卡平滑淡出，不挤位、不堆叠。
    // 下面这些间距是按手机调的 px；大屏下卡片随 rpx 固定比例放大，间距跟着放大。
    const cardScale = isLargeScreen(this._windowWidth) ? rpxUnit(this._windowWidth) * 2 : 1
    const cardHalfWidth = 54 * cardScale
    const cardHalfHeight = 26 * cardScale
    // 两行名称的卡片更高：碰撞时按每张卡自己的半高算。
    const halfHeightOf = (item) => cardHalfHeight + (item.nameLines > 1 ? 9 * cardScale : 0)
    const minX = cardHalfWidth + 5
    const maxX = (this.data.tabletLayout ? this.data.tabletLayout.stageWidth : columnWidth(this._windowWidth, LARGE_SCREEN_WIDE_COLUMN)) - cardHalfWidth - 5
    const minY = this.data.contentTop + cardHalfHeight + 4
    const maxY = (this.data.tabletLayout ? this.data.tabletLayout.visualEnd : this.data.sheetTop) - STAT_STRIP - cardHalfHeight - 8
    const offsets = [[0, 0], [0, -30], [0, 30], [-36, 0], [36, 0]].map(([dx, dy]) => [dx * cardScale, dy * cardScale])
    const placements = this._cardPlacements || (this._cardPlacements = {})
    const displayPositions = this._cardDisplayPositions || (this._cardDisplayPositions = {})
    const shownState = this._cardShownState || (this._cardShownState = {})
    const occupied = []
    const overlapsOccupied = (x, pageY, halfHeight) => occupied.some((other) => Math.abs(x - other.x) < cardHalfWidth * 2 + 8 && Math.abs(pageY - other.pageY) < halfHeight + other.halfHeight + 8)
    let acceptedCount = 0
    points.slice().sort((first, second) => {
      const firstShown = shownState[first.id] > 0.5 ? 1 : 0
      const secondShown = shownState[second.id] > 0.5 ? 1 : 0
      return (secondShown - firstShown) || (second.depth - first.depth)
    }).forEach((item) => {
      const rawX = item.x
      const rawY = item.pageY
      let chosen = null
      if (item.depth > 0.35 && item.surfaceOpacity > 0.3 && acceptedCount < MAX_VISIBLE_CARDS) {
        const previous = placements[item.id]
        const candidates = previous ? [previous].concat(offsets.filter((offset) => offset[0] !== previous[0] || offset[1] !== previous[1])) : offsets
        for (let index = 0; index < candidates.length && !chosen; index += 1) {
          const offset = candidates[index]
          const x = rawX + offset[0]
          const pageY = rawY + offset[1]
          if (x < minX || x > maxX || pageY < minY || pageY > maxY) continue
          if (!overlapsOccupied(x, pageY, halfHeightOf(item))) chosen = { x, pageY, offset }
        }
      }
      const shown = shownState[item.id] || 0
      const nextShown = shown + ((chosen ? 1 : 0) - shown) * 0.3
      shownState[item.id] = nextShown < 0.01 ? 0 : nextShown
      if (chosen) {
        acceptedCount += 1
        placements[item.id] = chosen.offset
        occupied.push({ x: chosen.x, pageY: chosen.pageY, halfHeight: halfHeightOf(item) })
      }
      const target = chosen || displayPositions[item.id] || { x: rawX, pageY: rawY }
      const previousPosition = displayPositions[item.id]
      const x = previousPosition && chosen ? previousPosition.x + (target.x - previousPosition.x) * 0.38 : target.x
      const pageY = previousPosition && chosen ? previousPosition.pageY + (target.pageY - previousPosition.pageY) * 0.38 : target.pageY
      if (chosen) displayPositions[item.id] = { x, pageY }
      item.x = Math.round(x)
      item.pageY = Math.round(pageY)
      item.y = item.pageY - this.data.contentTop
      const anchorClearsSheet = clamp(((this.data.tabletLayout ? this.data.tabletLayout.visualEnd : this.data.sheetTop) - STAT_STRIP - item.pointPageY) / 12, 0, 1)
      item.opacity = item.surfaceOpacity * shownState[item.id] * anchorClearsSheet
      item.anchorOpacity = item.opacity
      if (!shownState[item.id]) delete displayPositions[item.id]
    })
    // 只把正在显示（含淡出中）的卡交给 setData，其余知识点只是球面上的点。
    this.setData({ globeCards: points.filter((item) => item.opacity > 0.01) })
  },


  // 面板正在被拖、面板已拉到顶，或手指落在面板范围内时，球体不接手势：
  // 否则把面板往下拉时，后面的球也会跟着转。
  globeGestureBlocked(touches) {
    if (this._sheetDragging || this.data.sheetExpanded) return true
    const point = getTouchPoint(touches && touches[0])
    if (this.data.tabletLayout) {
      const layout = this.data.tabletLayout
      return Boolean(point && (point.y >= layout.visualEnd || point.x - Math.max(0, (this._windowWidth - columnWidth(this._windowWidth, LARGE_SCREEN_WIDE_COLUMN)) / 2) >= layout.stageWidth))
    }
    return Boolean(point && point.y >= this.data.sheetTop)
  },

  handleGlobeTouchStart(event) {
    const touches = event.touches || []
    if (!touches.length) return
    if (this.globeGestureBlocked(touches)) {
      this._globeGestureIgnored = true
      return
    }
    this._globeGestureIgnored = false
    if (touches.length >= 2) {
      const distance = getTouchDistance(touches)
      if (!distance || !this._globe) return
      this._isPinchingGlobe = true
      this._isDraggingGlobe = false
      this._pinchStartDistance = distance
      this._pinchStartScale = this._globe.getZoomScale()
      this._touchPoint = null
    } else {
      this._isPinchingGlobe = false
      this._touchPoint = getTouchPoint(touches[0])
      this._isDraggingGlobe = Boolean(this._touchPoint)
    }
    if (this._globe) this._globe.setAutoRotation(false)
    if (this._resumeTimer) clearTimeout(this._resumeTimer)
    this._resumeTimer = null
  },

  handleGlobeTouchMove(event) {
    if (!this._globe || this._globeGestureIgnored || this._sheetDragging) return
    const touches = event.touches || []
    if (touches.length >= 2) {
      const distance = getTouchDistance(touches)
      if (!distance) return
      if (!this._isPinchingGlobe) {
        this._isPinchingGlobe = true
        this._isDraggingGlobe = false
        this._pinchStartDistance = distance
        this._pinchStartScale = this._globe.getZoomScale()
      }
      this._globe.setZoomScale(this._pinchStartScale * distance / this._pinchStartDistance)
      this.updateGlobeCards()
      return
    }
    if (this._isPinchingGlobe || !this._isDraggingGlobe || !this._touchPoint || !touches.length) return
    const point = getTouchPoint(touches[0])
    if (!point) return
    const dx = point.x - this._touchPoint.x
    const dy = point.y - this._touchPoint.y
    this._touchPoint = point
    this._globe.rotateBy(dx, dy)
    this.updateGlobeCards()
  },

  handleGlobeTouchEnd(event) {
    const touches = event && event.touches ? event.touches : []
    if (this._globeGestureIgnored) {
      if (!touches.length) this._globeGestureIgnored = false
      return
    }
    if (touches.length >= 2) {
      this._pinchStartDistance = getTouchDistance(touches)
      this._pinchStartScale = this._globe ? this._globe.getZoomScale() : 1
      return
    }
    if (touches.length === 1 && this._isPinchingGlobe) {
      this._isPinchingGlobe = false
      this._touchPoint = getTouchPoint(touches[0])
      this._isDraggingGlobe = Boolean(this._touchPoint)
      return
    }
    this._isPinchingGlobe = false
    this._isDraggingGlobe = false
    this._touchPoint = null
    if (this._resumeTimer) clearTimeout(this._resumeTimer)
    this._resumeTimer = setTimeout(() => {
      if (this._globe && this.data.viewMode === 'first') this._globe.setAutoRotation(true)
      this._resumeTimer = null
    }, 5000)
  },

  handleSheetTouchStart(event) {
    if (this.data.tabletLayout) return
    const touch = event.touches && event.touches[0]
    this._sheetTouchStartY = touch ? touch.clientY : null
    this._sheetTouchStartTop = this.data.sheetTop
    // 面板手势开始：中断球体上可能正在进行的拖动，避免两边同时响应。
    this._sheetDragging = Boolean(touch)
    this._isDraggingGlobe = false
    this._isPinchingGlobe = false
    this._touchPoint = null
  },

  handleSheetTouchMove(event) {
    if (this.data.tabletLayout) return
    const touch = event.touches && event.touches[0]
    if (!touch || this._sheetTouchStartY === null || this._sheetTouchStartY === undefined) return
    const top = clamp(this._sheetTouchStartTop + touch.clientY - this._sheetTouchStartY, this.data.sheetExpandedTop, Math.round(this._windowHeight * 0.62))
    this.setData({
      sheetTop: top,
      sheetExpanded: top <= this.data.contentTop + 36,
      topbarSolid: top <= this.data.contentTop + 36
    })
  },

  handleSheetTouchEnd() {
    if (this.data.tabletLayout) return
    this._sheetDragging = false
    if (this._sheetTouchStartY === null || this._sheetTouchStartY === undefined) return
    const expanded = this.data.sheetTop < this._windowHeight * 0.46
    const top = expanded ? this.data.sheetExpandedTop : this._defaultSheetTop
    this._sheetTouchStartY = null
    this.setData({ sheetTop: top, sheetExpanded: expanded, topbarSolid: expanded })
  },

  selectKnowledgeCard(event) {
    const cards = (this.data.model.knowledgeCards || []).concat(this.data.model.ringCards || [])
    const item = cards.find((card) => card.id === event.currentTarget.dataset.id)
    if (!item) return
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    wx.showToast({ title: `${item.name} · ${item.subject}`, icon: 'none' })
  }
})
