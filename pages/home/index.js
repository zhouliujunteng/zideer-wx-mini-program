const { getHomeModel } = require('../../services/mock-service')
const { switchTab } = require('../../utils/navigation')
const { getLiveHomeModel } = require('../../services/live-tab-service')

// 手势位移和浮层停靠点都使用 px；与图谱页保持同一套双停靠吸附节奏。
const SHEET_RAISE_THRESHOLD = 6
// 必须与 index.wxss 中 .home-sheet-layer.sheet-snapping 的 0.42s 保持一致。
const SHEET_ANIMATION_DURATION = 420
const SHEET_DIRECTION_EPSILON = 8
const SHEET_SETTLE_EPSILON = 2
const DEFAULT_SHEET_TRIGGER = 240
// 在真正到顶前略早切换融合样式，避免到边界的同一帧同时进行滚动交接和大面积绘制。
const SHEET_DOCK_EARLY_DISTANCE = 18
const PULL_REFRESH_START_EPSILON = 6
const PULL_REFRESH_TRIGGER = 42
const PULL_REFRESH_MAX_OFFSET = 64
const PULL_REFRESH_HOLD_OFFSET = 46
const PULL_REFRESH_INDICATOR_HEIGHT = 54
const PULL_REFRESH_DURATION = 2000
const LESSON_GESTURE_EPSILON = 8
const TASK_LIST_SWAP_DURATION = 150
const TASK_LIST_ENTER_FRAME = 16
const HOME_TASK_LIST_ROW_HEIGHT = 96
const HOME_TASK_LIST_ROW_GAP = 20

function getHomeTaskListHeight(model) {
  const taskCount = model && model.studyTasks ? model.studyTasks.length : 0
  const visibleCount = Math.max(taskCount, 1)
  return visibleCount * HOME_TASK_LIST_ROW_HEIGHT + Math.max(visibleCount - 1, 0) * HOME_TASK_LIST_ROW_GAP
}

function triggerDateSwitchFeedback() {
  if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
}

