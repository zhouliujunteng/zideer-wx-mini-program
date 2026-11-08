const { getLiveLearningModel, getLearningSkeletonModel } = require('../../services/live-tab-service')
const { takeAgentCourseFocus } = require('../../utils/agent-course-focus')
const { loadCurrentServiceContacts, hasSession } = require('../../services/identity')
const { openLogin, openAccessStep, guardAccess } = require('../../utils/access-gate')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx, getMenuButtonRect } = require('../../utils/screen')
const { MY_COURSE_TABS, customCourseView, seriesFilterTabs, filterBySeries } = require('../../utils/my-course-groups')
const { loadAchievementCards, stripCards, findSeries } = require('../../services/achievement-cards')

const TASK_LIST_SWAP_DURATION = 150
const TASK_LIST_ENTER_FRAME = 16
const LEARNING_TASK_LIST_ROW_HEIGHT = 96
const LEARNING_TASK_LIST_ROW_GAP = 20
// 对话里刚提交生成的课程可能还没登记到「我的课程」：按刷新节拍（5 秒）最多再等约 1 分钟。
const AGENT_COURSE_FOCUS_RETRIES = 12
const AGENT_COURSE_HIGHLIGHT_MS = 6000
const MY_COURSES_ANCHOR = 'my-courses-anchor'

function getLearningTaskListHeight(model) {
  const taskCount = model && model.studyTasks ? model.studyTasks.length : 0
  const visibleCount = Math.max(taskCount, 1)
  return visibleCount * LEARNING_TASK_LIST_ROW_HEIGHT + Math.max(visibleCount - 1, 0) * LEARNING_TASK_LIST_ROW_GAP
}

function triggerDateSwitchFeedback() {
  if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
}

