const { loadAssessmentCenter } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx } = require('../../utils/screen')

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
  return ['in_progress', 'started', 'answering', 'pending', 'draft', 'partial'].includes(String(attempt.status || '').toLowerCase())
}

// 比上次涨跌（2026-10-06）：同一范围做完过两次以上时，记录上标「比上次 +X 分」。
// 历次成绩是测评中心回包里各范围的 entry.history（动作流 paperHistory：attemptId 报告编号、number 第几次、totalScore 综合掌握度）；
// 口径与 services/assessment.js 的 historyChange 相同（本页不依赖测评服务，在这里算一份）。返回 报告编号 → { label, tone }。
function scoreChanges(subjects) {
  const out = {}
  const score = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 10) / 10)
  ;(subjects || []).forEach((subject) => (subject.scopes || []).forEach((scope) => {
    const list = ((scope.entry && scope.entry.history) || [])
      .filter((item) => item && item.attemptId != null && Number(item.number) > 0)
      .sort((a, b) => Number(b.number) - Number(a.number))
    list.forEach((item, index) => {
      const now = score(item.totalScore), before = list[index + 1] ? score(list[index + 1].totalScore) : null
      if (now == null || before == null) return
      const diff = Math.round((now - before) * 10) / 10
      out[String(item.attemptId)] = diff > 0 ? { label: `比上次 +${diff} 分`, tone: 'up' } : diff < 0 ? { label: `比上次 ${diff} 分`, tone: 'down' } : { label: '与上次持平', tone: 'flat' }
    })
  }))
  return out
}

// 页面固定文案与统计卡片外框：进入即显示；数字、学科、记录等后端数据第一次到达前由页面画骨架。
function staticModel() {
  return {
    title: '测评中心',
    heroTitle: '先了解，再出发',
    heroSubtitle: '围绕你的学习目标测一轮，找出卡在哪里、先补什么。',
    statsTitle: '近7日统计',
    stats: [
      { value: '', label: '进行中', numberTone: 'orange', icon: '../../assets/assessment-center/in-progress.png' },
      { value: '', label: '已完成', numberTone: 'green', icon: '../../assets/assessment-center/completed.png' },
      { value: '', label: '待确认', numberTone: 'purple', icon: '../../assets/assessment-center/pending-confirmation.png' }
    ],
    basicSection: { title: '按学科完整测评', subtitle: '整科摸底，题目较多，可分几轮做完' },
    subjects: [],
    history: { title: '测评记录', countLabel: '', records: [], actionLabel: '查看全部' },
    profile: null
  }
}

function buildModel(center) {
  const attempts = center.attempts || []
  const subjects = (center.subjects || []).map((subject) => {
    const activeScope = subject.scopes.find((scope) => scope.entry && ['resume', 'continue'].includes(scope.entry.mode))
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

  // 测评记录只列已交卷的轮次（多轮测评每完成一轮一条），作答中的不展示；点进去看这一轮的结论。
  // 同一范围再测过（2026-10-03 起可以再测一次）的记录标上第几次，并标出比上次涨跌多少分。
  const changes = scoreChanges(center.subjects)
  const history = attempts.filter(attemptIsComplete).map((attempt) => ({
    id: String(attempt.id),
    subject: (attempt.name || attempt.subjectName || '测评记录') + (attempt.paperCount > 1 ? ` · 第 ${attempt.paperNumber} 次` : ''),
    deltaLabel: attempt.paperCount > 1 && changes[String(attempt.id)] ? changes[String(attempt.id)].label : '',
    deltaTone: attempt.paperCount > 1 && changes[String(attempt.id)] ? changes[String(attempt.id)].tone : '',
    detail: attempt.roundCount > 1 ? `${attempt.statusLabel || '测评记录'} · ${attempt.completedRounds || 0}/${attempt.roundCount} 轮` : (attempt.statusLabel || '测评记录'),
    date: formatDate(attempt.submittedAt || attempt.completedAt || attempt.startedAt || attempt.updatedAt || attempt.createdAt)
  }))

  const inProgress = attempts.filter(attemptIsActive).length
  const completed = attempts.filter(attemptIsComplete).length
  const pending = Math.max(0, attempts.length - inProgress - completed)

  const model = staticModel()
  const counts = [inProgress, completed, pending]
  return {
    ...model,
    stats: model.stats.map((item, index) => ({ ...item, value: String(counts[index]) })),
    subjects,
    history: { ...model.history, countLabel: `${history.length} 条记录`, records: history },
    profile: center.profile || null
  }
}

Page({
  // loaded：第一次读到测评中心之前数据位画骨架；之后回到页面保留旧数据，后台静默刷新。
  data: { model: staticModel(), loaded: false, loadFailed: false, refreshing: false, statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },

  onLoad() {
    attachUiAssets(this)
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = info.windowWidth || 375
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: (info.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = info.statusBarHeight || 20
    const navigationBarHeight = menu.height + (menu.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(18, width) })
  },

  onShow() { this.loadPage() },
  onPullDownRefresh() { this.loadPage(true).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ refreshing, loadFailed: false })
    try {
      const center = await loadAssessmentCenter()
      this.setData({ model: buildModel(center), loaded: true })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '测评中心加载失败', icon: 'none' })
    } finally { this.setData({ refreshing: false }) }
  },
  // 重新加载按钮：点击事件不能当作 refreshing 参数传进 loadPage
  retryLoad() { return this.loadPage() },
  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  // 按目标测评（2026-10-10 用户规则：做主入口）：围绕学习目标出题，错了就往前置知识点挖
  openGoalDiagnosis() {
    wx.navigateTo({ url: '/learning/goal-diagnosis/index' })
  },
  handleAction(event) {
    const type = event.currentTarget.dataset.type
    const subjectKey = String(event.currentTarget.dataset.subjectKey || '')
    if (type === 'subject' && subjectKey) {
      return wx.navigateTo({ url: `/assessment/short/index?subjectKey=${encodeURIComponent(subjectKey)}` })
    }
    // 单条测评记录：按测评编号打开这次测评（已完成看报告与逐题回顾，未完成接着作答）。
    // 以前这里没带编号，点进去只落到学科选择页，看不到自己的答案。
    if (type === 'record') {
      const attemptId = String(event.currentTarget.dataset.attemptId || '')
      if (!/^[1-9][0-9]*$/.test(attemptId)) return
      return wx.navigateTo({ url: `/assessment/short/index?attemptId=${encodeURIComponent(attemptId)}` })
    }
    if (type === 'history') {
      return wx.navigateTo({ url: '/assessment/short/index' })
    }
  }
})
