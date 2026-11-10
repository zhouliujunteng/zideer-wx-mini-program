const { getMeModel } = require('../../services/mock-service')
const { getLiveMeModel, withGuardianQuickActions } = require('../../services/live-tab-service')
const { loadCurrentMembership, loadCurrentTeacherWorkspace, loadAgentIdentity, hasSession } = require('../../services/identity')
const { openLogin, openProfileSetup, guardAccess } = require('../../utils/access-gate')
const { membershipView } = require('../../services/membership-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx, getMenuButtonRect } = require('../../utils/screen')
const { fitFontSize, correctFontSize } = require('../../utils/fit-font')
const { isGuardianAccount, readGuardianHasChildren } = require('../../utils/account-role')
const { miniProgramVersionText } = require('../../utils/mini-program-version')
const { confirmPaymentOpen, attachPaymentSwitch } = require('../../services/payment-switch')

// 钱包卡数字（课程积分、金币）的原字号与最小字号，与 index.wxss 的 .wallet-value 对应。
const WALLET_VALUE_RPX = 36
const WALLET_VALUE_MIN_RPX = 16
// 样式里的 rpx 换成 px 时向下取整（实测 36rpx 在 390 宽手机是 18px、大屏是 21px），JS 里跟着取整，缩放后不会比原字号还大。
const walletValuePx = (rpx) => Math.floor(rpxToPx(rpx))
// 已登录、还没完善学习资料也能用的入口（2026-09-27）：消息只要账号初始化过，身份与登录用来办登录、认证，关于知鹿人人能看。
// 其余入口（订单、积分、兑换码、测评、推广……）后端都要有学习档案，先提示去完善。
const PROFILE_FREE_ITEMS = ['消息中心', '账户安全', '身份与登录', '关于知鹿', '帮助与反馈', '知识图谱']

// 访问状态：guest 未登录；profile 已登录、学习资料未完善；ready 正常。没凭证一律按游客（资料还没读回来时也拦得住）。
function currentAccess(page) {
  if (!hasSession()) return 'guest'
  return page.data.model && page.data.model.access || 'ready'
}

// 第一次读到资料前的模型：只保留固定入口（常用入口、服务菜单），资料、余额位由页面据 profileLoaded 画骨架。
function loadingMeModel() {
  const model = getMeModel()
  model.membershipCard = model.membershipCard || { title: '知鹿会员', subtitle: '解锁更多专属学习权益', crownIcon: '../../assets/me/membership-crown-matte.png' }
  model.profile = { name: '', id: '', initial: '', avatarUrl: '', gradeLabel: '' }
  model.accountSummary = (model.accountSummary || []).map(item => ({ ...item, value: '', meta: '' }))
  model.quickActions = (model.quickActions || []).map(({ unreadCount, ...item }) => item)
  // 上次记下的是已绑定学生的家长：首屏就画「学生看板」，不先闪「测评中心」
  model.quickActions = withGuardianQuickActions(model.quickActions, isGuardianAccount() && readGuardianHasChildren())
  return model
}

Page({
  data: {
    model: {},
    member: membershipView(null),
    membershipLoading: true,
    membershipError: '',
    // 资料、会员第一次读到之前显示骨架；之后切回「我的」保留旧数据，后台静默刷新，不再闪「正在读取资料」。
    profileLoaded: false,
    profileFailed: false,
    membershipLoaded: false,
    // 只有后台开通的有效老师才有值；读取失败时保持隐藏，普通用户永远看不到老师入口。
    teacherEntry: null,
    // 代理身份（爱心妈妈 / 导师妈妈 / 爱心妈妈团团长，2026-11-10）：头像下方的标签；不是代理或读取失败都不显示。
    agentRoles: [],
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    profilePaddingTop: 72,
    menuButtonHeight: 32,
    editProfileTop: 26,
    editProfileRight: 98,
    showEditProfile: true,
    topbarBackground: '#FFF1E6',
    // 钱包卡数字的字号（px，按 accountSummary 下标）；0 或空着就用样式里的原字号。
    walletValueSizes: [],
    // 页面最底部的小程序版本号（本机同步读取，onLoad 里填）
    versionText: '',
    // 支付开关开着才显示会员中心 / 积分包入口（services/payment-switch.js attachPaymentSwitch，没读到过按关着）
    paymentOpen: false
  },
  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = getMenuButtonRect(windowInfo)
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      // 给灵动岛和微信胶囊留出完整安全区，头像从胶囊下方开始布局。
      // 直接把内容首节点推到微信胶囊底部之后，避免 scroll-view padding 在部分机型失效。
      contentTop: Math.round(statusBarHeight + navigationBarHeight + rpxToPx(16, windowWidth)),
      profilePaddingTop: rpxToPx(72, windowWidth),
      menuButtonHeight: menuButton.height,
      editProfileTop: menuButton.top,
      editProfileRight: Math.max(8, windowWidth - menuButton.left + 8),
      showEditProfile: true,
      topbarBackground: '#FFF1E6',
      model: loadingMeModel(),
      versionText: miniProgramVersionText()
    })
  },
  async onShow() {
    attachPaymentSwitch(this)
    const version = this._version = (this._version || 0) + 1
    const app = getApp()
    if (app && app.markTabVisible) app.markTabVisible('pages/me/index')
    // 游客（2026-09-27 起未登录也能浏览）：没有会员、老师身份可读，资料位换成「登录 / 注册」
    if (!hasSession()) {
      this.setData({ member: membershipView(null), membershipLoading: false, membershipLoaded: true, membershipError: '', teacherEntry: null, agentRoles: [] })
      await this.loadProfile(version)
      return
    }
    // 上次显示的是游客：刚登录回来，回到骨架再读，不把「登录 / 注册」当旧数据留着
    if (this.data.model.access === 'guest') this.setData({ model: loadingMeModel(), profileLoaded: false, profileFailed: false, membershipLoaded: false, walletValueSizes: [] })
    // 保留上次读到的资料、会员状态直到本次读取完成，避免每次切回「我的」都先闪一下占位内容。
    this.setData({ membershipLoading: true, membershipError: '' })
    await Promise.all([this.loadProfile(version), this.loadMembership(version), this.loadTeacherEntry(version), this.loadAgentRoles(version)])
  },
  // 骨架阶段先量出钱包卡的可用宽度，数据到了就能直接按宽度定字号，不先撑出去再缩。
  onReady() { this.fitWalletValues() },
  // 转屏、分屏改变宽度后重算字号（等新布局排好再量）。
  onResize() { setTimeout(() => this.fitWalletValues(), 60) },
  onHide() { this._version = (this._version || 0) + 1 },
  onUnload() { this.onHide() },
  handlePageScroll() {},
  async loadProfile(version) {
    try {
      const model = await getLiveMeModel()
      if (version === this._version) this.setData({ model, profileLoaded: true, profileFailed: false, walletValueSizes: this.estimateWalletValueSizes(model) }, () => this.fitWalletValues())
    }
    catch (error) {
      if (version !== this._version) return
      if (!this.data.profileLoaded) this.setData({ profileFailed: true, 'model.profile.name': '资料暂未加载' })
      wx.showToast({ title: error.message || '账户资料加载失败', icon: 'none' })
    }
  },
  async loadMembership(version) {
    try {
      const membership = await loadCurrentMembership()
      if (version === this._version) this.setData({ member: membershipView(membership), membershipLoading: false, membershipLoaded: true })
    } catch (error) {
      if (version === this._version) this.setData({ member: membershipView(null), membershipLoading: false, membershipLoaded: true, membershipError: error.message || '会员信息暂不可用' })
    }
  },
  async loadTeacherEntry(version) {
    try {
      const result = await loadCurrentTeacherWorkspace()
      if (version !== this._version) return
      this.setData({ teacherEntry: result.status === 'ready'
        ? { name: result.teacher.name, description: `负责 ${result.students.length} 名学生` }
        : null })
    } catch (error) {
      if (version === this._version) this.setData({ teacherEntry: null })
    }
  },
  // 读不到时保留上次显示的标签（回页静默刷新），第一次就读不到则不显示
  async loadAgentRoles(version) {
    try {
      const result = await loadAgentIdentity()
      if (version === this._version) this.setData({ agentRoles: result.roles })
    } catch (error) {}
  },
  openAgentIdentity() { wx.navigateTo({ url: '/account/agent-identity/index' }) },
  // 积分、金币位数多（如 200000）时缩小字号，不撑出卡片：按量到的卡内宽度估算。
  estimateWalletValueSizes(model) {
    const widths = this._walletBoxWidths || []
    const base = walletValuePx(WALLET_VALUE_RPX)
    const min = walletValuePx(WALLET_VALUE_MIN_RPX)
    return ((model && model.accountSummary) || []).map((item, index) => fitFontSize(item.value, widths[index], base, min))
  },
  // 渲染后按实测文字宽度和实际字号校正（估算的字宽和真机字体会有出入），顺带记下卡内宽度给下次估算用。
  fitWalletValues() {
    if (typeof this.createSelectorQuery !== 'function') return
    const query = this.createSelectorQuery()
    query.selectAll('.wallet-module-copy').boundingClientRect()
    query.selectAll('.wallet-value').fields({ size: true, computedStyle: ['font-size'] })
    query.exec((result) => {
      const boxes = (result && result[0]) || []
      const values = (result && result[1]) || []
      if (boxes.length) this._walletBoxWidths = boxes.map(box => box.width)
      if (!this.data.profileLoaded || !values.length || values.length !== boxes.length) return
      const base = walletValuePx(WALLET_VALUE_RPX)
      const min = walletValuePx(WALLET_VALUE_MIN_RPX)
      const current = this.data.walletValueSizes || []
      const sizes = values.map((node, index) => {
        const rendered = parseFloat(node['font-size'])
        if (!node.width || !boxes[index].width || !rendered) return current[index] || 0
        return correctFontSize(rendered, node.width, boxes[index].width, base, min)
      })
      // 实测超出卡片就一定改；只差不到半像素的缩放不重排
      const overflowing = values.some((node, index) => node.width > boxes[index].width)
      if (overflowing || sizes.some((size, index) => Math.abs(size - (current[index] || 0)) >= 0.5)) this.setData({ walletValueSizes: sizes })
    })
  },
  openTeacherWorkspace() { wx.navigateTo({ url: '/teacher/workspace/index' }) },
  // 点头像、昵称或「编辑资料」：游客去登录，没完善学习资料的去完善（建档向导），已建档的进个人资料
  editProfile() {
    const access = currentAccess(this)
    if (access === 'guest') return openLogin()
    if (access === 'profile') return openProfileSetup()
    wx.navigateTo({ url: '/pages/profile/index' })
  },
  handleDeveloperPreview(e) {
    const id = String(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id || '')
    if (id === 'profile-setup') return this.editProfile()
    wx.showToast({ title: '该预览入口暂不可用', icon: 'none' })
  },
  openLoginContacts() {
    if (!hasSession()) return openLogin()
    wx.navigateTo({ url: '/account/login-identities/index' })
  },
  // 支付开关关着时会员卡不显示；这里再核一次只为刚关掉、页面还没刷新时兜底（弹提示，游客也不先去登录）
  async openMembership() {
    if (this._openingMembership) return
    this._openingMembership = true
    try {
      if (!(await confirmPaymentOpen('membership'))) return
      if (guardAccess(currentAccess(this), '完善学习资料后就能开通会员。')) return
      wx.navigateTo({ url: '/commerce/membership/index' })
    } finally {
      this._openingMembership = false
    }
  },
  handleWalletTap(event) {
    if (guardAccess(currentAccess(this), '完善学习资料后就能使用课程积分和金币。')) return
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
      '消息中心': '/pages/messages/index', '账户安全': '/account/login-identities/index', '身份与登录': '/account/login-identities/index',
      '学习档案': '/pages/profile-setup/index?edit=1', '兑换码': '/pages/redemption/index', '测评中心': '/assessment/center/index', '学生看板': '/account/guardian-dashboard/index',
      '推广伙伴': '/agent/promotion/index',
      '学习报告': '/account/parent-reports/index',
      '帮助与反馈': '/account/help-center/index',
      '关于知鹿': '/account/about/index',
      // 知识图谱（2026-10-10 起不在底栏）：游客、没建档也能看示例图谱
      '知识图谱': '/pages/knowledge-map/index'
    }
    const key = Object.keys(routes).find((item) => name.includes(item))
    if (!key) return wx.showToast({ title: '该服务正在准备中', icon: 'none' })
    // 入口都照常显示；游客点了先登录（「关于知鹿」除外），没完善学习资料的点了要档案的入口先去完善
    const access = currentAccess(this)
    if (!['关于知鹿', '帮助与反馈', '知识图谱'].includes(key) && access === 'guest') return openLogin()
    if (!PROFILE_FREE_ITEMS.includes(key) && guardAccess(access)) return
    wx.navigateTo({ url: routes[key] })
  },
  handleEntry(e) {
    if (guardAccess(currentAccess(this))) return
    const id = String(e.currentTarget.dataset.id || '')
    if (id === 'learningProfile') return wx.navigateTo({ url: '/pages/profile-setup/index?edit=1' })
    if (id === 'identity') return wx.navigateTo({ url: '/account/login-identities/index' })
    if (id === 'orders') return wx.navigateTo({ url: '/commerce/orders/index' })
    if (id === 'family') return wx.navigateTo({ url: '/account/family/index' })
    if (id === 'redeem') return wx.navigateTo({ url: '/pages/redemption/index' })
    if (id === 'partner') return wx.navigateTo({ url: '/agent/application/index' })
    wx.showToast({ title: '该服务正在准备中', icon: 'none' })
  }
})
