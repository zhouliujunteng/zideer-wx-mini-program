const { loadCurrentUser, recordCurrentPromotionTouchAndAttribute } = require('../../services/identity')
const { captureReferralContext, clearPendingReferral, readPendingReferral } = require('../../utils/referral-context')

Page({
  data: { tokenProvided: false, processing: false, completed: false, message: '' },
  async onLoad(options = {}) {
    const referral = captureReferralContext(options)
    this.setData({ tokenProvided: Boolean(referral || readPendingReferral()) })
    await this.processReferral()
  },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
  async processReferral() {
    if (this.data.processing || this.data.completed) return
    const referral = readPendingReferral()
    if (!referral) {
      this.setData({ message: '邀请链接无效或已过期。' })
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const user = await loadCurrentUser()
      if (!user || !user.profileCompleted) {
        wx.reLaunch({ url: '/pages/profile-setup/index' })
        return
      }
      const result = await recordCurrentPromotionTouchAndAttribute({ invitationToken: referral.token, sourceType: 'share' })
      clearPendingReferral()
      this.setData({ completed: true, message: result.reused ? '邀请信息已确认。' : '邀请已领取，归因已记录。' })
    } catch (error) {
      if (error && error.terminalReferral) clearPendingReferral()
      this.setData({ message: error.message || '邀请处理失败，请稍后重试。' })
    } finally {
      this.setData({ processing: false })
    }
  },
  retry() {
    this.processReferral()
  }
})
