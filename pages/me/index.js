const { getMeModel } = require('../../services/mock-service')
const { getLiveMeModel } = require('../../services/live-tab-service')
const { loadCurrentMembership, loadCurrentServiceContacts } = require('../../services/identity')
const { membershipView } = require('../../services/membership-view')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')

function loadingMeModel() {
  const model = getMeModel()
  model.membershipCard = model.membershipCard || { title: '知鹿会员', subtitle: '解锁更多专属学习权益', crownIcon: '../../assets/me/membership-crown-matte.png' }
  model.profile = { name: '正在读取资料', id: '', initial: '鹿', avatarUrl: '', gradeLabel: '' }
  model.accountSummary = model.accountSummary.map(item => ({ ...item, value: '—', meta: '' }))
  return model
}

Page({
  data: {
    model: {},
    member: membershipView(null),
    membershipLoading: true,
    membershipError: '',
    enterpriseContacts: [],
    enterpriseServiceOpening: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    profilePaddingTop: 72,
    menuButtonHeight: 32,
    editProfileTop: 26,
    editProfileRight: 98,
    showEditProfile: true,
    topbarBackground: '#FFF1E6'
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
      // 给灵动岛和微信胶囊留出完整安全区，头像从胶囊下方开始布局。
      // 直接把内容首节点推到微信胶囊底部之后，避免 scroll-view padding 在部分机型失效。
      contentTop: Math.round(statusBarHeight + navigationBarHeight + 16 * windowWidth / 750),
      profilePaddingTop: 72 * windowWidth / 750,
      menuButtonHeight: menuButton.height,
      editProfileTop: menuButton.top,
      editProfileRight: Math.max(8, windowWidth - menuButton.left + 8),
      showEditProfile: true,
      topbarBackground: '#FFF1E6',
      model: loadingMeModel()
    })
  },
  async onShow() {
    const version = this._version = (this._version || 0) + 1
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/me/index')
    this.setData({ model: loadingMeModel(), member: membershipView(null), membershipLoading: true, membershipError: '', enterpriseContacts: [] })
    await Promise.all([this.loadProfile(version), this.loadMembership(version), this.loadEnterpriseContacts(version)])
  },
  onHide() { this._version = (this._version || 0) + 1 },
  onUnload() { this.onHide() },
  handlePageScroll() {},
  async loadProfile(version) {
    try {
      const model = await getLiveMeModel()
      if (version === this._version) this.setData({ model })
    }
    catch (error) {
      if (version !== this._version) return
      this.setData({ 'model.profile.name': '资料暂未加载' })
      wx.showToast({ title: error.message || '账户资料加载失败', icon: 'none' })
    }
  },
  async loadMembership(version) {
    try {
      const membership = await loadCurrentMembership()
      if (version === this._version) this.setData({ member: membershipView(membership), membershipLoading: false })
    } catch (error) {
      if (version === this._version) this.setData({ member: membershipView(null), membershipLoading: false, membershipError: error.message || '会员信息暂不可用' })
    }
  },
  async loadEnterpriseContacts(version) {
    try {
      const result = await loadCurrentServiceContacts()
      if (version === this._version) this.setData({ enterpriseContacts: result.status === 'ready' ? result.contacts : [] })
    } catch (error) {
      if (version === this._version) this.setData({ enterpriseContacts: [] })
    }
  },
  async openEnterpriseService() {
    if (this.data.enterpriseServiceOpening) return
    const contacts = this.data.enterpriseContacts || []
    if (contacts.length !== 1) {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    this.setData({ enterpriseServiceOpening: true })
    try {
      await openCustomerServiceChat(contacts[0])
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ enterpriseServiceOpening: false })
    }
  },
  editProfile() { wx.navigateTo({ url: '/pages/profile/index' }) },
  handleDeveloperPreview(e) {
    const id = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id || '')
    if (id === 'profile-setup') return this.editProfile()
    wx.showToast({ title: '该预览入口暂不可用', icon: 'none' })
  },
  openLoginContacts() { wx.navigateTo({ url: '/account/login-identities/index' }) },
  openLearningDevice() { wx.navigateTo({ url: '/learning/device-confirm/index' }) },
  openMembership() { wx.navigateTo({ url: '/commerce/membership/index' }) },
  handleWalletTap(event) {
    const name = String(event.currentTarget.dataset.name || '')
    if (name.includes('课程积分')) return wx.navigateTo({ url: '/commerce/entitlements/index' })
    if (name.includes('金币')) return wx.navigateTo({ url: '/growth/coins/index' })
    wx.showToast({ title: '该账户入口暂不可用', icon: 'none' })
  },
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
      '消息中心': '/pages/messages/index', '账户安全': '/account/login-identities/index', '身份与登录': '/account/identity/index',
      '学习档案': '/pages/profile-setup/index?edit=1', '兑换码': '/pages/redemption/index', '测评中心': '/assessment/center/index',
      '推广伙伴': '/agent/application/index'
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
    if (id === 'redeem') return wx.navigateTo({ url: '/pages/redemption/index' })
    if (id === 'partner') return wx.navigateTo({ url: '/agent/application/index' })
    wx.showToast({ title: '该服务正在准备中', icon: 'none' })
  }
})
