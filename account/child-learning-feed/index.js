const { loadGuardianLearningFeed } = require('../../services/identity')

const stateLabels = {
  idle: '暂未开始学习',
  started: '已开始学习',
  learning: '学习中',
  pending_acceptance: '待验收',
  ai_evaluated_pending_teacher: 'AI 已评价，待老师核验',
  teacher_verified_passed: '老师核验通过',
  teacher_rejected: '老师判定需补学',
  ended: '本次学习已结束'
}

function studentName(profile) {
  return profile.nickname || profile.real_name || '学生档案'
}

function durationText(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  if (hours) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

function formatTime(value) {
  if (!value) return '暂无状态更新时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无状态更新时间'
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function buildChild(item) {
  const profile = item.profile || {}
  const rollupByType = {}
  ;(item.rollups || []).forEach((rollup) => { rollupByType[rollup.period_type] = rollup })
  const state = item.state || null
  return {
    ...item,
    id: profile.id,
    name: studentName(profile),
    initial: studentName(profile).slice(0, 1),
    gradeLabel: profile.current_grade ? `${profile.school_stage || ''}${profile.current_grade}年级` : '年级待完善',
    stateLabel: stateLabels[state && state.state] || '暂无学习状态',
    stateUpdated: formatTime(state && state.last_event_at),
    progressText: state ? `${Math.round(Number(state.progress) || 0)}%` : '暂无进度',
    todayDuration: durationText(rollupByType.daily && rollupByType.daily.effective_seconds),
    weekDuration: durationText(rollupByType.weekly && rollupByType.weekly.effective_seconds),
    totalDuration: durationText(rollupByType.total && rollupByType.total.effective_seconds),
    hasLearningData: Boolean(state || Object.keys(rollupByType).length)
  }
}

Page({
  data: { loading: true, failed: false, children: [], currentIndex: 0, current: null },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadGuardianLearningFeed()
      const children = data.children.map(buildChild)
      const currentIndex = Math.min(this.data.currentIndex, Math.max(children.length - 1, 0))
      this.setData({ children, currentIndex, current: children[currentIndex] || null })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '学习动态加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseChild() {
    if (this.data.children.length < 2) return
    wx.showActionSheet({
      itemList: this.data.children.map((item) => `${item.name} · ${item.gradeLabel}`),
      success: ({ tapIndex }) => this.setData({ currentIndex: tapIndex, current: this.data.children[tapIndex] })
    })
  },

  openReports() {
    wx.navigateTo({ url: '/account/topic-learning-report/index' })
  }
})
