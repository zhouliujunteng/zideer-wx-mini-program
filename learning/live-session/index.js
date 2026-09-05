const { loadCurrentLiveSchedule } = require('../../services/identity')

const statusLabels = { scheduled: '已安排', confirmed: '已确认', in_progress: '进行中', completed: '已结束', cancelled: '已取消', reassigned: '已改派' }

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function meetingWindowOpen(session) {
  const start = new Date(session.scheduledStart).getTime()
  const end = new Date(session.scheduledEnd).getTime()
  const now = Date.now()
  return ['confirmed', 'in_progress'].includes(String(session.status || '').toLowerCase()) && Number.isFinite(start) && Number.isFinite(end) && now >= start - 10 * 60 * 1000 && now <= end
}

Page({
  data: { loading: true, failed: false, session: null },

  onLoad(options) { this.participantId = String(options.participantId || '') },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLiveSchedule()
      const item = data.sessions.find((entry) => String(entry.id) === this.participantId)
      if (!item || !item.session) {
        this.setData({ session: null })
        return
      }
      const session = item.session
      const teacher = session.teacher || null
      const status = String(session.status || item.status || '').toLowerCase()
      this.setData({ session: {
        ...item,
        ...session,
        teacherName: teacher && teacher.displayName ? teacher.displayName : '教师待确认',
        statusLabel: statusLabels[status] || '状态待确认',
        timeLabel: formatDateTime(session.scheduledStart),
        endLabel: formatDateTime(session.scheduledEnd),
        attendanceLabel: item.attendanceSeconds ? `已出勤 ${Math.round(Number(item.attendanceSeconds) / 60)} 分钟` : '尚无出勤记录',
        meetingOpen: meetingWindowOpen(session),
        meetingConfigured: /^https:\/\/[^\s]+$/i.test(String(session.meetingRef || ''))
      } })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '场次详情加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  showMeetingState() {
    const session = this.data.session
    if (!session) return
    if (!session.meetingOpen) {
      wx.showToast({ title: '会议将在服务时间内开放', icon: 'none' })
      return
    }
    wx.showToast({ title: session.meetingConfigured ? '会议入口已登记，暂未配置安全跳转' : '会议入口尚未配置', icon: 'none' })
  },

  openDailyTask() { wx.navigateTo({ url: '/learning/daily-task/index' }) }
})
