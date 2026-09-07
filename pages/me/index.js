const { getMeModel } = require('../../services/mock-service')
const { getLiveMeModel } = require('../../services/live-tab-service')

Page({
  data: {
    model: {},
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : {
          left: windowWidth - 92,
          top: (windowInfo.statusBarHeight || 20) + 6,
          width: 87,
          height: 32
        }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 16 * windowWidth / 750,
      model: getMeModel()
    })
  },
  async onShow() {
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/me/index')
    this.setData({ model: getMeModel() })
    try { this.setData({ model: await getLiveMeModel() }) }
    catch (error) { wx.showToast({ title: error.message || '账户资料加载失败', icon: 'none' }) }
  },
  editProfile() { wx.navigateTo({ url: '/pages/profile-setup/index?edit=1' }) },
  copyProfileId() {
    const profile = this.data.model && this.data.model.profile
    const userId = profile && profile.id
    if (!userId) {
      wx.showToast({ title: '暂无可复制的 ID', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: userId,
      success: () => wx.showToast({ title: 'ID 已复制', icon: 'none' })
    })
  },
  handleItem(e) {
    const name = String(e.currentTarget.dataset.name || '')
    const routes = {
      '课程积分': '/commerce/entitlements/index', '金币': '/growth/coins/index',
      '家庭关系': '/account/family/index', '订单': '/commerce/orders/index',
      '消息中心': '/pages/messages/index', '身份与登录': '/account/identity/index',
      '学习档案': '/pages/profile-setup/index?edit=1', '兑换码': '/growth/redemption/index',
      '推广伙伴': '/agent/application/index', '企微服务': '/account/service-contact/index'
    }
    const key = Object.keys(routes).find((item) => name.includes(item))
    if (key) return wx.navigateTo({ url: routes[key] })
    wx.showToast({ title: '该服务正在准备中', icon: 'none' })
  },
  handleEntry(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id === 'learningProfile') return wx.navigateTo({ url: '/pages/profile-setup/index?edit=1' })
    if (id === 'identity') return wx.navigateTo({ url: '/account/identity/index' })
    if (id === 'orders') return wx.navigateTo({ url: '/commerce/orders/index' })
    if (id === 'family') return wx.navigateTo({ url: '/account/family/index' })
    if (id === 'redeem') return wx.navigateTo({ url: '/growth/redemption/index' })
    if (id === 'partner') return wx.navigateTo({ url: '/agent/application/index' })
    wx.showToast({ title: '该服务正在准备中', icon: 'none' })
  }
})
