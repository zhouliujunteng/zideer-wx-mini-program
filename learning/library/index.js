const { loadMemberCourseLibrary, loadViewerAccess } = require('../../services/identity')
const { getMyCourseLibrary } = require('../../services/live-tab-service')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomCourseIntro } = require('../../utils/membership-gate')
const { guardAccess } = require('../../utils/access-gate')
const { rpxUnit } = require('../../utils/screen')
const { openPaymentPage, attachPaymentSwitch } = require('../../services/payment-switch')
const { seriesFilterTabs, filterBySeries } = require('../../utils/my-course-groups')

// 两种用法，同一套版式（设计稿 ui-ref/package-commerce/pages/courses）：
// - 默认：会员课程全部页（首页「查看全部」、会员中心），列课程服务的会员公共课；
// - scope=mine：「我的课程库」（学习页「我的课程」旁的「课程库」），只列学生自己的课程——
//   定制对话里做的课 + 学习计划课程，和「我的课程」同一份数据（2026-09-24 用户反馈：这里原来也进了会员课程）。

// 设计稿的 8 种封面底色；课程封面还没生成好时按序号轮换显示。
const TONES = ['coral', 'blue', 'lavender', 'mint', 'peach', 'sage', 'sky', 'sand']
// 「我的课程库」里有课还在制作时，页面可见期间每 5 秒刷新一次进度（与学习页同一节拍）。
const MY_COURSES_POLL_MS = 5000

function courseCard(course, index) {
  return {
    ...course,
    subtitle: [course.subject, course.grade ? `${course.grade} 年级` : ''].filter(Boolean).join(' · ') || '会员公共课程',
    priceLabel: course.isMember === false ? '会员专享' : '会员免费学',
    tone: TONES[index % TONES.length],
    searchText: `${course.title} ${course.subject} ${course.grade}`
  }
}

// 「我的课程」卡片（services/live-tab-service buildMyCourses）换成本页的卡片字段；最后一行写课程来源或制作进度。
function myCourseCard(course, index) {
  const isAgent = course.kind === 'agent'
  return {
    id: course.id,
    kind: isAgent ? 'agent' : 'plan',
    stageId: course.stageId || '',
    title: course.title,
    subtitle: course.subtitle || '',
    // 学没学写在副标题里（已学完 / 已学 2 / 5 页），这一行写属于哪个定制系列
    priceLabel: isAgent ? (course.isGenerating ? `制作中 ${course.progress}%` : course.canLearn ? (course.seriesTitle || '定制课程') : '没有制作成功') : '学习计划',
    coverUrl: course.coverUrl || '',
    tone: TONES[index % TONES.length],
    // 定制系列（诊断会议一次定制的几节课）：顶部按系列分别查看（2026-10-06）
    seriesId: isAgent ? course.seriesId || '' : '',
    seriesTitle: isAgent ? course.seriesTitle || '' : '',
    learned: course.learned === true,
    searchText: `${course.title} ${course.subtitle || ''} ${course.meta || ''} ${isAgent ? course.seriesTitle || '' : ''}`
  }
}

