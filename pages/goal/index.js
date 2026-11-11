const { loadGoalDiagnosis, goalDiagnosis, hasSession, accessOfError } = require('../../services/identity')
const { isGuardianAccount } = require('../../utils/account-role')
const { openAccessStep } = require('../../utils/access-gate')
const { getMenuButtonRect } = require('../../utils/screen')
const { summaryView, stateText, progressView } = require('../../utils/goal-map')
const { SAMPLE_GOAL, SAMPLE_NODES } = require('../../utils/goal-map-sample')

// 「目标」Tab（2026-10-10 用户规则：原来的「图谱」tab 换成目标，知识图谱挪到「我的 › 知鹿服务」）。
// 学生的学习目标 + 按目标测评的目标导图（目标 → 大条件 → 知识点 → 前置知识点），每个卡点下面挂着老师按导图定制的课程，
// 点卡片或下面的「卡点与课程」都能直接进课程详情。答题在 learning/goal-diagnosis 页，这里只看结果、开始 / 继续测评。
// 没登录、没建档：画示例导图（审核能按路径打开 tab 页，不能空着），上方标「示例」引导去登录 / 去完善。
//
// 页面状态 view：loading（骨架）/ failed / sample（游客、没建档）/ no_goal / start（定了目标还没测或目标改过）/
// testing（测评进行中）/ result（导图 + 卡点与课程）

