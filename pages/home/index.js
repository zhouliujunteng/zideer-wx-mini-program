const { getMenuButtonRect } = require('../../utils/screen')
const { getLiveHomeModel } = require('../../services/live-tab-service')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomCourseIntro } = require('../../utils/membership-gate')
const { guardAccess } = require('../../utils/access-gate')
const { LIVE_SCORE_TOOLS } = require('../../utils/score-tools-live')

// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 d9627f0 的首页（2026-09-19 同步）。
// 提分工具：已上线的（utils/score-tools-live.js）进分包 score-tools 的工具页，其余仍提示「即将上线」。
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
    // 第一次读到真实数据前课程区显示骨架，不显示「课程正在上架」；之后切回首页保留旧数据静默刷新。
    loaded: false,
    loadFailed: false,
    skeletonCourses: [0, 1, 2, 3],
    primaryTools: SCORE_TOOLS.filter((tool) => tool.priority === 'primary'),
    secondaryToolPages: chunk(SCORE_TOOLS.filter((tool) => tool.priority === 'secondary'), SECONDARY_TOOLS_PER_PAGE),
    secondaryPage: 0,
    refreshing: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 76,
    streakEntryTop: 26,
    streakEntryRight: 100
  },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = getMenuButtonRect(windowInfo)
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      // 学习连胜入口紧贴胶囊左侧 8px，与胶囊顶对齐、同高。
      streakEntryTop: menuButton.top,
      streakEntryRight: windowWidth - menuButton.left + 8
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
      this.setData({ model: live.model, dashboard: live.dashboard, loaded: true, loadFailed: false })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (!this.data.loaded) this.setData({ loadFailed: true })
      // 未登录也能看首页（2026-09-27 用户规则），这里不再把游客送去登录；扫邀请码进来的，邀请码留在缓存里，登录建档后再绑
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
    const { id, label } = e.currentTarget.dataset
    if (!LIVE_SCORE_TOOLS.includes(id)) {
      wx.showToast({ title: `${String(label || '该功能')}即将上线`, icon: 'none' })
      return
    }
    // 次数与记录挂在学生档案上：没登录先登录、没建档先完善资料（用到时再登录，2026-09-27 规则）
    if (guardAccess(this.data.model.access, '完善学习资料后就能使用 AI 提分工具。')) return
    wx.navigateTo({ url: `/score-tools/tool/index?tool=${id}` })
  },

  // 物理实验室：纯静态网页，不读数据，游客也能进（不经 guardAccess）
  openPhysicsLab() {
    wx.navigateTo({ url: '/score-tools/physics-lab/index' })
  },

  // 「查看全部」进入会员课程全部页（设计稿 ui-ref/package-commerce/pages/courses）。
  openMembershipCatalog() {
    wx.navigateTo({ url: '/learning/library/index' })
  },

  openLibraryCourse(e) {
    const libraryCourseId = String(e.currentTarget.dataset.id || '')
    if (!/^[a-f0-9]{32}$/.test(libraryCourseId)) return
    // 课程列表人人能看（2026-09-27 用户规则）；没登录、不是会员的先进定制课程介绍页（2026-09-30 用户要求）
    const course = (this.data.model.moreCourses || []).find((item) => item.id === libraryCourseId)
    if (this.data.model.access === 'guest' || (course && course.isMember === false)) return openCustomCourseIntro(course || { id: libraryCourseId })
    if (guardAccess(this.data.model.access, '完善学习资料后就能学习会员课程。')) return
    wx.navigateTo({ url: `/learning/course/index?libraryCourseId=${libraryCourseId}` })
  },

  retryLoad() {
    this.setData({ loadFailed: false })
    return this.loadModel()
  },

  openLibraryList() {
    wx.navigateTo({ url: '/learning/library/index' })
  }
})
