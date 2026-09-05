const { loadGuardianDashboard } = require('../../services/identity')

function profileName(profile) {
  return profile.nickname || profile.real_name || '学生档案'
}

function formatDate(value) {
  if (!value) return '暂未生成'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂未生成'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function numberText(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(Math.round(number)) : '0'
}

function buildChild(item) {
  const profile = item.profile || {}
  const prediction = item.prediction
  const report = item.report
  const plan = item.plan
  const credit = item.creditAccount
  return {
    ...item,
    id: profile.id,
    name: profileName(profile),
    initial: profileName(profile).slice(0, 1),
    gradeLabel: profile.current_grade ? `${profile.school_stage || ''}${profile.current_grade}年级` : '年级待完善',
    reportStatus: report ? (report.status === 'completed' || report.status === 'ready' ? '诊断已生成' : '诊断处理中') : '尚无诊断',
    reportSummary: report && report.summary ? (report.summary.overview || report.summary.headline || report.summary.text || '诊断报告已生成，正在补充摘要。') : '完成测评并等待分析后，会在这里展示诊断摘要。',
    reportDate: report ? formatDate(report.generated_at) : '',
    predictionLabel: prediction ? `${prediction.subject_code || '当前学科'} ${numberText(prediction.score_lower)}-${numberText(prediction.score_upper)}` : '暂未生成',
    predictionMeta: prediction ? `更新于 ${formatDate(prediction.predicted_at)}` : '需要更多测评证据',
    planLabel: plan ? (plan.name || plan.plan_no || '学习计划') : '暂无执行计划',
    planMeta: plan ? `${plan.status || '状态待确认'} · ${formatDate(plan.generated_at)}` : '生成计划后会同步到这里',
    credits: credit ? numberText(credit.available_credits) : '0',
    frozenCredits: credit ? numberText(credit.frozen_credits) : '0'
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
      const data = await loadGuardianDashboard()
      const children = data.children.map(buildChild)
      const currentIndex = Math.min(this.data.currentIndex, Math.max(children.length - 1, 0))
      this.setData({ children, currentIndex, current: children[currentIndex] || null })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '家长看板加载失败', icon: 'none' })
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

  openPage(event) {
    const routes = {
      assessment: '/assessment/center/index',
      report: '/diagnosis/report/index',
      forecast: '/diagnosis/score-forecast/index',
      plans: '/diagnosis/plans/index',
      credits: '/commerce/entitlements/index',
      orders: '/commerce/orders/index',
      learningFeed: '/account/child-learning-feed/index',
      topicReports: '/account/topic-learning-report/index'
    }
    const route = routes[event.currentTarget.dataset.target]
    if (route) wx.navigateTo({ url: route })
  }
})
