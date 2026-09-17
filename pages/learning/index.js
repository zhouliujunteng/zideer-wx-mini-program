const { getLearningModel } = require('../../services/mock-service')
const { getLiveLearningModel } = require('../../services/live-tab-service')

const TASK_LIST_SWAP_DURATION = 150
const TASK_LIST_ENTER_FRAME = 16
const LEARNING_TASK_LIST_ROW_HEIGHT = 96
const LEARNING_TASK_LIST_ROW_GAP = 20

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
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 80,
    notificationTop: 26,
    notificationRight: 100,
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
    visibleMyCourses: []
  },

  onLoad() {
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

    const initialModel = getLearningModel(new Date(), 0, 0)
    this._calendarPinnedState = false
    this.setData({
      model: initialModel,
      taskListHeight: getLearningTaskListHeight(initialModel),
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop: statusBarHeight + navigationBarHeight + 16 * windowWidth / 750,
      notificationTop: menuButton.top,
      notificationRight: windowWidth - menuButton.left + 8
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

  handlePageScroll(e) {
    const threshold = this.data.calendarPinThreshold
    if (!threshold) return
    const scrollTop = Math.max(0, e.detail && e.detail.scrollTop ? e.detail.scrollTop : 0)
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
    if (!this.data.model.calendarTitle) {
      const model = getLearningModel(new Date(), this.data.selectedStudyDayIndex)
      this.setData({ model, taskListHeight: getLearningTaskListHeight(model) })
    }
    await this.refreshLearning()
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
        visibleMyCourses: this.filterMyCourses(live.model.myCourses, this.data.courseSearch),
        taskListHeight: getLearningTaskListHeight(live.model)
      })
    } catch (error) {
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
    if (this._visible && (agentGenerating || tasks.some(task => task.canPoll))) this._progressTimer = setTimeout(() => this.refreshLearning(true), 5000)
  },

  async onPullDownRefresh() {
    await this.refreshLearning()
    wx.stopPullDownRefresh()
  },

  onUnload() { this.onHide() },

  onHide() {
    this._visible = false
    this._dateLoadVersion = (this._dateLoadVersion || 0) + 1
    this.stopProgressPolling()
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

  showNotifications() {
    wx.navigateTo({ url: '/pages/messages/index' })
  },

  openLibrary() {
    wx.navigateTo({ url: '/learning/library/index' })
  },
  filterMyCourses(courses = this.data.model.myCourses || [], search = this.data.courseSearch) {
    const needle = String(search || '').trim().toLowerCase()
    return courses.filter((course) => !needle || `${course.title} ${course.meta}`.toLowerCase().includes(needle))
  },
  searchMyCourses(event) {
    const courseSearch = String(event.detail && event.detail.value || '')
    this.setData({ courseSearch, visibleMyCourses: this.filterMyCourses(this.data.model.myCourses, courseSearch) })
  },
  openMyCourse(event) {
    const dataset = event.currentTarget.dataset || {}
    if (dataset.kind === 'agent') {
      const course = (this.data.model.myCourses || []).find((item) => item.id === dataset.id)
      if (!course || !/^stage-[A-Za-z0-9_-]{1,64}$/.test(course.stageId)) return
      // 已生成的课程直接进入学习；生成中或失败的课程打开进度页。
      wx.navigateTo({ url: course.canLearn
        ? `/learning/course/index?agentCourseId=${encodeURIComponent(course.stageId)}`
        : `/learning/agent-course/index?stageId=${encodeURIComponent(course.stageId)}` })
      return
    }
    const courseInstanceId = String(dataset.id || '')
    if (!/^[1-9][0-9]*$/.test(courseInstanceId)) return
    wx.navigateTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(courseInstanceId)}` })
  },
  openPlans() { wx.navigateTo({ url: '/diagnosis/plans/index' }) },
  createPlan() { wx.navigateTo({ url: '/diagnosis/plan-generation/index' }) },

  openTask(e) {
    const planItemId = String(e.currentTarget.dataset.id || '')
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
      dashboard: live.dashboard
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
