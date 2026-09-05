const { generateCurrentLearningPlan } = require('../../services/identity')

const subjects = [
  { key: 'Chinese', name: '语文' },
  { key: 'Mathematics', name: '数学' },
  { key: 'English', name: '英语' },
  { key: 'Physics', name: '物理' },
  { key: 'Chemistry', name: '化学' },
  { key: 'Biology', name: '生物' },
  { key: 'History', name: '历史' },
  { key: 'Geography', name: '地理' },
  { key: 'Politics', name: '道德与法治' },
  { key: 'Information Technology', name: '信息科技' }
]

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function statusLabel(status) {
  return ({ CREATED: '正在提交规划请求', PROCESSING: '正在分析学习路径' })[status] || '正在生成计划'
}

Page({
  data: {
    goal: '',
    dailyMinutes: 40,
    targetDate: '',
    minDate: '',
    subjects,
    selectedSubjects: [],
    submitting: false,
    progressText: ''
  },

  onLoad() {
    const today = new Date()
    const target = new Date(today)
    target.setDate(target.getDate() + 28)
    this.setData({ minDate: formatDate(today), targetDate: formatDate(target) })
  },

  onGoalInput(event) {
    this.setData({ goal: String(event.detail.value || '').slice(0, 300) })
  },

  onDailyMinutesInput(event) {
    const raw = String(event.detail.value || '').replace(/[^0-9]/g, '')
    this.setData({ dailyMinutes: raw ? Number(raw) : '' })
  },

  onTargetDateChange(event) {
    this.setData({ targetDate: event.detail.value })
  },

  toggleSubject(event) {
    if (this.data.submitting) return
    const key = event.currentTarget.dataset.key
    if (!key) return
    const selected = new Set(this.data.selectedSubjects)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    this.setData({ selectedSubjects: Array.from(selected) })
  },

  async submit() {
    if (this.data.submitting) return
    const goal = this.data.goal.trim()
    const dailyMinutes = Number(this.data.dailyMinutes)
    if (!goal) {
      wx.showToast({ title: '请填写本次学习目标', icon: 'none' })
      return
    }
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 10 || dailyMinutes > 600) {
      wx.showToast({ title: '每日学习时间应为 10 到 600 分钟', icon: 'none' })
      return
    }
    if (!this.data.targetDate) {
      wx.showToast({ title: '请选择目标日期', icon: 'none' })
      return
    }

    this.setData({ submitting: true, progressText: '正在提交规划请求' })
    try {
      const output = await generateCurrentLearningPlan({
        goal,
        dailyMinutes,
        targetDate: `${this.data.targetDate}T23:59:59+08:00`,
        subjectPriorities: this.data.selectedSubjects
      }, (status) => this.setData({ progressText: statusLabel(status) }))
      wx.redirectTo({ url: `/diagnosis/plan-detail/index?planId=${encodeURIComponent(output.planId)}` })
    } catch (error) {
      this.setData({ submitting: false, progressText: '' })
      wx.showToast({ title: error.message || '学习计划生成失败', icon: 'none', duration: 3200 })
    }
  }
})
