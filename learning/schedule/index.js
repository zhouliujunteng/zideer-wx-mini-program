const { loadCurrentLiveSchedule } = require('../../services/identity')

const statusLabels = {
  scheduled: '已安排',
  confirmed: '已确认',
  in_progress: '进行中',
  completed: '已结束',
  cancelled: '已取消',
  reassigned: '已改派'
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${hour}:${minute}`
}

function durationText(start, end) {
  const startAt = new Date(start).getTime()
  const endAt = new Date(end).getTime()
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return ''
  return `${Math.round((endAt - startAt) / 60000)} 分钟`
}

function normalizeSession(item) {
  const session = item.session || {}
  const teacher = session.teacher || null
  const status = String(session.status || item.status || '').toLowerCase()
  return {
    ...item,
    session,
    teacher,
    status,
    statusLabel: statusLabels[status] || '状态待确认',
    timeLabel: formatDateTime(session.scheduledStart),
    durationLabel: durationText(session.scheduledStart, session.scheduledEnd),
    teacherLabel: teacher && teacher.displayName ? teacher.displayName : '教师待确认',
    modeLabel: session.serviceMode === 'parallel_coaching' ? '真人陪跑' : '真人服务'
  }
}

Page({
  data: { loading: true, failed: false, sessions: [], assignments: [] },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLiveSchedule()
      this.setData({
        sessions: data.sessions.map(normalizeSession),
        assignments: data.assignments
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '日程加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openSession(event) {
    const participantId = event.currentTarget.dataset.participantId
    if (!participantId) return
    wx.navigateTo({ url: `/learning/live-session/index?participantId=${encodeURIComponent(participantId)}` })
  },

  openDailyTask() { wx.navigateTo({ url: '/learning/daily-task/index' }) }
})
