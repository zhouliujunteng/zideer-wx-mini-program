const { loadAgentCourse, loadAgentCourseAcceptance, loadAgentCoursePractice, loadCourseCovers, finishAgentCourseForTest, getStoredToken } = require('../../services/identity')
const { normalizePractice, practiceCard, gateReview } = require('../../utils/practice-view')
const { readDevResetCode, onDevResetChange } = require('../../utils/dev-reset')
const { isAgentCourseId, agentCourseDetail, normalizeAgentLearning } = require('../../utils/agent-course-view')
const { rpxToPx } = require('../../utils/screen')
const { openPaymentPage, attachPaymentSwitch } = require('../../services/payment-switch')

// 课程详情：「我的课程」点进来的二级页（设计稿 ui-ref M37 package-learning/pages/learning/generation）。
// 做好的课在这里学习（开始 / 继续 / 再次学习，按学习进度）或「去验收」，还在制作的课显示实时进度。

// 生成中每 3 秒读一次进度；离开页面停止，回到页面立即刷新。
const POLL_INTERVAL_MS = 3000
// 建课后马上点开卡片时生成记录可能还没登记：找不到课程时再等约 1 分钟。
const NOT_FOUND_RETRIES = 20

Page({
  data: {
    loading: true,
    // 免费体验第 4 节起要开会员（2026-11-11）：支付开关开着才给「开通」
    paymentOpen: false,
    course: null,
    detail: null,
    coverUrl: '',
    errorMessage: '',
    refreshing: false,
    // 第二关「互动练习」卡片（utils/practice-view.js practiceCard；以前的课后作业也用它）：第一次读到前画骨架，读不到显示「点一下重读」。
    homework: null,
    homeworkFailed: false,
    // 测试快捷方式「标记学完，去验收」：只在输入过「重置测试账号」开启码的手机上显示（与右下角重置按钮同一个开关）。
    testFinishVisible: false,
    testFinishing: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80
  },

  onLoad(options = {}) {
    this.stageId = String(options.stageId || '')
    this._offDevReset = onDevResetChange(() => this.refreshTestFinish())
    // 顶栏高度对齐胶囊按钮，内容从顶栏下方 18rpx 开始（与设计稿一致）。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(18, windowInfo.windowWidth || 375)
    })
  },

  onShow() {
    attachPaymentSwitch(this)
    this._visible = true
    this.refreshTestFinish()
    // 封面可能是上次进来之后才生成好的：每次回到页面最多再取一次。
    this._coverRequested = false
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this._version = (this._version || 0) + 1
    this.stopPolling()
  },

  onUnload() {
    this.onHide()
    if (this._offDevReset) this._offDevReset()
    this._offDevReset = null
  },

  refreshTestFinish() {
    const visible = Boolean(getStoredToken()) && Boolean(readDevResetCode())
    if (visible !== this.data.testFinishVisible) this.setData({ testFinishVisible: visible })
  },

  stopPolling() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  },

  reload() {
    this.setData({ loading: !this.data.course, errorMessage: '' })
    return this.refresh()
  },

  async refresh() {
    this.stopPolling()
    const version = this._version = (this._version || 0) + 1
    if (!isAgentCourseId(this.stageId)) {
      this.setData({ loading: false, course: null, errorMessage: '课程链接无效，请回到对话重新打开。' })
      return
    }
    // 学习进度只有做好的课才有：第一次进页面与课程一起读（不先显示页数再换成进度），制作中轮询时不读。
    const current = this.data.course
    const learningRequest = !current || current.canLearn ? this.readLearning() : null
    try {
      const course = await loadAgentCourse(this.stageId)
      const learning = course.canLearn ? await (learningRequest || this.readLearning()) : null
      if (!this._visible || version !== this._version) return
      this._notFound = 0
      const detail = agentCourseDetail(course, learning)
      // 验收卡要等互动练习通关（闯关学习，2026-11-11）：练习卡读到过就按它锁 / 放开
      this._review = detail.review
      detail.review = gateReview(detail.review, this.data.homework)
      this.setData({ loading: false, course, detail, errorMessage: '' })
      this.loadCover()
      if (course.canLearn) this.loadHomework()
      if (course.isGenerating) this.schedule()
    } catch (error) {
      if (!this._visible || version !== this._version) return
      const message = error && error.message || '课程进度暂时无法读取，请稍后重试。'
      // 已经显示过进度时只提示一行，继续按节拍重试；首次读取失败才显示错误页。
      this.setData({ loading: false, errorMessage: this.data.course ? '网络不稳定，正在重新读取进度…' : message })
      if (this.data.course && this.data.course.isGenerating) this.schedule()
      else if (!this.data.course && error && error.statusCode === 404 && (this._notFound = (this._notFound || 0) + 1) <= NOT_FOUND_RETRIES) this.schedule()
    }
  },

  // 学习进度来自验收接口（只读，不调用模型）；读不到时卡片退回显示页数，不影响其余内容。
  readLearning() {
    return loadAgentCourseAcceptance(this.stageId)
      .then((data) => normalizeAgentLearning(data && data.acceptance && data.acceptance.learning))
      .catch(() => null)
  },

  // 第二关「互动练习」（2026-11-11 闯关学习，取代 2026-10-13 的课后作业；以前排的作业照旧显示成课后作业）：
  // 整节学完后才有；读到过一次后再回到页面保留旧卡片，静默刷新。练习没通关时验收卡锁住（gateReview）。
  loadHomework() {
    const stageId = this.stageId
    return Promise.resolve()
      .then(() => loadAgentCoursePractice(stageId))
      .then((data) => {
        if (stageId !== this.stageId) return
        const card = practiceCard(normalizePractice(data && data.practice))
        const update = { homework: card, homeworkFailed: false }
        if (this._review) update['detail.review'] = gateReview(this._review, card)
        this.setData(update)
      })
      .catch(() => {
        if (stageId !== this.stageId || this.data.homework) return
        this.setData({ homework: practiceCard(null, true), homeworkFailed: true })
      })
  },

  openHomework() {
    const card = this.data.homework
    if (!card) return
    if (!card.available) {
      wx.showToast({ title: card.toast || '先把这节课学完', icon: 'none' })
      return
    }
    if (card.action === 'reload') {
      this.setData({ homework: null, homeworkFailed: false })
      return this.loadHomework()
    }
    const page = card.homework ? 'homework' : 'practice'
    wx.navigateTo({ url: `/learning/${page}/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  // 封面与「我的课程」卡片同一张（课程服务按 stageId 存）；还没生成好就显示设计稿的淡灰占位。
  loadCover() {
    if (this.data.coverUrl || this._coverRequested) return
    this._coverRequested = true
    const stageId = this.stageId
    loadCourseCovers([stageId])
      .then((covers) => { if (covers[stageId] && stageId === this.stageId) this.setData({ coverUrl: covers[stageId] }) })
      .catch(() => { this._coverRequested = false })
  },

  schedule() {
    if (!this._visible) return
    this.stopPolling()
    this._timer = setTimeout(() => this.refresh(), POLL_INTERVAL_MS)
  },

  // 下拉刷新：验收状态（老师核验）等变化不必退出页面再进来。
  async handlePullRefresh() {
    if (this._pulling) return
    this._pulling = true
    this.setData({ refreshing: true })
    try {
      await this.refresh()
    } finally {
      this._pulling = false
      this.setData({ refreshing: false })
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/learning/index' })
  },

  startLearning() {
    const course = this.data.course
    if (!course || !course.canLearn) return
    if (course.lock) return this.openPrevious()
    wx.navigateTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(course.stageId)}` })
  },

  // 「课程内容」点某一页：从这一页开始学（课程服务 /learn?scene=）；学完退回来，onShow 刷新这一页的学习状态。
  openPage(event) {
    const course = this.data.course
    const order = Number(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.order)
    const row = this.data.detail && (this.data.detail.pages || []).find((item) => item.order === order)
    if (!course || !course.canLearn || !row) return
    if (course.lock) return this.openPrevious()
    if (!row.openable) {
      if (row.segmentLocked) wx.showToast({ title: '闯关不能跳：先学完前面这一段', icon: 'none' })
      else if (row.status === 'failed') wx.showToast({ title: '这一页没有做好，先学其他页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(course.stageId)}&sceneId=${encodeURIComponent(row.sceneId)}` })
  },

  // 系列课按顺序学（2026-10-15）：这一节锁着时换成上一节的课程详情（返回时不回到锁着的这一节）。
  openPrevious() {
    const lock = this.data.course && this.data.course.lock
    if (!lock) return
    if (lock.paywall) {
      if (this.data.paymentOpen) openPaymentPage('/commerce/membership/index', 'membership')
      else wx.showToast({ title: '免费体验开放前 3 节课，后面的课开通会员后解锁', icon: 'none', duration: 3000 })
      return
    }
    wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(lock.previousStageId)}` })
  },

  // 课程没做好、或读到了学习进度且还没学完时只提示；读不到进度时放行，验收页自己会判断（没学完引导回去继续学）。
  openAcceptance() {
    const course = this.data.course
    const review = this.data.detail && this.data.detail.review
    if (!course || !review) return
    if (!review.available) {
      wx.showToast({ title: review.toast, icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/learning/agent-acceptance/index?stageId=${encodeURIComponent(course.stageId)}` })
  },

  // 测试用：课程服务把这门课每一页记成学完，然后直接进复述验收（不算当天打卡）。
  finishForTest() {
    const course = this.data.course
    if (!course || !course.canLearn || this.data.testFinishing) return
    wx.showModal({
      title: '标记学完（测试）',
      content: '把这门课的全部页面记成已学完，然后直接去复述验收。只用于测试，确认继续吗？',
      confirmText: '标记学完',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ testFinishing: true })
        wx.showLoading({ title: '正在标记', mask: true })
        try {
          await finishAgentCourseForTest(course.stageId)
          wx.hideLoading()
          wx.navigateTo({ url: `/learning/agent-acceptance/index?stageId=${encodeURIComponent(course.stageId)}` })
        } catch (error) {
          wx.hideLoading()
          // 课程服务写不进去的页（旧版课程留下的记录对不上）会报 COURSE_NOT_FINISHED，与真没学完区分开。
          const message = error && error.code === 'COURSE_NOT_FINISHED'
            ? '有几页没能标记成学完，请从课程里学完这几页。'
            : error && error.message || '没有标记成功，请稍后重试。'
          wx.showToast({ title: message, icon: 'none', duration: 3000 })
          this.refreshTestFinish()
        } finally {
          this.setData({ testFinishing: false })
        }
      }
    })
  },

  openMyCourses() {
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
