const { getNavigationMetrics } = require('./utils/navigation')
const { captureReferralContext } = require('./utils/referral-context')
const { resetPhoneSessionVerification } = require('./services/identity')

App({
  onLaunch(options) {
    this.globalData.navigation = getNavigationMetrics()
    captureReferralContext(options && options.query)
  },

  onShow(options) { resetPhoneSessionVerification(); captureReferralContext(options && options.query) },

  globalData: {
    user: null,
    navigation: null,
    currentStudentId: 1
  }
})
