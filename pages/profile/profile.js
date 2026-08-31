const { loadCurrentUser, loadSubsidiaries } = require('../../services/identity')

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
      const [user, subsidiaries] = await Promise.all([
        loadCurrentUser(),
        loadSubsidiaries()
      ])
      const profile = user.profile || {}
      const profileDisplayName = profile.nickname || profile.real_name || '知鹿学员'
      getApp().globalData.user = user
      this.setData({
        profile,
        profileDisplayName,
        profileInitial: profileDisplayName.slice(0, 1),
        profileStatusLabel: profile.status === 'active' ? '账号正常' : '资料待完善',
        subsidiaries: subsidiaries.map((item) => {
          const account = item.subsidiary_user || {}
          const displayName = account.nickname || account.real_name || '附属账号'
          return {
            id: account.id,
            displayName,
            initial: displayName.slice(0, 1),
            relationName: item.relation_name || '附属账号',
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
