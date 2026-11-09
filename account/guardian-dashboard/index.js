const { loadGuardianDashboard, loadGuardianHomework } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { buildChild, diagnosisFor } = require('../../utils/guardian-dashboard-view')

// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 f40113a 的 M50 家长学生看板（2026-09-25 同步）。
// 入口：「我的 → 常用入口 → 学生看板」（已绑定学生的家长）。数据来自动作流「读取当前家长学生看板」，
// 只读家长本人有效关系下的孩子；整理规则见 utils/guardian-dashboard-view.js。
// 未移植（后端没有对应数据，不放演示数据）：按学科的学习时长环图；「更多」里的测评中心读的是
// 当前账号自己的测评，对家长没有意义，换成孩子的课程积分。
// 「学习诊断 → 作业动态」（2026-10-13）：课后作业来自课程服务 /api/learn/guardian-homework，与看板分开读，
// 读到前画骨架、读不到给重试，不挡看板其余内容。
const TABS = [
  { id: 'learning', label: '学习情况' },
  { id: 'diagnosis', label: '学习诊断' },
  { id: 'plan', label: '学习计划' },
  { id: 'more', label: '更多' }
]
const SWITCHER_CLOSE_MS = 240
// 孩子多（服务商）时切换面板里加搜索框
const SEARCH_FROM = 8

function filterChildren(children, keyword) {
  const word = String(keyword || '').trim()
  if (!word) return children
  return children.filter((child) => String(child.name || '').includes(word) || String(child.grade || '').includes(word))
}