Page({
  data: {
    model: {},
    // 第一次读到真实数据前，数字、任务和课程位显示骨架；之后切回学习页保留旧数据静默刷新。
    loaded: false,
    loadFailed: false,
    // guest 未登录、profile 没完善学习资料（2026-09-27 起未登录也能浏览）：任务、课程位换成去登录 / 去完善的提示
    access: 'ready',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 80,
    streakEntryTop: 26,
    streakEntryRight: 100,
    selectedStudyDayIndex: 0,
    calendarPinned: false,
    calendarPinThreshold: 0,
    calendarScrollAnchor: 'study-day-0',
    showTodayOverview: true,
    numberRollVersion: 0,
    numberRollClass: 'overview-digit-settled',
    taskListVersion: 0,
    taskListClass: 'study-task-list-settled',
    taskListHeight: LEARNING_TASK_LIST_ROW_HEIGHT,
    courseSearch: '',
    visibleMyCourses: [],
    // 「全部课程」按系列筛：全部 / 每个系列 / 单节课程（没有系列时 seriesTabs 为空、不画筛选条）
    mySeries: 'all',
    seriesTabs: [],
    seriesCourses: [],
    // 「我的课程」两栏：全部课程 / 我的定制课程（未学、已学，按系列分组；utils/my-course-groups.js）
    myCourseTabs: MY_COURSE_TABS.map((tab) => ({ ...tab, active: tab.id === 'all' })),
    myCourseTab: 'all',
    customFilter: 'unlearned',
    customView: customCourseView([], 'unlearned'),
    focusCourseId: '',
    courseScrollAnchor: '',
    // 「联系老师定制课程」（原「我的」页企微服务）：只在点卡片时用，读不到就进服务入口页
    enterpriseContacts: [],
    enterpriseServiceOpening: false,
    // 成就卡（2026-10-13）：头图一句话、横条与抽卡浮层；单独读取，不拖慢学习任务和课程
    cards: { quote: '', ownedLevels: 0, totalLevels: 0, drawsAvailable: 0, series: [] },
    cardsLoaded: false,
    topbarOnHero: true,
    cardsFailed: false,
    stripCards: [],
    heroCard: null,
    openCard: null,
    openSeries: null,
    openOrigin: null,
    openCardId: 0
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    // 服务号菜单「已定课程」打开 pages/learning/index?tab=custom：直接停在「我的课程 › 我的定制课程」
    if (options.tab) getApp().globalData.learningTab = String(options.tab)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = getMenuButtonRect(windowInfo)
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2

    const initialModel = getLearningSkeletonModel(0)
    this._calendarPinnedState = false
    this.setData({
      model: initialModel,
      taskListHeight: getLearningTaskListHeight(initialModel),
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(16, windowWidth),
      // 学习连胜入口紧贴胶囊左侧 8px，与胶囊顶对齐、同高。
      streakEntryTop: menuButton.top,
      streakEntryRight: windowWidth - menuButton.left + 8
    }, () => this.measureCalendarPinThreshold())
  },

  measureCalendarPinThreshold() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .select('.calendar-days-slot')
        .boundingClientRect((rect) => {
          if (!rect) return
          const threshold = Math.max(1, Math.round(rect.top - this.data.contentTop))
          this.setData({ calendarPinThreshold: threshold })
        })
        .exec()
    })
  },

  // 滚动事件有节流，快速滑回顶部时最后一次可能停在 60px 以下：到顶事件兜底切回头图色
  handleScrollToUpper() {
    this.setTopbarOnHero(true)
  },

  setTopbarOnHero(onHero) {
    if (onHero === this._topbarOnHero) return
    this._topbarOnHero = onHero
    this.setData({ topbarOnHero: onHero })
  },

  handlePageScroll(e) {
    const scrollTop = Math.max(0, e.detail && e.detail.scrollTop ? e.detail.scrollTop : 0)
    // 顶栏在头图上方时与头图同色（融为一体），滚过头图后换回页面底色
    this.setTopbarOnHero(scrollTop < 60)
    const threshold = this.data.calendarPinThreshold
    if (!threshold) return
    const calendarPinned = scrollTop >= threshold
    if (calendarPinned === this._calendarPinnedState) return
    // 以实例状态作为单帧内的唯一来源，避免快速滚动时 setData 尚未回写而重复切换 class。
    this._calendarPinnedState = calendarPinned
    this.setData({ calendarPinned })
  },

  async onShow() {
    this._visible = true
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/learning/index')
    this.applyRequestedCourseTab(app)
    // 从对话的课程卡片跳过来：这次刷新之后聚焦到那门课。
    const focusStageId = takeAgentCourseFocus()
    if (focusStageId) {
      this._focusStageId = focusStageId
      this._focusAttempts = 0
    }
    // 上次显示的是去登录 / 去完善的提示：这次可能刚登录或刚建完档，回到骨架重新读，不先把提示当旧数据留着
    if (this.data.loaded && this.data.access !== 'ready') this.setData({ loaded: false, loadFailed: false })
    this.loadEnterpriseContacts()
    await this.refreshLearning()
    if (!this.data.openCard) this.loadCards()
  },

  // 成就卡：只给已建档的学生读（游客、没建档的显示提示卡）。第一次读到前画骨架，之后静默刷新保留旧数据。
  async loadCards() {
    if (this.data.access !== 'ready' || !this.data.loaded) return
    const version = this._cardsVersion = (this._cardsVersion || 0) + 1
    try {
      const cards = await loadAchievementCards()
      if (version !== this._cardsVersion) return
      this.applyCards(cards)
      this.setData({ cardsLoaded: true, cardsFailed: false }, () => this.measureCalendarPinThreshold())
    } catch (error) {
      if (version === this._cardsVersion && !this.data.cardsLoaded) this.setData({ cardsFailed: true })
    }
  },

  applyCards(cards) {
    const strip = stripCards(cards)
    this.setData({ cards, stripCards: strip, heroCard: strip.find((c) => c.ownedLevels && c.cover) || null })
  },

  openAllCards() {
    if (guardAccess(this.data.access, '完善学习资料后就能集卡。')) return
    wx.navigateTo({ url: '/learning/achievement-cards/index' })
  },

  openStripCard(e) {
    const id = Number(e.currentTarget.dataset.id)
    const card = this.data.stripCards.find((c) => c.id === id)
    if (!card || this.data.openCard) return
    wx.createSelectorQuery()
      .select(`#strip-card-${id} .ach-strip-card`)
      .boundingClientRect((rect) => {
        this.setTabBarHidden(true)
        this.setData({ openCard: card, openSeries: findSeries(this.data.cards, card.seriesId), openOrigin: rect || null, openCardId: id })
      })
      .exec()
  },

  // 浮层打开时收起自定义底栏，模糊遮罩才盖得住整屏（同首页「设为星标」引导）
  setTabBarHidden(hidden) {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
    if (tabBar && tabBar.data && tabBar.data.hidden !== hidden) tabBar.setData({ hidden })
  },

  // 抽过卡：关掉浮层时重新读（次数、碎片、点亮情况都以服务端为准）
  handleDrawn() {
    this._cardsDrawn = true
  },

  handleRevealClose() {
    this.setTabBarHidden(false)
    this.setData({ openCard: null, openSeries: null, openOrigin: null, openCardId: 0 })
    if (this._cardsDrawn) {
      this._cardsDrawn = false
      this.loadCards()
    }
  },

  async loadEnterpriseContacts() {
    const version = this._contactsVersion = (this._contactsVersion || 0) + 1
    // 游客点「联系老师定制课程」先去登录，不读客服入口
    if (!hasSession()) { this.setData({ enterpriseContacts: [] }); return }
    try {
      const result = await loadCurrentServiceContacts()
      if (version === this._contactsVersion) this.setData({ enterpriseContacts: result.status === 'ready' ? result.contacts : [] })
    } catch (error) {
      if (version === this._contactsVersion) this.setData({ enterpriseContacts: [] })
    }
  },

  // 只有一个企微客服入口时直接打开会话；没有或有多个时进服务入口页（那里会说明原因或让学生选）。
  async openEnterpriseService() {
    if (this.data.enterpriseServiceOpening) return
    if (!hasSession()) return openLogin()
    const contacts = this.data.enterpriseContacts || []
    if (contacts.length !== 1) {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    this.setData({ enterpriseServiceOpening: true })
    try {
      await openCustomerServiceChat(contacts[0])
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ enterpriseServiceOpening: false })
    }
  },

  async refreshLearning(silent = false) {
    this.stopProgressPolling()
    const version = this._dateLoadVersion = (this._dateLoadVersion || 0) + 1
    try {
      const live = await getLiveLearningModel(this.data.selectedStudyDayIndex)
      if (!this._visible || version !== this._dateLoadVersion) return
      this.setData({
        model: live.model,
        dashboard: live.dashboard,
        access: live.access || 'ready',
        ...this.myCourseViews(live.model.myCourses, this.data.courseSearch),
        taskListHeight: getLearningTaskListHeight(live.model),
        loaded: true,
        loadFailed: false
      })
      this.applyAgentCourseFocus()
    } catch (error) {
      if (this._visible && version === this._dateLoadVersion && !this.data.loaded) this.setData({ loadFailed: true })
      if (this._visible && version === this._dateLoadVersion && !silent) wx.showToast({ title: error.message || '学习数据加载失败', icon: 'none' })
    } finally {
      if (version === this._dateLoadVersion) this.scheduleProgressPolling()
    }
  },

  stopProgressPolling() {
    if (this._progressTimer) clearTimeout(this._progressTimer)
    this._progressTimer = null
  },

  scheduleProgressPolling() {
    this.stopProgressPolling()
    const tasks = this.data.dashboard && this.data.dashboard.tasks || []
    const agentGenerating = Boolean(this.data.model && this.data.model.hasGeneratingAgentCourse)
    if (this._visible && (this._focusStageId || agentGenerating || tasks.some(task => task.canPoll))) this._progressTimer = setTimeout(() => this.refreshLearning(true), 5000)
  },

  async onPullDownRefresh() {
    await this.refreshLearning()
    await this.loadCards()
    wx.stopPullDownRefresh()
  },

  onUnload() { this.onHide() },

  onHide() {
    this._visible = false
    this._dateLoadVersion = (this._dateLoadVersion || 0) + 1
    this.stopProgressPolling()
    this.clearCourseHighlight()
    // 锚点清空后再次进入才会重新滚动到「我的课程」。
    if (this.data.courseScrollAnchor || this.data.focusCourseId) this.setData({ courseScrollAnchor: '', focusCourseId: '' })
    if (this._taskListSwapTimer) {
      clearTimeout(this._taskListSwapTimer)
      this._taskListSwapTimer = null
    }
    if (this._taskListEnterTimer) {
      clearTimeout(this._taskListEnterTimer)
      this._taskListEnterTimer = null
    }
    if (this._pendingTaskListModel) {
      this.setData({
        model: this._pendingTaskListModel,
        taskListClass: 'study-task-list-settled',
        taskListHeight: getLearningTaskListHeight(this._pendingTaskListModel)
      })
      this._pendingTaskListModel = null
    } else if (this.data.taskListClass === 'study-task-list-enter-prep') {
      this.setData({ taskListClass: 'study-task-list-settled' })
    }
  },

  // 「我的课程」旁的「课程库」：学生自己的全部课程（learning/library 的 scope=mine），不是会员公共课程。
  openLibrary() {
    if (guardAccess(this.data.access, '完善学习资料后就能查看你的课程。')) return
    wx.navigateTo({ url: '/learning/library/index?scope=mine' })
  },
  // 任务、课程位上的提示卡：游客去登录，没建档的去完善学习资料
  openAccessStep() {
    openAccessStep(this.data.access)
  },
  filterMyCourses(courses = this.data.model.myCourses || [], search = this.data.courseSearch) {
    const needle = String(search || '').trim().toLowerCase()
    return courses.filter((course) => !needle || `${course.title} ${course.meta} ${course.subtitle || ''} ${course.seriesTitle || ''}`.toLowerCase().includes(needle))
  },
  // 搜索对两栏都生效：全部课程的列表，和「我的定制课程」的未学 / 已学分组
  myCourseViews(courses = this.data.model.myCourses || [], search = this.data.courseSearch, filter = this.data.customFilter, series = this.data.mySeries) {
    const visibleMyCourses = this.filterMyCourses(courses, search)
    const seriesTabs = seriesFilterTabs(visibleMyCourses, series)
    const active = seriesTabs.find((tab) => tab.active)
    const mySeries = active ? active.id : 'all'
    return {
      visibleMyCourses,
      mySeries,
      seriesTabs,
      seriesCourses: filterBySeries(visibleMyCourses, mySeries),
      customView: customCourseView(visibleMyCourses, filter)
    }
  },
  switchMySeries(event) {
    const series = String(event.currentTarget.dataset.id || '')
    if (!series || series === this.data.mySeries) return
    this.setData(this.myCourseViews(this.data.model.myCourses, this.data.courseSearch, this.data.customFilter, series))
  },
  searchMyCourses(event) {
    const courseSearch = String(event.detail && event.detail.value || '')
    this.setData({ courseSearch, ...this.myCourseViews(this.data.model.myCourses, courseSearch) })
  },
  clearMyCourseSearch() {
    this.setData({ courseSearch: '', ...this.myCourseViews(this.data.model.myCourses, '') })
  },
  // 外部指定要打开的「我的课程」栏（服务号菜单「已定课程」带 tab=custom，由 app.js / onLoad 记在 globalData），用一次就清掉
  applyRequestedCourseTab(app) {
    const data = app && app.globalData
    const requested = data && data.learningTab
    if (!requested) return
    data.learningTab = ''
    if (!MY_COURSE_TABS.some((tab) => tab.id === requested) || requested === this.data.myCourseTab) return
    this.setData({ myCourseTab: requested, myCourseTabs: MY_COURSE_TABS.map((tab) => ({ ...tab, active: tab.id === requested })) })
  },

  switchMyCourseTab(event) {
    const myCourseTab = String(event.currentTarget.dataset.id || '')
    if (!MY_COURSE_TABS.some((tab) => tab.id === myCourseTab) || myCourseTab === this.data.myCourseTab) return
    this.setData({ myCourseTab, myCourseTabs: MY_COURSE_TABS.map((tab) => ({ ...tab, active: tab.id === myCourseTab })) })
  },
  switchCustomFilter(event) {
    const customFilter = String(event.currentTarget.dataset.id || '')
    if (customFilter === this.data.customFilter) return
    const view = customCourseView(this.data.visibleMyCourses, customFilter)
    this.setData({ customFilter: view.filter, customView: view })
  },
  // 对话里的课程链接落到这里：已经生成好的课直接进入学习，还在生成的课滚到「我的课程」并高亮，
  // 进度就显示在卡片上。刚提交生成时课程可能还没登记，按刷新节拍再等几轮。
  applyAgentCourseFocus() {
    const stageId = this._focusStageId
    if (!stageId) return
    const course = (this.data.model.myCourses || []).find((item) => item.kind === 'agent' && item.stageId === stageId)
    if (!course) {
      // 等几轮还是没登记：如实说一声。这里原来是静默放弃——学生点了课程链接跳过来，
      // 屏幕上什么都没有、也没有任何提示，只能以为是页面坏了。
      if ((this._focusAttempts = (this._focusAttempts || 0) + 1) > AGENT_COURSE_FOCUS_RETRIES) {
        this._focusStageId = ''
        wx.showToast({ title: '这门课还没开始生成，回到对话里让老师再确认一次', icon: 'none', duration: 3000 })
      }
      return
    }
    this._focusStageId = ''
    // 系列里还没解锁的课（上一节没学完进复述验收）进课程页，那里写着先学哪一节。
    if (course.canLearn && course.locked) {
      wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(stageId)}` })
      return
    }
    if (course.canLearn) {
      wx.navigateTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(stageId)}` })
      return
    }
    this.clearCourseHighlight()
    // 系列筛选可能把这门课筛掉了，先回到「全部」
    const views = this.data.mySeries === 'all' ? {} : this.myCourseViews(this.data.model.myCourses, this.data.courseSearch, this.data.customFilter, 'all')
    this.setData({ ...views, focusCourseId: course.id, courseScrollAnchor: MY_COURSES_ANCHOR })
    this._highlightTimer = setTimeout(() => {
      this._highlightTimer = null
      if (this._visible) this.setData({ focusCourseId: '' })
    }, AGENT_COURSE_HIGHLIGHT_MS)
  },

  clearCourseHighlight() {
    if (this._highlightTimer) clearTimeout(this._highlightTimer)
    this._highlightTimer = null
  },

  openMyCourse(event) {
    const dataset = event.currentTarget.dataset || {}
    if (dataset.kind === 'agent') {
      const course = (this.data.model.myCourses || []).find((item) => item.id === dataset.id)
      if (!course || !/^stage-[A-Za-z0-9_-]{1,64}$/.test(course.stageId)) return
      // 一律先进课程页：做好的课在那里选「学习课程」或「去验收」，还在制作的课在那里看进度。
      wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(course.stageId)}` })
      return
    }
    const courseInstanceId = String(dataset.id || '')
    if (!/^[1-9][0-9]*$/.test(courseInstanceId)) return
    wx.navigateTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(courseInstanceId)}` })
  },
  openPlans() { wx.navigateTo({ url: '/diagnosis/plans/index' }) },
  createPlan() { wx.navigateTo({ url: '/diagnosis/plan-generation/index' }) },

  openTask(e) {
    const dataset = e.currentTarget.dataset || {}
    // 间隔复习：到期的、今天做完的都进复习小测页（做完的看结果）
    if (dataset.kind === 'review') {
      const stageId = String(dataset.stageId || '')
      if (!/^stage-[A-Za-z0-9_-]{1,64}$/.test(stageId)) return
      wx.navigateTo({ url: `/learning/review/index?stageId=${encodeURIComponent(stageId)}` })
      return
    }
    // 老师排课的任务：没学完的直接从这条任务第一页没学的开始学；学完的进课程页（复习或去验收）。
    if (dataset.kind === 'study-plan') {
      const stageId = String(dataset.stageId || '')
      if (!/^stage-[A-Za-z0-9_-]{1,64}$/.test(stageId)) return
      if (dataset.done === true) {
        wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(stageId)}` })
        return
      }
      const sceneId = String(dataset.sceneId || '')
      const scene = /^[A-Za-z0-9_-]{1,80}$/.test(sceneId) ? `&sceneId=${encodeURIComponent(sceneId)}` : ''
      wx.navigateTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(stageId)}${scene}` })
      return
    }
    const planItemId = String(dataset.id || '')
    if (!planItemId) return
    const currentTask = this.data.dashboard && this.data.dashboard.currentTask
    const courseInstanceId = currentTask && String(currentTask.id) === planItemId
      ? String(currentTask.generationCourseInstanceId || '')
      : ''
    wx.navigateTo({ url: `/learning/generation-status/index?planItemId=${encodeURIComponent(planItemId)}&courseInstanceId=${encodeURIComponent(courseInstanceId)}` })
  },

  returnToToday() {
    if (this.data.selectedStudyDayIndex === 0) return
    this.selectStudyDay(0)
  },

  async selectStudyDay(selectedStudyDayIndex) {
    this.stopProgressPolling()
    const previousStudyDayIndex = this.data.selectedStudyDayIndex
    const requestVersion = (this._dateLoadVersion || 0) + 1
    this._dateLoadVersion = requestVersion
    const numberRollVersion = this.data.numberRollVersion + 1
    const taskListVersion = this.data.taskListVersion + 1
    let live
    try {
      live = await getLiveLearningModel(selectedStudyDayIndex)
    } catch (error) {
      if (requestVersion === this._dateLoadVersion) wx.showToast({ title: error.message || '学习任务加载失败', icon: 'none' })
      this.scheduleProgressPolling()
      return
    }
    if (requestVersion !== this._dateLoadVersion) return
    const nextModel = live.model
    triggerDateSwitchFeedback()
    const leavingModel = {
      ...nextModel,
      studyTasks: this.data.model.studyTasks || [],
      studyTaskEmptyText: this.data.model.studyTaskEmptyText || ''
    }
    if (this._taskListSwapTimer) clearTimeout(this._taskListSwapTimer)
    this._pendingTaskListModel = nextModel
    this.setData({
      selectedStudyDayIndex,
      showTodayOverview: selectedStudyDayIndex === 0,
      calendarScrollAnchor: `study-day-${selectedStudyDayIndex}`,
      numberRollVersion,
      numberRollClass: numberRollVersion % 2 ? 'overview-digit-roll-a' : 'overview-digit-roll-b',
      taskListVersion,
      taskListClass: 'study-task-list-leaving',
      // 与概览卡同时开始高度过渡，避免待办事项先上移再被任务列表撑下去。
      taskListHeight: getLearningTaskListHeight(nextModel),
      model: leavingModel,
      dashboard: live.dashboard,
      access: live.access || 'ready',
      loaded: true,
      loadFailed: false
    })
    this._taskListSwapTimer = setTimeout(() => {
      this._taskListSwapTimer = null
      if (this._pendingTaskListModel !== nextModel) return
      this._pendingTaskListModel = null
      this.setData({
        model: nextModel,
        taskListClass: 'study-task-list-enter-prep'
      })
      this._taskListEnterTimer = setTimeout(() => {
        this._taskListEnterTimer = null
        this.setData({ taskListClass: 'study-task-list-enter' })
      }, TASK_LIST_ENTER_FRAME)
    }, TASK_LIST_SWAP_DURATION)
    this.scheduleProgressPolling()
  },

  handleStudyDateSelect(e) {
    const selectedStudyDayIndex = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(selectedStudyDayIndex) || selectedStudyDayIndex === this.data.selectedStudyDayIndex) return
    this.selectStudyDay(selectedStudyDayIndex)
  }
})
