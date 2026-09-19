const { getLiveHomeModel } = require('../../services/live-tab-service')
const { attachUiAssets } = require('../../services/ui-assets')

// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 d9627f0 的首页（2026-09-19 同步）。
// 提分工具在后端尚无对应功能，按用户决定先展示并提示「即将上线」；接入真实功能时只改 handleScoreToolTap。
// 设计稿第二屏的「占位」入口、课程分类与活动轮播没有真实数据，未移植。
const SCORE_TOOLS = Object.freeze([
  { id: 'question-review', label: '审题拆解', hint: '题目条件，快速拆解', tone: 'orange', priority: 'primary' },
  { id: 'error-diagnosis', label: '错因诊断', hint: '定位失分原因', tone: 'blue', priority: 'primary' },
  { id: 'solution-steps', label: '解题步骤', hint: '跟着步骤，稳稳解题', tone: 'green', priority: 'secondary' },
  { id: 'scoring-points', label: '得分要点', hint: '知道每一步怎样得分', tone: 'orange', priority: 'secondary' },
  { id: 'intuition-training', label: '题感训练', hint: '连续练习，形成题感', tone: 'green', priority: 'secondary' },
  { id: 'error-variation', label: '举一反三', hint: '从一道错题练会一类题', tone: 'blue', priority: 'secondary' },
  { id: 'paper-analysis', label: '试卷复盘', hint: '整卷复盘，找到增分点', tone: 'purple', priority: 'primary' }
])

const SECONDARY_TOOLS_PER_PAGE = 4
// 与设计稿一致：下拉后至少保持刷新态这么久，避免请求很快时指示器一闪而过。
const MIN_REFRESH_DURATION = 600

function chunk(items, size) {
  const pages = []
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size))
  return pages
}

Page({
  data: {
    model: { notifications: { count: 0 }, moreCourses: [] },
    primaryTools: SCORE_TOOLS.filter((tool) => tool.priority === 'primary'),
    secondaryToolPages: chunk(SCORE_TOOLS.filter((tool) => tool.priority === 'secondary'), SECONDARY_TOOLS_PER_PAGE),
    secondaryPage: 0,
    refreshing: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 76,
    notificationTop: 26,
    notificationRight: 100
  },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : {
        left: windowWidth - 92,
        top: (windowInfo.statusBarHeight || 20) + 6,
        width: 87,
        height: 32
      }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      // 消息按钮紧贴胶囊左侧 8px。
      notificationTop: menuButton.top,
      notificationRight: windowWidth - menuButton.left + 8
    })
  },

  onShow() {
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/home/index')
    return this.loadModel()
  },

  async loadModel() {
    // 只让最近一次请求落地：返回首页和下拉刷新可能同时在途。
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    try {
      const live = await getLiveHomeModel(0)
      if (requestId !== this._loadRequestId) return
      this.setData({ model: live.model, dashboard: live.dashboard })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      wx.showToast({ title: error.message || '首页数据加载失败', icon: 'none' })
    }
  },

  async handleRefresh() {
    if (this._refreshing) return
    this._refreshing = true
    this.setData({ refreshing: true })
    const startedAt = Date.now()
    await this.loadModel()
    const remaining = MIN_REFRESH_DURATION - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    this._refreshing = false
    this.setData({ refreshing: false })
  },

  handleSecondaryToolsChange(e) {
    const current = Number(e.detail && e.detail.current)
    if (Number.isInteger(current) && current !== this.data.secondaryPage) this.setData({ secondaryPage: current })
  },

  handleScoreToolTap(e) {
    const label = String(e.currentTarget.dataset.label || '该功能')
    wx.showToast({ title: `${label}即将上线`, icon: 'none' })
  },

  showNotifications() {
    wx.navigateTo({ url: '/pages/messages/index' })
  },

  openMembershipCatalog() {
    wx.navigateTo({ url: '/commerce/products/index' })
  },

  openLibraryCourse(e) {
    const libraryCourseId = String(e.currentTarget.dataset.id || '')
    if (!/^[a-f0-9]{32}$/.test(libraryCourseId)) return
    wx.navigateTo({ url: `/learning/course/index?libraryCourseId=${libraryCourseId}` })
  },

  openLibraryList() {
    wx.navigateTo({ url: '/learning/library/index' })
  }
})