const STEPS = [
  { no: 1, title: '拆解目标', desc: '看实现目标要具备哪几个条件' },
  { no: 2, title: '边做边找卡点', desc: '做错的题往前检查它需要的基础' },
  { no: 3, title: '对着导图上课', desc: '老师按卡点定制课程，挂在导图上' }
]

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 80,
    streakEntryTop: 26,
    streakEntryRight: 100,
    view: 'loading',
    access: '',
    loadError: '',
    goal: null,
    goalChanged: false,
    trialOffered: false,
    diagnosis: null,
    nodes: [],
    summary: null,
    progress: null,
    stateText: '',
    steps: STEPS,
    historyOpen: false,
    historyState: 'idle',
    historyItems: []
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = getMenuButtonRect(windowInfo)
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop: statusBarHeight + navigationBarHeight + 12,
      streakEntryTop: menuButton.top,
      streakEntryRight: (windowInfo.windowWidth || 375) - menuButton.left + 8
    })
  },

  onShow() {
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/goal/index')
    // 家长没有这一页（底栏也没有）：被别处带进来就回首页
    if (isGuardianAccount()) { wx.switchTab({ url: '/pages/home/index' }); return }
    this.load()
  },

  async load() {
    if (!hasSession()) return this.showSample('guest')
    const generation = (this._generation || 0) + 1
    this._generation = generation
    try {
      const overview = await loadGoalDiagnosis()
      if (generation !== this._generation) return
      this.applyOverview(overview)
    } catch (error) {
      if (generation !== this._generation) return
      const access = accessOfError(error)
      if (access) return this.showSample(access)
      // 读到过就保留旧内容，只提示；第一次就失败才显示错误
      if (this.data.view !== 'loading' && this.data.view !== 'failed') {
        wx.showToast({ title: (error && error.message) || '暂时没有刷新成功', icon: 'none' })
        return
      }
      this.setData({ view: 'failed', loadError: (error && error.message) || '目标暂时读不到，请稍后重试。' })
    }
  },

  retryLoad() {
    this.setData({ view: 'loading', loadError: '' })
    this.load()
  },

  showSample(access) {
    const diagnosis = { status: 'finished', map: { nodes: SAMPLE_NODES, summary: {} } }
    this.setData({ view: 'sample', access, goal: SAMPLE_GOAL, diagnosis: null, nodes: SAMPLE_NODES, summary: summaryView(diagnosis) })
  },

  applyOverview(overview) {
    const goal = overview.goal || null
    const diagnosis = overview.diagnosis || null
    // trialOffered：推广伙伴给这个孩子开了一次免费基础测评、还没开测（2026-11-11），下一次开始测评就是基础版
    const trialOffered = Boolean(overview.trialOffered)
    const base = { access: 'ready', goal, goalChanged: Boolean(overview.goalChanged), diagnosis, loadError: '', trialOffered }
    if (!goal) return this.setData({ ...base, view: 'no_goal', nodes: [] })
    if (!diagnosis || overview.goalChanged || diagnosis.status === 'failed' || trialOffered) return this.setData({ ...base, view: 'start', nodes: [] })
    if (diagnosis.status === 'planning' || diagnosis.status === 'active')
      return this.setData({ ...base, view: 'testing', nodes: (diagnosis.map && diagnosis.map.nodes) || [], progress: progressView(diagnosis.map) })
    this.setData({
      ...base,
      view: 'result',
      nodes: (diagnosis.map && diagnosis.map.nodes) || [],
      summary: summaryView(diagnosis),
      stateText: stateText(diagnosis)
    })
  },

  /* ---------------- 跳转 ---------------- */

  openAccessStep() {
    openAccessStep(this.data.access)
  },

  openGoal() {
    wx.navigateTo({ url: '/learning/learning-goal/index' })
  },

  startDiagnosis() {
    wx.navigateTo({ url: '/learning/goal-diagnosis/index?autostart=1' })
  },

  continueDiagnosis() {
    wx.navigateTo({ url: '/learning/goal-diagnosis/index' })
  },

  // 结果页「继续测评」：暂停的接着测（goal-diagnosis 页读到 paused 会显示结果，点继续）
  resumeDiagnosis() {
    const diagnosis = this.data.diagnosis
    if (!diagnosis) return
    goalDiagnosis('resume', { id: diagnosis.id })
      .then(() => wx.navigateTo({ url: '/learning/goal-diagnosis/index' }))
      .catch((error) => wx.showToast({ title: (error && error.message) || '没有接上，请稍后重试。', icon: 'none' }))
  },

  restartDiagnosis() {
    wx.showModal({
      title: '重新测一次？',
      content: '按现在的学习目标重新拆解、重新测。这次的导图会留在「历史目标」里。',
      confirmText: '重新测',
      success: (result) => {
        if (!result || !result.confirm) return
        goalDiagnosis('start', { restart: true })
          .then(() => wx.navigateTo({ url: '/learning/goal-diagnosis/index' }))
          .catch((error) => {
            if (error && error.code === 'SUBJECT_REQUIRED') return wx.navigateTo({ url: '/learning/goal-diagnosis/index?autostart=1' })
            wx.showToast({ title: (error && error.message) || '测评没有开始，请稍后重试。', icon: 'none' })
          })
      }
    })
  },

  // 课程：从导图卡片（组件抛 course 事件）或「卡点与课程」点进来，都进课程详情
  openCourse(event) {
    const detail = (event && event.detail && event.detail.stageId ? event.detail : event.currentTarget.dataset) || {}
    const stageId = String(detail.stageId || detail.stage || '')
    if (!stageId || (detail.state && detail.state !== 'ready')) return
    wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(stageId)}` })
  },

  // 导图卡片说明打开时收起底栏，不然底栏盖在说明上
  handleSheet(event) {
    const open = Boolean(event.detail && event.detail.open)
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar) tabBar.setData({ hidden: open })
  },

  /* ---------------- 历史目标 ---------------- */

  async openHistory() {
    this.setData({ historyOpen: true })
    this.handleSheet({ detail: { open: true } })
    if (this.data.historyState === 'loading') return
    this.setData({ historyState: this.data.historyItems.length ? 'ready' : 'loading' })
    try {
      const result = await goalDiagnosis('history')
      const labels = { planning: '拆解中', active: '测评中', paused: '测了一部分', finished: '已测完', failed: '没拆好' }
      const items = (result.items || []).map((item) => ({
        ...item,
        day: String(item.createdAt || '').slice(0, 10),
        statusText: labels[item.status] || '',
        current: Boolean(this.data.diagnosis && this.data.diagnosis.id === item.id)
      }))
      this.setData({ historyState: 'ready', historyItems: items })
    } catch (error) {
      this.setData({ historyState: this.data.historyItems.length ? 'ready' : 'failed' })
    }
  },

  closeHistory() {
    this.setData({ historyOpen: false })
    this.handleSheet({ detail: { open: false } })
  },

  openPast(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!/^[1-9][0-9]*$/.test(id)) return
    this.closeHistory()
    wx.navigateTo({ url: `/learning/goal-diagnosis/index?id=${id}` })
  },

  noop() {}
})
