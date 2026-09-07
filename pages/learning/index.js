const { getLearningModel } = require('../../services/mock-service')

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
    showTodayOverview: true,
    numberRollVersion: 0,
    numberRollClass: 'overview-digit-settled',
    taskListVersion: 0,
    taskListClass: 'study-task-list-settled',
    taskListHeight: LEARNING_TASK_LIST_ROW_HEIGHT
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

  onShow() {
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/learning/index')
    if (!this.data.model.calendarTitle) {
      const model = getLearningModel(new Date(), this.data.selectedStudyDayIndex)
      this.setData({ model, taskListHeight: getLearningTaskListHeight(model) })
    }
  },

  onHide() {
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

  returnToToday() {
    if (this.data.selectedStudyDayIndex === 0) return
    this.selectStudyDay(0)
  },

  selectStudyDay(selectedStudyDayIndex) {
    const previousStudyDayIndex = this.data.selectedStudyDayIndex
    const numberRollVersion = this.data.numberRollVersion + 1
    const taskListVersion = this.data.taskListVersion + 1
    const nextModel = getLearningModel(new Date(), selectedStudyDayIndex, previousStudyDayIndex)
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
      numberRollVersion,
      numberRollClass: numberRollVersion % 2 ? 'overview-digit-roll-a' : 'overview-digit-roll-b',
      taskListVersion,
      taskListClass: 'study-task-list-leaving',
      // 与概览卡同时开始高度过渡，避免待办事项先上移再被任务列表撑下去。
      taskListHeight: getLearningTaskListHeight(nextModel),
      model: leavingModel
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
  },

  handleStudyDateSelect(e) {
    const selectedStudyDayIndex = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(selectedStudyDayIndex) || selectedStudyDayIndex === this.data.selectedStudyDayIndex) return
    this.selectStudyDay(selectedStudyDayIndex)
  }
})
