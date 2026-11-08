const supportDiagnostics = require('./utils/support-diagnostics')
const { getNavigationMetrics } = require('./utils/navigation')
const { captureReferralContext } = require('./utils/referral-context')
const { resetPhoneSessionVerification, getStoredToken, registerServiceAccountLink } = require('./services/identity')
const { loadUiAssets } = require('./services/ui-assets')

const SERVICE_LINK_KEY = 'zhilu_service_account_link'

App({
  onLaunch(options) {
    supportDiagnostics.install()
    supportDiagnostics.record('launch')
    this.globalData.navigation = getNavigationMetrics()
    captureReferralContext(options && options.query)
    // 界面图片由后端下发，启动即预取；失败时各页面挂载时会再试。
    loadUiAssets().catch(() => {})
  },

  onShow(options) {
    supportDiagnostics.record('show')
    resetPhoneSessionVerification()
    captureReferralContext(options && options.query)
    // 服务号菜单「已定课程」：小程序已在后台时也带着 tab=custom 回到学习页（tab 页 onLoad 不会再跑）
    if (options && options.path === 'pages/learning/index' && options.query && options.query.tab) this.globalData.learningTab = String(options.query.tab)
    this.linkServiceAccount()
  },

  // 服务号菜单「学习报告」靠「小程序账号 ↔ 微信 UnionID」认人：登录状态下每天登记一次（课程服务 /api/learn/mp-link），失败静默。
  linkServiceAccount() {
    const token = getStoredToken()
    if (!token) return
    const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    let last = ''
    try { last = wx.getStorageSync(SERVICE_LINK_KEY) } catch (error) {}
    if (last === `${day}:${token.slice(-12)}`) return
    registerServiceAccountLink()
      .then(() => { try { wx.setStorageSync(SERVICE_LINK_KEY, `${day}:${token.slice(-12)}`) } catch (error) {} })
      .catch(() => {})
  },

  onError() { supportDiagnostics.record('error', 'script') },
  onUnhandledRejection() { supportDiagnostics.record('unhandled', 'promise') },

  // 五个 tab 页 onShow 时调用：让自定义底栏选中当前页，并按最新身份决定画四项还是五项
  markTabVisible(route) {
    supportDiagnostics.record('page')
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    if (!page || page.route !== route || typeof page.getTabBar !== 'function') return
    const tabBar = page.getTabBar()
    if (tabBar && typeof tabBar.refresh === 'function') tabBar.refresh(route)
  },

  globalData: {
    user: null,
    navigation: null,
    currentStudentId: 1,
    // 学习页要打开的「我的课程」栏（服务号菜单「已定课程」= custom），学习页用一次就清掉
    learningTab: ''
  }
})
