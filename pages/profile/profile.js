const { loadCurrentUser, loadCurrentFamilyRelations } = require('../../services/identity')

Page({
  data: {
    loading: true,
    refreshing: false,
    profile: null,
    profileDisplayName: '',
    profileInitial: '',
    profileStatusLabel: '',
    subsidiaries: []
  },

  async onShow() {
    await this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    if (this.data.refreshing) return

    this.setData({ loading: !this.data.profile, refreshing: true })
    try {
      const [user, relations] = await Promise.all([
        loadCurrentUser(),
        loadCurrentFamilyRelations()
      ])
      const profile = user.profile || {}
      const profileDisplayName = profile.nickname || profile.real_name || '知鹿学员'
      const roles = profile.roles || []
      getApp().globalData.user = user
      this.setData({
        profile,
        profileDisplayName,
        profileInitial: profileDisplayName.slice(0, 1),
        profileStatusLabel: roles.some((role) => role.role_code === 'PARTNER') ? '伙伴' : '用户',
        subsidiaries: (relations.students || []).map((item) => {
          const account = item.student || {}
          const displayName = account.nickname || account.real_name || '家庭学生'
          return {
            id: account.id,
            displayName,
            initial: displayName.slice(0, 1),
            relationName: item.relationship_type || '家庭成员',
            statusLabel: item.status === 'active' ? '正常' : '待确认'
          }
        })
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  }
})