Page({
  data: {
    tabs: TABS,
    // 第一次读到看板前画骨架；读失败给重试；之后回到页面保留旧数据静默刷新
    loaded: false,
    failed: false,
    children: [],
    student: null,
    diagnosis: null,
    quickActions: [],
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    childSwitcherVisible: false,
    childSwitcherClosing: false,
    childSearch: '',
    visibleChildren: [],
    activeTab: 'learning',
    tabMotion: '',
    tabsSticky: false
  },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() { return this.loadPage() },

  onUnload() {
    if (this._switcherCloseTimer) clearTimeout(this._switcherCloseTimer)
    if (this._tabMotionTimer) clearTimeout(this._tabMotionTimer)
  },

  // 2026-10-11：后端只给选中那一个孩子的完整数据，其余只有称呼、年级、头像（服务商名下孩子多，一次全读会超时）。
  // 读过完整数据的孩子记在 _details 里，切回去先显示旧数据再静默刷新；没读过的切换时等读到再换。
  async loadPage(studentId) {
    const requestId = this._requestId = (this._requestId || 0) + 1
    const wantedId = studentId != null ? studentId : (this.data.student && this.data.student.id)
    try {
      const data = await loadGuardianDashboard(wantedId)
      if (requestId !== this._requestId) return false
      this._details = this._details || {}
      // 旧版流程（一次给全部孩子的完整数据）不带 detailLoaded：那就每个孩子都算读全了
      const legacy = !data.children.some((child) => child.detailLoaded)
      this._children = data.children.map((child) => {
        const built = buildChild(child)
        if (legacy || child.detailLoaded) this._details[String(built.id)] = built
        return built
      })
      const chosen = legacy
        ? data.children.find((child) => wantedId != null && String(child.profile.id) === String(wantedId)) || data.children[0]
        : data.children.find((child) => child.detailLoaded)
      const student = chosen ? this._details[String(chosen.profile.id)] : null
      const selectedDate = this.data.diagnosis && this.data.diagnosis.selectedDate
      this.setData({ loaded: true, failed: false, ...this.viewFor(student, selectedDate) }, () => this.measureTabs())
      if (student) this.loadHomework(student.id)
      return true
    } catch (error) {
      if (requestId !== this._requestId) return false
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '学生看板加载失败', icon: 'none' })
      return false
    }
  },

  retryLoad() {
    this.setData({ failed: false })
    return this.loadPage()
  },

  // 当前孩子置顶，其余按原顺序
  viewFor(student, selectedDate) {
    const children = student ? [student, ...this._children.filter((child) => child.id !== student.id)] : []
    const options = children.map(({ id, name, grade, avatarSrc }) => ({ id, name, grade, avatarSrc }))
    return {
      student,
      children: options,
      showChildSearch: options.length > SEARCH_FROM,
      visibleChildren: filterChildren(options, this.data.childSearch),
      diagnosis: student ? diagnosisFor(student, selectedDate && selectedDate >= student.minDate && selectedDate <= student.today ? selectedDate : '', this.homeworkState(student.id)) : null,
      quickActions: student ? [
        { id: 'learningFeed', label: '孩子学习动态', hint: '查看近期学习时长与学习状态' },
        { id: 'credits', label: '孩子的课程积分', hint: student.creditsText ? `可用 ${student.creditsText} 积分` : '查看积分与使用记录' },
        { id: 'orders', label: '订单与代付记录', hint: '查看为孩子购买的订单' }
      ] : []
    }
  },

  // 课后作业：每个孩子一份读取状态；读到过的再刷新时保留旧数据，读失败只在从没读到过时显示重试。
  homeworkState(studentId) {
    const states = this._homework || {}
    return states[String(studentId)] || { loaded: false, failed: false, items: [] }
  },

  async loadHomework(studentId) {
    const key = String(studentId)
    this._homework = this._homework || {}
    const requestId = this._homeworkRequest = (this._homeworkRequest || 0) + 1
    try {
      const items = await loadGuardianHomework(studentId)
      this._homework[key] = { loaded: true, failed: false, items }
    } catch (error) {
      const previous = this._homework[key]
      this._homework[key] = previous && previous.loaded ? previous : { loaded: false, failed: true, items: [] }
    }
    if (requestId !== this._homeworkRequest) return
    this.refreshDiagnosis()
  },

  retryHomework() {
    const student = this.data.student
    if (!student) return
    this._homework = this._homework || {}
    this._homework[String(student.id)] = { loaded: false, failed: false, items: [] }
    this.refreshDiagnosis()
    return this.loadHomework(student.id)
  },

  refreshDiagnosis() {
    const student = this.data.student
    if (!student || !this.data.diagnosis) return
    this.setData({ diagnosis: diagnosisFor(student, this.data.diagnosis.selectedDate, this.homeworkState(student.id)) })
  },

  measureTabs() {
    if (this._tabsStickyThreshold !== undefined || !this.data.student) return
    wx.createSelectorQuery()
      .select('.dashboard-tabs')
      .boundingClientRect((rect) => {
        if (rect) this._tabsStickyThreshold = Math.max(0, rect.top - this.data.contentTop)
      })
      .exec()
  },

  handleDashboardScroll(event) {
    const scrollTop = (event.detail && event.detail.scrollTop) || 0
    const threshold = typeof this._tabsStickyThreshold === 'number' ? this._tabsStickyThreshold : Number.MAX_SAFE_INTEGER
    const tabsSticky = scrollTop >= threshold
    if (tabsSticky !== this.data.tabsSticky) this.setData({ tabsSticky })
  },

  handleTabChange(event) {
    const nextTab = event.currentTarget.dataset.id
    const currentIndex = TABS.findIndex((tab) => tab.id === this.data.activeTab)
    const nextIndex = TABS.findIndex((tab) => tab.id === nextTab)
    if (nextTab === this.data.activeTab || nextIndex < 0) return
    if (this._tabMotionTimer) clearTimeout(this._tabMotionTimer)
    const tabMotion = nextIndex > currentIndex ? 'tab-content-enter-from-right' : 'tab-content-enter-from-left'
    this.setData({ activeTab: nextTab, tabMotion: '' }, () => {
      this.setData({ tabMotion })
      this._tabMotionTimer = setTimeout(() => {
        this.setData({ tabMotion: '' })
        this._tabMotionTimer = null
      }, 240)
    })
  },

  handleDiagnosisDateChange(event) {
    const selectedDate = event.detail && event.detail.value
    const student = this.data.student
    if (!student || !selectedDate || selectedDate === this.data.diagnosis.selectedDate) return
    this.setData({ diagnosis: diagnosisFor(student, selectedDate, this.homeworkState(student.id)) })
  },

  openChildSwitcher() {
    if (this.data.children.length < 2) return
    if (this._switcherCloseTimer) clearTimeout(this._switcherCloseTimer)
    this.setData({ childSwitcherVisible: true, childSwitcherClosing: false, childSearch: '', visibleChildren: this.data.children })
  },

  onChildSearch(event) {
    const childSearch = String(event.detail.value || '')
    this.setData({ childSearch, visibleChildren: filterChildren(this.data.children, childSearch) })
  },

  closeChildSwitcher() {
    if (!this.data.childSwitcherVisible || this.data.childSwitcherClosing) return
    this.setData({ childSwitcherClosing: true })
    this._switcherCloseTimer = setTimeout(() => {
      this.setData({ childSwitcherVisible: false, childSwitcherClosing: false })
      this._switcherCloseTimer = null
    }, SWITCHER_CLOSE_MS)
  },

  async selectChild(event) {
    const childId = event.currentTarget.dataset.id
    this.closeChildSwitcher()
    if (!this.data.student || childId === this.data.student.id || this._switching) return
    const cached = this._details && this._details[String(childId)]
    if (cached) {
      this.setData(this.viewFor(cached, this.data.diagnosis && this.data.diagnosis.selectedDate))
      return this.loadPage(childId)
    }
    this._switching = true
    wx.showLoading({ title: '正在读取', mask: true })
    try {
      await this.loadPage(childId)
    } finally {
      this._switching = false
      wx.hideLoading()
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  // 这些页面都按家长关系读孩子的数据（学习动态、知识点报告、孩子积分、代付订单）
  openPage(event) {
    const student = this.data.student || {}
    const routes = {
      learningFeed: '/account/child-learning-feed/index',
      topicReports: '/account/topic-learning-report/index',
      credits: student.id ? `/commerce/entitlements/index?studentId=${student.id}` : '/commerce/entitlements/index',
      orders: '/commerce/orders/index',
      bind: '/account/bind-student/index'
    }
    const route = routes[event.currentTarget.dataset.target]
    if (route) wx.navigateTo({ url: route })
  }
})