Page({
  data: {
    // 第一次读到课程前列表位只显示骨架卡片，不显示「正在读取」或「课程正在上架」；读到过一次后回到本页保留旧列表静默刷新。
    // 支付开关开着才显示会员中心 / 积分包入口（services/payment-switch.js attachPaymentSwitch，没读到过按关着）
    paymentOpen: false,
    loading: true, loaded: false, error: '', membershipRequired: false, courses: [], visibleCourses: [], search: '',
    mine: false, pageTitle: '会员课程',
    // 「我的课程库」的系列筛选：全部 / 每个系列 / 单节课程；没有系列时为空，不画筛选条
    seriesTabs: [], seriesFilter: 'all',
    statusBarHeight: 20, navigationBarHeight: 44, searchRegionTop: 64, searchRegionHeight: 64, contentTop: 128, isSearchHidden: false
  },
  onLoad(options = {}) {
    attachUiAssets(this)
    this.mine = options.scope === 'mine'
    if (this.mine) this.setData({ mine: true, pageTitle: '我的课程库' })
    // 顶栏高度对齐胶囊按钮；搜索区固定在顶栏下方，列表顶部留出同样高度。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    const rpx = rpxUnit(windowWidth)
    const searchRegionTop = statusBarHeight + navigationBarHeight
    const searchRegionHeight = (28 + 82 + 18) * rpx
    this.setData({ statusBarHeight, navigationBarHeight, searchRegionTop, searchRegionHeight, contentTop: searchRegionTop + searchRegionHeight })
  },
  onShow() {
    attachPaymentSwitch(this)
    this.loadCourses()
  },
  onHide() { this._requestVersion = (this._requestVersion || 0) + 1; this.stopPolling() },
  onUnload() { this._requestVersion = (this._requestVersion || 0) + 1; this.stopPolling() },
  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },
  schedulePolling() {
    this.stopPolling()
    this._pollTimer = setTimeout(() => this.loadCourses(), MY_COURSES_POLL_MS)
  },
  async loadCourses() {
    this.stopPolling()
    const version = this._requestVersion = (this._requestVersion || 0) + 1
    if (!this.data.loaded) this.setData({ loading: true, error: '', membershipRequired: false, courses: [], visibleCourses: [] })
    try {
      if (this.mine) {
        const mine = await getMyCourseLibrary()
        if (version !== this._requestVersion) return
        this.setData({ courses: mine.courses.map(myCourseCard), loaded: true, error: '' })
        this.filterCourses()
        this._hasGenerating = mine.hasGenerating
        if (mine.hasGenerating) this.schedulePolling()
        return
      }
      // 会员课程列表未登录也能看（2026-09-27 用户规则）；access 决定点课程时先去登录还是先完善学习资料
      const [courses, access] = await Promise.all([loadMemberCourseLibrary(), loadViewerAccess()])
      if (version !== this._requestVersion) return
      this.access = access
      this.setData({ courses: courses.map(courseCard), loaded: true, error: '', membershipRequired: false })
      this.filterCourses()
    } catch (error) {
      if (version !== this._requestVersion) return
      const membershipRequired = error.code === 'MEMBERSHIP_REQUIRED'
      // 静默刷新遇到网络类失败时保留旧列表（还有课在制作就接着按节拍重试）；会员失效是确定结果，照常显示。
      if (this.data.loaded && !membershipRequired) {
        if (this.mine && this._hasGenerating) this.schedulePolling()
        return
      }
      this.setData({ loaded: false, courses: [], visibleCourses: [], error: error.message || (this.mine ? '课程暂时没有读到，请稍后重试。' : '课程库暂时无法读取。'), membershipRequired })
    } finally {
      if (version === this._requestVersion) this.setData({ loading: false })
    }
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: this.mine ? '/pages/learning/index' : '/pages/home/index' })
  },
  searchCourses(event) {
    this.setData({ search: String(event.detail.value || '') })
    this.filterCourses()
  },
  clearSearch() {
    this.setData({ search: '' })
    this.filterCourses()
  },
  // 设计稿交互：向上滚动约 72px 收起搜索区，向下滚动 10px 或回到顶部时重新显示。
  handleScroll(event) {
    const scrollTop = Math.max(0, Number(event.detail && event.detail.scrollTop) || 0)
    const delta = scrollTop - (this._lastScrollTop || 0)
    this._lastScrollTop = scrollTop
    if (scrollTop <= 2) {
      this._up = 0; this._down = 0
      if (this.data.isSearchHidden) this.setData({ isSearchHidden: false })
      return
    }
    if (delta > 0) {
      this._up = (this._up || 0) + delta; this._down = 0
      if (this._up >= 72 && !this.data.isSearchHidden) { this._up = 0; this.setData({ isSearchHidden: true }) }
    } else if (delta < 0) {
      this._down = (this._down || 0) - delta; this._up = 0
      if (this._down >= 10 && this.data.isSearchHidden) { this._down = 0; this.setData({ isSearchHidden: false }) }
    }
  },
  openMembership() { return openPaymentPage('/commerce/membership/index', 'membership') },
  filterCourses() {
    const search = this.data.search.trim().toLowerCase()
    const matched = this.data.courses.filter((course) => course.searchText.toLowerCase().includes(search))
    if (!this.mine) return this.setData({ visibleCourses: matched })
    // 系列刚好消失（课程被挪出系列）时回到「全部」
    const seriesTabs = seriesFilterTabs(this.data.courses, this.data.seriesFilter)
    const active = seriesTabs.find((tab) => tab.active)
    const seriesFilter = active ? active.id : 'all'
    this.setData({ seriesTabs, seriesFilter, visibleCourses: filterBySeries(matched, seriesFilter) })
  },
  selectSeries(event) {
    const seriesFilter = String(event.currentTarget.dataset.id || 'all')
    if (seriesFilter === this.data.seriesFilter) return
    this.setData({ seriesFilter })
    this.filterCourses()
  },
  openCourse(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const course = this.data.courses.find((item) => item.id === id)
    if (!course) return
    if (this.mine) return this.openMyCourse(course)
    // 没登录、不是会员的先进定制课程介绍页（2026-09-30 用户要求，与首页一致）
    if (this.access === 'guest' || course.isMember === false) return openCustomCourseIntro(course)
    if (guardAccess(this.access, '完善学习资料后就能学习会员课程。')) return
    wx.navigateTo({ url: `/learning/course/index?libraryCourseId=${id}` })
  },
  // 与学习页「我的课程」一致：定制课程先进课程详情（学习课程 / 去验收 / 制作进度），学习计划课程直接进入课程。
  openMyCourse(course) {
    if (course.kind === 'agent') {
      if (!/^stage-[A-Za-z0-9_-]{1,64}$/.test(course.stageId)) return
      wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(course.stageId)}` })
      return
    }
    if (!/^[1-9][0-9]*$/.test(course.id)) return
    wx.navigateTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(course.id)}` })
  }
})
