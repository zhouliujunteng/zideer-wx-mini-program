const { loadCurrentRemediationTasks } = require('../../services/identity')

const statusLabels = {
  proposed: '等待确认',
  confirmed: '补学已确认',
  generating: '课程生成中',
  active: '补学进行中',
  completed: '补学已完成',
  cancelled: '已取消'
}

const strategyLabels = {
  review: '回顾原课程',
  targeted: '针对性补学',
  split: '拆分后补学',
  teacher_plan: '老师补学方案'
}

function textFrom(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter(Boolean).join('；') || fallback
  return value.summary || value.description || value.message || fallback
}

function creditText(policy) {
  const lower = Number(policy && (policy.estimated_lower_credits || policy.estimatedLowerCredits))
  const upper = Number(policy && (policy.estimated_upper_credits || policy.estimatedUpperCredits))
  if (Number.isFinite(lower) && Number.isFinite(upper)) return `预计 ${Math.round(lower)}-${Math.round(upper)} 积分`
  if (Number.isFinite(lower)) return `预计 ${Math.round(lower)} 积分`
  return '积分以服务端报价为准'
}

function normalizeTask(task) {
  const status = String(task.status || 'proposed').toLowerCase()
  return {
    ...task,
    status,
    statusLabel: statusLabels[status] || '状态待确认',
    strategyLabel: strategyLabels[task.strategy] || '补学方案待确认',
    weakPointText: textFrom(task.weakPoints, '老师尚未补充具体薄弱点。'),
    creditText: creditText(task.creditPolicy),
    canReview: Boolean(task.courseInstanceId),
    canContinue: ['confirmed', 'generating', 'active'].includes(status) && Boolean(task.courseInstanceId)
  }
}

Page({
  data: { loading: true, failed: false, task: null },

  onLoad(options) { this.acceptanceId = String(options.acceptanceId || '') },
  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentRemediationTasks()
      const tasks = (data.tasks || []).map(normalizeTask)
      const task = tasks.find((item) => String(item.acceptanceId) === this.acceptanceId) || tasks[0] || null
      this.setData({ task })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '补学任务加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  reviewCourse() {
    const task = this.data.task
    if (!task || !task.canReview) return
    wx.navigateTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(task.courseInstanceId)}` })
  },

  continueTask() {
    const task = this.data.task
    if (!task || !task.canContinue) return
    wx.navigateTo({ url: `/learning/generation-status/index?courseInstanceId=${encodeURIComponent(task.courseInstanceId)}` })
  },

  goBack() { wx.navigateBack() }
})
