const { loadDeepAssessmentEntitlements } = require('../../services/identity')

const subjectNames = {
  Chinese: '语文',
  Mathematics: '数学',
  English: '英语',
  Physics: '物理',
  Chemistry: '化学',
  Biology: '生物',
  History: '历史',
  Geography: '地理',
  Politics: '道德与法治',
  'Information Technology': '信息科技'
}

function formatDate(value) {
  if (!value) return '长期有效'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '有效期待确认'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function resolveSubjects(grant, grade) {
  const gradeScope = Array.isArray(grant.gradeScope) ? grant.gradeScope.map(Number) : []
  const subjectScope = Array.isArray(grant.subjectScope) ? grant.subjectScope : []
  const gradeAllowed = !gradeScope.length || gradeScope.includes(Number(grade))
  return {
    ...grant,
    expiresLabel: formatDate(grant.expiresAt),
    gradeAllowed,
    subjects: subjectScope.map((key) => ({ key, name: subjectNames[key] || key })),
    canStart: grant.status === 'available' && gradeAllowed && subjectScope.length > 0,
    canResume: Boolean(grant.attempt && grant.attempt.status === 'draft')
  }
}

Page({
  data: {
    loading: true,
    failed: false,
    profile: null,
    grants: []
  },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const result = await loadDeepAssessmentEntitlements()
      const grade = result.profile && result.profile.grade
      this.setData({
        profile: result.profile,
        grants: (result.grants || []).map((grant) => resolveSubjects(grant, grade))
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '深测资格加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  startSubject(event) {
    const grantId = event.currentTarget.dataset.grantId
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (!grantId || !subjectKey) return
    wx.navigateTo({
      url: `/assessment/deep/index?grantId=${encodeURIComponent(grantId)}&subjectKey=${encodeURIComponent(subjectKey)}`
    })
  },

  resumeAttempt(event) {
    const grantId = event.currentTarget.dataset.grantId
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (!grantId || !subjectKey) return
    wx.navigateTo({
      url: `/assessment/deep/index?grantId=${encodeURIComponent(grantId)}&subjectKey=${encodeURIComponent(subjectKey)}`
    })
  }
})
