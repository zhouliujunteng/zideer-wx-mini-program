const { loadCurrentTeacherWorkspace, loadTeacherStudyAlerts, loadTeacherMeetingRequests } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { gradeName } = require('../../utils/grade-name')
const { dayDiff, monthDay } = require('../../utils/study-plan-view')

// 今年分配的只写月日，往年的带上年份。
function dateLabel(value, now = new Date()) {
  const time = Date.parse(value || '')
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`
}

// 搜索只在本地名单里找：姓名、6 位用户 ID、年级都能搜。
function filterStudents(students, search) {
  const query = String(search || '').trim().toLowerCase()
  if (!query) return students
  return students.filter((item) => [item.name, item.publicId, item.gradeText].some((text) => String(text || '').toLowerCase().includes(query)))
}

// 没学完的日子：「昨天」「前天」「10月6日」
function pastDayText(day, today) {
  const offset = dayDiff(today, day)
  if (offset === -1) return '昨天'
  if (offset === -2) return '前天'
  return monthDay(day)
}

// 「没完成任务」一行：哪天起没学完几项，已经带到哪天、约多少分钟。
function decorateAlert(alert, student, today) {
  const since = alert.firstMissedDay === alert.lastMissedDay
    ? `${pastDayText(alert.lastMissedDay, today)}的任务没学完`
    : `${pastDayText(alert.firstMissedDay, today)}起有任务没学完`
  const carried = alert.carryDay === today ? '已带到今天' : `今天休息，已带到${monthDay(alert.carryDay)}`
  return {
    ...student,
    studentProfileId: alert.studentProfileId,
    missedText: `${since} · ${alert.taskCount} 项`,
    detailText: [carried, alert.minutes ? `约 ${alert.minutes} 分钟` : '', alert.titles.length ? `《${alert.titles[0]}》${alert.titles.length > 1 ? '等' : ''}` : ''].filter(Boolean).join(' · ')
  }
}

// 老师工作台（老师端，与「我的学生详情」E06 同一套样式：蓝色渐变头部、#FAFAFA 面板、白色大圆角卡片）。
// 只对后台开通的有效老师开放，数据由「获取当前教师工作台」按当前登录身份返回，不能指定他人。
// 「没完成任务」（2026-10-09 用户规则）：前几天学习任务没学完的学生（课程服务按老师自己的绑定现查），点进去生成催学的话。
Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    // 第一次读到工作台前，学生列表只画骨架；读到过一次后再回来保留旧数据，后台静默刷新。
    loaded: false,
    failed: false,
    teacher: null,
    students: [],
    search: '',
    visibleStudents: [],
    refreshing: false,
    tab: 'all',
    alertsState: 'loading',
    alertsError: '',
    alertsFailedCount: 0,
    alertCount: 0,
    visibleAlerts: [],
    // 诊断会议接单（2026-11-13）：待接单几条、我接了还没约好的几条；读不到就不显示数字，入口照常在
    meetingOpenCount: 0,
    meetingTodoCount: 0
  },
  onLoad() {
    attachUiAssets(this)
    // 顶栏高度对齐胶囊按钮；只在 onLoad 读一次胶囊位置。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    this.setData({ statusBarHeight, navigationBarHeight: menuButton.height + (menuButton.top - statusBarHeight) * 2 })
  },
  onShow() {
    this.loadPage()
    this.loadAlerts()
    this.loadMeetingRequests()
  },
  async handleRefresh() {
    this.setData({ refreshing: true })
    await Promise.all([this.loadPage(), this.loadAlerts(), this.loadMeetingRequests()])
    this.setData({ refreshing: false })
  },
  // 代理申请的免费诊断会议：待接单的条数显示在入口上。读不到不影响名单，也不提示。
  async loadMeetingRequests() {
    try {
      const result = await loadTeacherMeetingRequests()
      this.setData({ meetingOpenCount: result.open.length, meetingTodoCount: result.mine.filter((item) => item.state === 'claimed').length })
    } catch (error) {}
  },
  openMeetingRequests() { wx.navigateTo({ url: '/teacher/meeting-requests/index' }) },
  // 名单与「没完成任务」分开读：后者要读学习记录、慢一些，读不到也不影响名单。
  async loadAlerts() {
    const version = this._alertsVersion = (this._alertsVersion || 0) + 1
    if (this.data.alertsState === 'failed') this.setData({ alertsState: 'loading' })
    try {
      const result = await loadTeacherStudyAlerts()
      if (version !== this._alertsVersion) return
      this._alerts = result
      this.setData({ alertsState: 'ready', alertsError: '', alertsFailedCount: result.failedCount })
      this.applyAlerts()
    } catch (error) {
      if (version !== this._alertsVersion) return
      // 读到过一次后刷新失败：保留旧名单
      if (this.data.alertsState === 'ready') return
      this.setData({ alertsState: 'failed', alertsError: (error && error.message) || '请稍后重试。' })
    }
  },
  // 名单只列还在自己名下的学生；搜索同「全部」。
  applyAlerts() {
    if (!this._alerts) return
    const byId = new Map(this.data.students.map((item) => [String(item.studentProfileId), item]))
    const alerts = this._alerts.alerts
      .filter((alert) => byId.has(alert.studentProfileId))
      .map((alert) => decorateAlert(alert, byId.get(alert.studentProfileId), this._alerts.today))
    this._alertRows = alerts
    this.setData({ alertCount: alerts.length, visibleAlerts: filterStudents(alerts, this.data.search) })
  },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab === 'behind' ? 'behind' : 'all'
    if (tab !== this.data.tab) this.setData({ tab })
  },
  openReminder(event) {
    const dataset = event.currentTarget.dataset
    const studentProfileId = String(dataset.studentProfileId || '')
    if (!studentProfileId) return
    const query = `studentProfileId=${encodeURIComponent(studentProfileId)}&publicId=${encodeURIComponent(String(dataset.id || ''))}&name=${encodeURIComponent(String(dataset.name || ''))}`
    wx.navigateTo({ url: `/teacher/study-reminder/index?${query}` })
  },
  async loadPage() {
    const version = this._version = (this._version || 0) + 1
    this.setData({ failed: false })
    try {
      const result = await loadCurrentTeacherWorkspace()
      if (version !== this._version) return
      // 入口只对后台设置的老师显示，走到这里只可能是按路径直接打开（如审核）或老师刚被停用：不留说明页，直接退回。
      if (result.status !== 'ready') {
        this.leaveWorkspace()
        return
      }
      const students = result.students.map((item) => ({
        ...item,
        initial: Array.from(item.name)[0] || '',
        gradeText: gradeName(item.grade) || '年级未填',
        boundText: dateLabel(item.boundAt)
      }))
      this.setData({
        loaded: true,
        teacher: result.teacher,
        students,
        visibleStudents: filterStudents(students, this.data.search)
      })
      this.applyAlerts()
    } catch (error) {
      if (version !== this._version) return
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '老师工作台加载失败', icon: 'none' })
    }
  },
  handleSearch(event) {
    const search = String(event.detail.value || '')
    this.setData({ search, visibleStudents: filterStudents(this.data.students, search), visibleAlerts: filterStudents(this._alertRows || [], search) })
  },
  clearSearch() {
    this.setData({ search: '', visibleStudents: this.data.students, visibleAlerts: this._alertRows || [] })
  },
  openAddStudent() { wx.navigateTo({ url: '/teacher/add-student/index' }) },
  openStudent(event) {
    const dataset = event.currentTarget.dataset
    const studentProfileId = String(dataset.studentProfileId || '')
    if (!studentProfileId) return
    const query = `studentProfileId=${encodeURIComponent(studentProfileId)}&publicId=${encodeURIComponent(String(dataset.id || ''))}&name=${encodeURIComponent(String(dataset.name || ''))}`
    wx.navigateTo({ url: `/teacher/student-detail/index?${query}` })
  },
  copyStudentId(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.setClipboardData({ data: id, success: () => wx.showToast({ title: '学生 ID 已复制', icon: 'none' }) })
  },
  leaveWorkspace() {
    if (this._leaving) return
    this._leaving = true
    // 切换页面会清掉已弹出的提示，所以等回到上一页再提示。
    const toast = () => wx.showToast({ title: '老师身份已失效', icon: 'none' })
    if (getCurrentPages().length > 1) wx.navigateBack({ complete: toast })
    else wx.switchTab({ url: '/pages/me/index', complete: toast })
  },
  handleBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/me/index' })
  }
})
