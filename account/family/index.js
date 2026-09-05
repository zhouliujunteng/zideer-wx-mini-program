const { loadCurrentFamilyRelations } = require('../../services/identity')

const relationLabels = {
  guardian: '监护人',
  parent: '家长',
  other: '家庭成员'
}

function profileName(profile) {
  if (!profile) return '学生档案'
  return profile.nickname || profile.real_name || '学生档案'
}

Page({
  data: { loading: true, failed: false, self: null, students: [], guardians: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentFamilyRelations()
      this.setData({
        self: data.self,
        students: data.students.map((item) => ({
          ...item,
          name: profileName(item.student),
          initial: profileName(item.student).slice(0, 1),
          relationLabel: relationLabels[item.relationship_type] || '家庭成员',
          gradeLabel: item.student && item.student.current_grade ? `${item.student.school_stage || ''}${item.student.current_grade}年级` : '年级待完善'
        })),
        guardians: data.guardians.map((item) => ({
          ...item,
          initial: '家',
          relationLabel: relationLabels[item.relationship_type] || '监护人'
        }))
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '家庭关系加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  openGuardianDashboard() {
    if (!this.data.students.length) return
    wx.navigateTo({ url: '/account/guardian-dashboard/index' })
  },
  openBindingCode() {
    wx.navigateTo({ url: '/account/binding-code/index' })
  },
  openBindStudent() {
    wx.navigateTo({ url: '/account/bind-student/index' })
  }
})
