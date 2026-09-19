const { getNavigationMetrics } = require('./utils/navigation')
const { captureReferralContext } = require('./utils/referral-context')
const { resetPhoneSessionVerification } = require('./services/identity')
const { loadUiAssets } = require('./services/ui-assets')

App({
  onLaunch(options) {
    this.globalData.navigation = getNavigationMetrics()
    captureReferralContext(options && options.query)
    // 界面图片由后端下发，启动即预取；失败时各页面挂载时会再试。
    loadUiAssets().catch(() => {})
  },

  onShow(options) { resetPhoneSessionVerification(); captureReferralContext(options && options.query) },

  globalData: {
    user: null,
    navigation: null,
    currentStudentId: 1
  }
})