function getSheetTrigger(value) {
  return value || DEFAULT_SHEET_TRIGGER
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isSheetDocked(scrollTop, trigger) {
  return scrollTop >= trigger - SHEET_DOCK_EARLY_DISTANCE
}

function getTimeGreeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

// 弹窗交互是当前真机确认的基线：修改前请先阅读
// docs/implementation/HOME_INTERACTION_BASELINE.md 并逐项执行其中的回归清单。
Page({
  data: {
    model: {},
    homeMode: 'member',
    greeting: '',
    navSolid: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    contentTop: 76,
    lessonTop: 149,
    guestBannerTop: 132,
    sheetStart: 717,
    sheetRaised: false,
    sheetTrigger: 260,
    sheetViewportHeight: 589,
    notificationTop: 26,
    notificationRight: 100,
    topbarSearchLeft: 108,
    topbarSearchWidth: 132,
    sheetVisualOffset: 0,
    sheetContentScrollTop: 0,
    sheetContentScrollAnchor: '',
    sheetContentScrollEnabled: false,
    sheetSnapping: false,
    lessonCurrent: 0,
    selectedCourseCategory: 'all',
    selectedStudyDayIndex: 0,
    showTodayOverview: true,
    homeOverviewHeight: 120,
    homeOverviewOpacity: 1,
    numberRollVersion: 0,
    numberRollClass: 'overview-digit-settled',
    taskListVersion: 0,
    taskListClass: 'study-task-list-settled',
    taskListHeight: HOME_TASK_LIST_ROW_HEIGHT,
    pagePullOffset: 0,
    refreshIndicatorBaseTop: 72,
    refreshIndicatorOffset: -PULL_REFRESH_INDICATOR_HEIGHT,
    pullRefreshState: 'idle',
    pullRefreshText: '下拉刷新',
    pullRefreshVisible: false,
    pagePullSettling: false
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
    const contentTop = statusBarHeight + navigationBarHeight + 18
    const lessonTop = Math.round(contentTop + 146 * windowWidth / 750)
    // 访客态搜索栏高度固定为 88rpx，Banner 收近到搜索栏下方约 112rpx 的节奏。
    const guestBannerTop = Math.round(contentTop + 112 * windowWidth / 750)
    const sheetStart = Math.round(contentTop * 750 / windowWidth + 565)
    const topbarBottom = statusBarHeight + navigationBarHeight + 16 * windowWidth / 750
    const sheetTrigger = Math.max(1, Math.round(sheetStart * windowWidth / 750 - topbarBottom))
    const sheetViewportHeight = Math.max(320, (windowInfo.windowHeight || 667) - topbarBottom)
    // notification-button 的 right 值相对胶囊右侧留了 8px，这里要再减去按钮自身宽度才能得到真实左边界。
    const noticeLeft = menuButton.left - 8 - menuButton.height
    const topbarSearchWidth = Math.min(264 * windowWidth / 750, Math.max(216 * windowWidth / 750, noticeLeft - 36 - 12 - 36))
    const topbarSearchLeft = Math.max(36, Math.round(noticeLeft - 12 - topbarSearchWidth))

    this._homeSheetOffset = 0
    this._sheetContentScrollTop = 0
    this._isSnappingSheet = false
    const initialModel = getHomeModel('member', new Date(), 0, 0)
    this.setData({
      model: initialModel,
      taskListHeight: getHomeTaskListHeight(initialModel),
      greeting: getTimeGreeting(),
      statusBarHeight,
      navigationBarHeight,
      menuButtonHeight: menuButton.height,
      contentTop,
      lessonTop,
      guestBannerTop,
      sheetStart,
      sheetViewportHeight,
      sheetVisualOffset: 0,
      sheetContentScrollTop: 0,
      sheetContentScrollEnabled: false,
      sheetRaised: false,
      sheetTrigger,
      navSolid: false,
      notificationTop: menuButton.top,
      notificationRight: windowWidth - menuButton.left + 8,
      topbarSearchLeft,
      topbarSearchWidth: Math.round(topbarSearchWidth),
      refreshIndicatorBaseTop: statusBarHeight + navigationBarHeight + 6
    })
  },

  async onShow() {
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/home/index')
    const greeting = getTimeGreeting()
    const homeMode = this.data.homeMode || 'member'
    const selectedStudyDayIndex = this.data.selectedStudyDayIndex || 0
    const selectedCourseCategory = this.data.selectedCourseCategory || 'all'
    const model = getHomeModel(homeMode, new Date(), selectedStudyDayIndex, selectedStudyDayIndex, selectedCourseCategory)
    const memberDateChanged = homeMode === 'member' && this.data.model.studyTaskCalendar &&
      model.studyTaskCalendar[0].date !== this.data.model.studyTaskCalendar[0].date
    if (!this.data.model.mode || this.data.model.mode !== homeMode) {
      this.setData({ model, greeting, taskListHeight: getHomeTaskListHeight(model) })
    } else if (greeting !== this.data.greeting || memberDateChanged) {
      this.setData({ model, greeting, taskListHeight: getHomeTaskListHeight(model) })
    }
    // 成员态每次显示都从第一张课堂卡开始；访客 Banner 与“更多课程”活动 Banner 一样自行轮播。
    if (homeMode === 'member' && this.data.lessonCurrent !== 0) {
      this.setData({ lessonCurrent: 0 })
    }
    try {
      const live = await getLiveHomeModel(selectedStudyDayIndex)
      this.setData({ model: live.model, dashboard: live.dashboard, taskListHeight: getHomeTaskListHeight(live.model) })
    } catch (error) {
      wx.showToast({ title: error.message || '首页数据加载失败', icon: 'none' })
    }
  },

  onHide() {
    // Tab 页面保留实例时清理动画计时器，重新进入始终从第一张课堂卡开始。
    if (this._sheetSnapResetTimer) {
      clearTimeout(this._sheetSnapResetTimer)
      this._sheetSnapResetTimer = null
    }
    if (this._pullRefreshTimer) {
      clearTimeout(this._pullRefreshTimer)
      this._pullRefreshTimer = null
    }
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
        taskListHeight: getHomeTaskListHeight(this._pendingTaskListModel)
      })
      this._pendingTaskListModel = null
    } else if (this.data.taskListClass === 'study-task-list-enter-prep') {
      this.setData({
        taskListClass: 'study-task-list-settled'
      })
    }
    const snapTarget = clamp(
      this.data.sheetVisualOffset || this._homeSheetOffset || 0,
      0,
      getSheetTrigger(this.data.sheetTrigger)
    )
    this._homeSheetOffset = snapTarget
    this._isSnappingSheet = false
    if (this.data.sheetSnapping) {
      this.setData({
        sheetVisualOffset: snapTarget,
        sheetContentScrollEnabled: snapTarget >= getSheetTrigger(this.data.sheetTrigger) - SHEET_SETTLE_EPSILON,
        sheetSnapping: false,
        sheetRaised: snapTarget > SHEET_RAISE_THRESHOLD,
        navSolid: snapTarget >= getSheetTrigger(this.data.sheetTrigger)
      })
    } else if (snapTarget <= SHEET_SETTLE_EPSILON && this.data.sheetRaised) {
      this.setData({ sheetRaised: false, navSolid: false })
    }
    if (this.data.pullRefreshState !== 'idle' || this.data.pagePullOffset) {
      this.setData({
        pagePullOffset: 0,
        refreshIndicatorOffset: -PULL_REFRESH_INDICATOR_HEIGHT,
        pullRefreshState: 'idle',
        pullRefreshText: '下拉刷新',
        pullRefreshVisible: false,
        pagePullSettling: false
      })
    }
    this._isPagePulling = false
    this._isRefreshingPage = false
  },

  handleSheetContentScroll(e) {
    this._sheetContentScrollTop = Math.max(0, e.detail.scrollTop || 0)
  },

  beginSheetDrag(startY) {
    // 吸附期间不接收新手势，确保视觉位置和实例位移保持同一个来源。
    if (this._isSnappingSheet) return false
    this._isDraggingSheet = true
    this._sheetDragStartTop = this._homeSheetOffset || 0
    this._sheetDragStartY = startY
    if (!this.data.sheetRaised) {
      this.setData({ sheetRaised: true })
    }
    if (this.data.sheetContentScrollEnabled) {
      this.setData({ sheetContentScrollEnabled: false })
    }
    return true
  },

  handleSheetGrabStart(e) {
    if (this._isRefreshingPage || this._isSnappingSheet) return
    const touch = e.touches && e.touches[0]
    if (touch) {
      // 先等待方向判定：系统左边缘返回和日期/课程横滑不能进入弹窗拖拽状态。
      this._isSheetTouchActive = true
      this._sheetGestureStartX = touch.clientX
      this._sheetGestureStartY = touch.clientY
      this._sheetGestureKind = null
      this._sheetDragStartTop = this._homeSheetOffset || 0
      this._sheetContentScrollStartTop = this._sheetContentScrollTop || 0
    }
  },

  handleSheetGrabMove(e) {
    if (this._isPagePulling || this._isRefreshingPage) return
    const touch = e.touches && e.touches[0]
    if (!touch || typeof this._sheetGestureStartY !== 'number') return

    if (!this._sheetGestureKind) {
      const offsetX = touch.clientX - this._sheetGestureStartX
      const offsetY = touch.clientY - this._sheetGestureStartY
      if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) < LESSON_GESTURE_EPSILON) return
      if (Math.abs(offsetY) <= Math.abs(offsetX)) {
        this._sheetGestureKind = 'horizontal'
        return
      }
      const movement = this._sheetGestureStartY - touch.clientY
      const trigger = getSheetTrigger(this.data.sheetTrigger)
      const startsDocked = (this._sheetDragStartTop || 0) >= trigger - SHEET_SETTLE_EPSILON
      if (startsDocked && ((this._sheetContentScrollStartTop || 0) > SHEET_SETTLE_EPSILON || movement > 0)) {
        this._sheetGestureKind = 'content'
        return
      }
      if ((this._sheetDragStartTop || 0) <= SHEET_SETTLE_EPSILON && movement < 0) {
        this._sheetGestureKind = 'page'
        return
      }
      this._sheetGestureKind = 'vertical'
      if (!this.beginSheetDrag(this._sheetGestureStartY)) return
    }

    if (this._sheetGestureKind !== 'vertical' || !this._isDraggingSheet) return
    this.moveSheetDrag(touch)
  },

  moveSheetDrag(touch) {
    if (!touch || typeof this._sheetDragStartY !== 'number') return
    const trigger = getSheetTrigger(this.data.sheetTrigger)
    const movement = this._sheetDragStartY - touch.clientY
    const nextOffset = clamp((this._sheetDragStartTop || 0) + movement, 0, trigger)
    this.updateHomeSheetPosition(nextOffset, false)
  },

  updateHomeSheetPosition(offset, contentScrollEnabled) {
    const trigger = getSheetTrigger(this.data.sheetTrigger)
    const boundedOffset = clamp(offset, 0, trigger)
    this._homeSheetOffset = boundedOffset
    this.setData({
      sheetVisualOffset: boundedOffset,
      sheetRaised: boundedOffset > SHEET_RAISE_THRESHOLD || this._isDraggingSheet,
      navSolid: isSheetDocked(boundedOffset, trigger),
      sheetContentScrollEnabled: Boolean(contentScrollEnabled)
    })
  },

  handleSheetRelease() {
    // 内容区和课堂/Banner 转交的纵向手势都由 beginSheetDrag 开始；
    // 以真实拖拽状态作为统一释放条件，避免转交路径松手后停在半途。
    const shouldSnapSheet = Boolean(this._isDraggingSheet)
    this._sheetGestureStartX = null
    this._sheetGestureStartY = null
    this._sheetGestureKind = null
    this._sheetDragStartY = null
    this._isDraggingSheet = false
    this._isSheetTouchActive = false
    if (!shouldSnapSheet || this._isPagePulling || this._isRefreshingPage || this._isSnappingSheet) return
    // 方向已在拖动期间记录，松手即吸附，避免“等一拍”造成迟滞。
    this.snapSheet()
  },

  snapSheet() {
    const current = this._homeSheetOffset || 0
    const trigger = getSheetTrigger(this.data.sheetTrigger)
    const start = this._sheetDragStartTop || 0
    const delta = current - start
    let target
    if (delta > SHEET_DIRECTION_EPSILON) target = trigger
    else if (delta < -SHEET_DIRECTION_EPSILON) target = 0
    else target = current >= trigger / 2 ? trigger : 0

    if (Math.abs(target - current) > SHEET_SETTLE_EPSILON) {
      this._isSnappingSheet = true
      this.setData({
        sheetSnapping: true,
        sheetVisualOffset: target,
        sheetContentScrollEnabled: false,
        // 上吸一开始就让顶栏和弹窗进入融合态，不等 420ms 动画结束。
        // 向下收起时则保持当前状态，由动画结束的数据统一恢复。
        navSolid: target >= trigger ? true : this.data.navSolid
      })
      this._sheetSnapResetTimer = setTimeout(() => {
        this._homeSheetOffset = target
        this._sheetSnapResetTimer = null
        this.setData({
          sheetVisualOffset: target,
          sheetContentScrollEnabled: target >= trigger - SHEET_SETTLE_EPSILON,
          sheetSnapping: false,
          sheetRaised: target > SHEET_RAISE_THRESHOLD,
          navSolid: isSheetDocked(target, trigger)
        }, () => {
          this._isSnappingSheet = false
        })
      }, SHEET_ANIMATION_DURATION)
    } else {
      this.updateHomeSheetPosition(target, target >= trigger - SHEET_SETTLE_EPSILON)
    }
  },

  handleLessonChange(e) {
    this.setData({ lessonCurrent: e.detail.current || 0 })
  },

  handleLessonAreaStart(e) {
    this.handlePagePullStart(e)
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._lessonGestureStartX = touch.clientX
    this._lessonGestureStartY = touch.clientY
    this._lessonAreaGesture = null
    this._isLessonForwardingSheet = false
  },

  handleLessonAreaMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch || typeof this._lessonGestureStartY !== 'number') return
    const offsetX = touch.clientX - this._lessonGestureStartX
    const offsetY = touch.clientY - this._lessonGestureStartY

    if (!this._lessonAreaGesture) {
      if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) < LESSON_GESTURE_EPSILON) return
      this._lessonAreaGesture = Math.abs(offsetY) > Math.abs(offsetX) ? 'vertical' : 'horizontal'
      if (this._lessonAreaGesture === 'vertical' && offsetY < 0) {
        this._isLessonForwardingSheet = this.beginSheetDrag(this._lessonGestureStartY)
      }
    }

    if (this._lessonAreaGesture !== 'vertical') return
    if (this._isLessonForwardingSheet) {
      this.moveSheetDrag(touch)
      return
    }
    this.handlePagePullMove(e)
  },

  handleLessonAreaEnd() {
    if (this._isLessonForwardingSheet) {
      this._isLessonForwardingSheet = false
      this.handleSheetRelease()
    } else {
      this.handlePagePullEnd()
    }
    this._lessonGestureStartX = null
    this._lessonGestureStartY = null
    this._lessonAreaGesture = null
  },

  handlePagePullStart(e) {
    if (this._isRefreshingPage || this._isSnappingSheet) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._pagePullStartY = touch.clientY
    this._isPagePulling = false
    if (this.data.pagePullSettling) this.setData({ pagePullSettling: false })
  },

  handlePagePullMove(e) {
    if (this._isRefreshingPage || this._isSnappingSheet || typeof this._pagePullStartY !== 'number') return
    if (this._lessonAreaGesture === 'horizontal') return
    if (this._isSheetTouchActive && (this._sheetDragStartTop || 0) > SHEET_SETTLE_EPSILON) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const distance = touch.clientY - this._pagePullStartY
    if (distance <= PULL_REFRESH_START_EPSILON) return

    this._isPagePulling = true
    const pagePullOffset = Math.min(
      PULL_REFRESH_MAX_OFFSET,
      Math.round((distance - PULL_REFRESH_START_EPSILON) * 0.42)
    )
    const readyToRefresh = pagePullOffset >= PULL_REFRESH_TRIGGER
    this.setData({
      pagePullOffset,
      refreshIndicatorOffset: pagePullOffset - PULL_REFRESH_INDICATOR_HEIGHT,
      pullRefreshState: readyToRefresh ? 'ready' : 'pulling',
      pullRefreshText: readyToRefresh ? '松开刷新' : '下拉刷新',
      pullRefreshVisible: true,
      pagePullSettling: false
    })
  },

  handlePagePullEnd() {
    this._pagePullStartY = null
    this._isSheetTouchActive = false
    if (!this._isPagePulling || this._isRefreshingPage) return

    this._isDraggingSheet = false
    this._isPagePulling = false
    if (this.data.pagePullOffset >= PULL_REFRESH_TRIGGER) {
      this.startPageRefresh()
      return
    }
    this.setData({
      pagePullOffset: 0,
      refreshIndicatorOffset: -PULL_REFRESH_INDICATOR_HEIGHT,
      pullRefreshState: 'idle',
      pullRefreshText: '下拉刷新',
      pullRefreshVisible: false,
      pagePullSettling: true
    })
  },

  startPageRefresh() {
    this._isRefreshingPage = true
    this.setData({
      pagePullOffset: PULL_REFRESH_HOLD_OFFSET,
      refreshIndicatorOffset: PULL_REFRESH_HOLD_OFFSET - PULL_REFRESH_INDICATOR_HEIGHT,
      pullRefreshState: 'refreshing',
      pullRefreshText: '正在刷新',
      pullRefreshVisible: true,
      pagePullSettling: true
    })
    this._pullRefreshTimer = setTimeout(() => {
      this._pullRefreshTimer = null
      this._isRefreshingPage = false
      this.setData({
        pagePullOffset: 0,
        refreshIndicatorOffset: -PULL_REFRESH_INDICATOR_HEIGHT,
        pullRefreshState: 'idle',
        pullRefreshText: '下拉刷新',
        pullRefreshVisible: false,
        pagePullSettling: true
      })
    }, PULL_REFRESH_DURATION)
  },

  selectStudyDay(selectedStudyDayIndex) {
    const previousStudyDayIndex = this.data.selectedStudyDayIndex
    const numberRollVersion = this.data.numberRollVersion + 1
    const taskListVersion = this.data.taskListVersion + 1
    const nextModel = getHomeModel('member', new Date(), selectedStudyDayIndex, previousStudyDayIndex)
    const nextTaskListHeight = getHomeTaskListHeight(nextModel)
    triggerDateSwitchFeedback()
    // 先保留旧列表作短暂淡出，再换入新日期的数据，避免项目数量变化时直接跳变。
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
      homeOverviewHeight: selectedStudyDayIndex === 0 ? 120 : 0,
      homeOverviewOpacity: selectedStudyDayIndex === 0 ? 1 : 0,
      numberRollVersion,
      numberRollClass: numberRollVersion % 2 ? 'overview-digit-roll-a' : 'overview-digit-roll-b',
      taskListVersion,
      taskListClass: 'study-task-list-leaving',
      // 与概览卡同时开始高度过渡，避免更多课程先上移再被任务列表撑下去。
      taskListHeight: nextTaskListHeight,
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
  },

  showNotifications() {
    wx.navigateTo({ url: '/pages/messages/index' })
    return
    const nextMode = this.data.homeMode === 'member' ? 'guest' : 'member'
    const selectedCourseCategory = 'all'
    const nextModel = getHomeModel(nextMode, new Date(), 0, 0, selectedCourseCategory)

    if (this._sheetSnapResetTimer) {
      clearTimeout(this._sheetSnapResetTimer)
      this._sheetSnapResetTimer = null
    }
    if (this._taskListSwapTimer) {
      clearTimeout(this._taskListSwapTimer)
      this._taskListSwapTimer = null
    }
    if (this._taskListEnterTimer) {
      clearTimeout(this._taskListEnterTimer)
      this._taskListEnterTimer = null
    }

    this._pendingTaskListModel = null
    this._homeSheetOffset = 0
    this._sheetContentScrollTop = 0
    this._isSnappingSheet = false
    this._isDraggingSheet = false
    this._isLessonForwardingSheet = false
    this._isSheetTouchActive = false
    this._sheetGestureKind = null
    this._sheetGestureStartX = null
    this._sheetGestureStartY = null
    this._sheetDragStartY = null
    this.setData({
      homeMode: nextMode,
      model: nextModel,
      greeting: getTimeGreeting(),
      lessonCurrent: 0,
      selectedCourseCategory,
      selectedStudyDayIndex: 0,
      showTodayOverview: true,
      homeOverviewHeight: 120,
      homeOverviewOpacity: 1,
      taskListClass: 'study-task-list-settled',
      taskListHeight: getHomeTaskListHeight(nextModel),
      sheetVisualOffset: 0,
      sheetContentScrollTop: 0,
      sheetContentScrollAnchor: '',
      sheetContentScrollEnabled: false,
      sheetSnapping: false,
      sheetRaised: false,
      navSolid: false
    }, () => {
      // 原生 scroll-view 的实际位置可能已变化，即便绑定值仍为 0；
      // 切换内容后使用锚点确保新模式始终从弹窗顶部开始。
      this.setData({ sheetContentScrollAnchor: 'home-sheet-content' })
    })
    wx.showToast({
      title: nextMode === 'guest' ? '未登录态页面预览' : '登录态页面预览',
      icon: 'none'
    })
  },

  handleCourseCategorySelect(e) {
    const selectedCourseCategory = e.currentTarget.dataset.category
    if (this.data.homeMode !== 'guest' || !selectedCourseCategory || selectedCourseCategory === this.data.selectedCourseCategory) return
    const model = getHomeModel('guest', new Date(), 0, 0, selectedCourseCategory)
    triggerDateSwitchFeedback()
    this.setData({ selectedCourseCategory, model })
  },

  handleGuestCourseTap(e) {
    wx.navigateTo({ url: '/pages/product-intro/index' })
  },

  handleSearchTap() {
    wx.navigateTo({ url: '/commerce/products/index' })
  },

  openProduct(e) {
    const productVersionId = String(e.currentTarget.dataset.id || '')
    if (!productVersionId) return
    wx.navigateTo({ url: `/commerce/product-detail/index?productVersionId=${encodeURIComponent(productVersionId)}` })
  },

  continueLesson(e) {
    switchTab(1)
  },

  handleSheetAction(e) {
    const label = String(e.currentTarget.dataset.label || '')
    if (label.includes('课程')) return wx.navigateTo({ url: '/commerce/products/index' })
    if (label.includes('任务')) return switchTab(1)
    wx.navigateTo({ url: '/assessment/center/index' })
  },

  openScoreForecast() { wx.navigateTo({ url: '/diagnosis/score-forecast/index' }) },
  openLearningPlans() { wx.navigateTo({ url: '/diagnosis/plans/index' }) },
  openCurrentPlan() {
    const planId = this.data.model && this.data.model.plan && this.data.model.plan.id || this.data.plan && this.data.plan.id
    if (!planId) return this.openLearningPlans()
    wx.navigateTo({ url: `/diagnosis/plan-detail/index?planId=${encodeURIComponent(planId)}` })
  },
  openAssessmentProgress() {
    const assessment = this.data.assessment
    if (!assessment || !assessment.id) return wx.navigateTo({ url: '/assessment/center/index' })
    if (assessment.status === 'draft') {
      return wx.navigateTo({ url: `/assessment/basic/index?subjectKey=${encodeURIComponent(assessment.subjectKey)}&resume=1` })
    }
    wx.navigateTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(assessment.id)}` })
  }
})
