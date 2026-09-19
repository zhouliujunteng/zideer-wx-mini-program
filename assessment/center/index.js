const { loadAssessmentCenter } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')

function formatDate(value) {
  if (!value) return '日期待确认'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日期待确认'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function attemptIsComplete(attempt) {
  return ['completed', 'submitted', 'scored', 'analyzed'].includes(String(attempt.status || '').toLowerCase())
}

function attemptIsActive(attempt) {
  return ['in_progress', 'started', 'answering', 'pending', 'draft'].includes(String(attempt.status || '').toLowerCase())
}

function buildModel(center) {
  const attempts = center.attempts || []
  const subjects = (center.subjects || []).map((subject) => {
    const activeScope = subject.scopes.find((scope) => scope.entry && scope.entry.mode === 'resume')
    const active = Boolean(activeScope)
    const ready = subject.readyCount > 0
    return {
      key: subject.key,
      name: subject.name || subject.key,
      readyCount: subject.readyCount,
      scopes: subject.scopes,
      displayStatus: ready ? (active ? '进行中' : '可测评') : '题库准备中',
      statusTone: ready ? (active ? 'in-progress' : 'ready') : 'not-ready',
      actionLabel: ready ? (active ? '继续' : '开始') : '准备中',
      disabled: !ready
    }
  })

  const history = attempts.map((attempt) => ({
    id: String(attempt.id),
    subject: attempt.name || attempt.subjectName || '测评记录',
    detail: attempt.statusLabel || '测评记录',
    date: formatDate(attempt.submittedAt || attempt.completedAt || attempt.startedAt || attempt.updatedAt || attempt.createdAt)
  }))

  const inProgress = attempts.filter(attemptIsActive).length
  const completed = attempts.filter(attemptIsComplete).length
  const pending = Math.max(0, attempts.length - inProgress - completed)

  return {
    title: '测评中心',
    heroTitle: '先了解，再出发',
    heroSubtitle: '选择学科开始摸底诊断，找到适合自己的学习方向。',
    statsTitle: '近7日统计',
    stats: [
      { value: String(inProgress), label: '进行中', numberTone: 'orange', icon: '../../assets/assessment-center/in-progress.png' },
      { value: String(completed), label: '已完成', numberTone: 'green', icon: '../../assets/assessment-center/completed.png' },
      { value: String(pending), label: '待确认', numberTone: 'purple', icon: '../../assets/assessment-center/pending-confirmation.png' }
    ],
    basicSection: { title: '摸底诊断' },
    subjects,
    history: { title: '测评记录', countLabel: `${history.length} 条记录`, records: history, actionLabel: '查看全部' },
    profile: center.profile || null
  }
}

Page({
  data: { model: {}, loading: true, loadFailed: false, refreshing: false, statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },

  onLoad() {
    attachUiAssets(this)
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = info.windowWidth || 375
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: (info.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = info.statusBarHeight || 20
    const navigationBarHeight = menu.height + (menu.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 * width / 750 })
  },

  onShow() { this.loadPage() },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ loading: !refreshing && !this.data.model.title, refreshing, loadFailed: false })
    try {
      const center = await loadAssessmentCenter()
      this.setData({ model: buildModel(center) })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '测评中心加载失败', icon: 'none' })
    } finally { this.setData({ loading: false, refreshing: false }) }
  },
  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  handleAction(event) {
    const type = event.currentTarget.dataset.type
    const subjectKey = String(event.currentTarget.dataset.subjectKey || '')
    if (type === 'subject' && subjectKey) {
      return wx.navigateTo({ url: `/assessment/short/index?subjectKey=${encodeURIComponent(subjectKey)}` })
    }
    if (type === 'history') {
      return wx.navigateTo({ url: '/assessment/short/index' })
    }
  }
})
