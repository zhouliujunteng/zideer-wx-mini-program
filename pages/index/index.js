const { loadCurrentUser, loadCourseHome } = require('../../services/identity')

Page({
  data: {
    loading: true,
    nickname: '学员',
    hasActivePlan: false,
    plans: [],
    courses: []
  },

  async onShow() {
    await this.loadPage()
  },

  async loadPage() {
    this.setData({ loading: true })
    try {
      const [user, home] = await Promise.all([loadCurrentUser(), loadCourseHome()])
      getApp().globalData.user = user
      this.setData({
        nickname: user.profile.nickname || user.profile.real_name || '学员',
        hasActivePlan: home.hasActivePlan,
        plans: home.plans || [],
        courses: home.courses || []
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  openProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  }
})
