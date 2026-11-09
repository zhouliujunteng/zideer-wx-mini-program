const { loadCurrentUser, bindCurrentPromotionCode, recordCurrentPromotionTouchAndAttribute, isAuthenticationRequired } = require('./identity')
const { readPendingReferral, clearPendingReferral } = require('../utils/referral-context')

// 扫小程序码或点分享卡片带来的推荐人线索，在首页后台静默兑现：不跳页、不弹整页，最多给一行轻提示。
// 未登录或还没建档时原样留着——建档页会把邀请码预填进选填栏，建完回到首页再兑现。
const RETRY_QUIET_MS = 60 * 1000
let running = null
let quietUntil = 0

async function bindPendingReferral(referral) {
  // 扫码进来的只有邀请码，分享卡片进来的是邀请 token（可能附带深测资格）。
  if (referral.code) {
    const bound = await bindCurrentPromotionCode(referral.code)
    const name = (bound.referrer && bound.referrer.name) || '对方'
    if (bound.alreadyBound) return { bound: false, message: `你已有推荐人（${name}），本次邀请码未生效` }
    // 活动开着才会有积分到账，关着时提示保持原样
    return bound.rewardCredits > 0
      ? { bound: true, message: `已绑定推荐人：${name}，获得 ${bound.rewardCredits} 积分` }
      : { bound: true, message: `已绑定推荐人：${name}` }
  }
  const result = await recordCurrentPromotionTouchAndAttribute({ invitationToken: referral.token, sourceType: 'share' })
  if (result.isDeepGift) {
    return { bound: true, message: result.reused ? '深测资格已确认，可在测评中心选择学科开始' : '深测资格已领取，可在测评中心选择学科开始' }
  }
  return { bound: true, message: result.reused ? '' : '已记录邀请，推荐人绑定完成' }
}

/**
 * 兑现待绑定的推荐人线索。返回 null 表示这次什么都没发生（没有线索、还没登录建档、或失败了）；
 * 返回的 message 非空时由调用页给一个 toast 即可。
 */
async function resolvePendingReferral() {
  if (running) return running
  if (Date.now() < quietUntil) return null
  if (!readPendingReferral()) return null
  running = (async () => {
    try {
      const referral = readPendingReferral()
      if (!referral) return null
      const user = await loadCurrentUser()
      if (!user || !user.profileCompleted) return null
      const result = await bindPendingReferral(referral)
      clearPendingReferral()
      return result
    } catch (error) {
      // 码不存在、填的是自己的码这类再试也一样的失败直接丢掉，绝不让它在下次启动重演；
      // 网络问题稍后重试，未登录则等登录完成后的那次调用。
      if (error && error.terminalReferral) clearPendingReferral()
      else if (!isAuthenticationRequired(error)) quietUntil = Date.now() + RETRY_QUIET_MS
      return null
    } finally {
      running = null
    }
  })()
  return running
}

module.exports = { resolvePendingReferral }
