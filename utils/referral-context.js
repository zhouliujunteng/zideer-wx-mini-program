const REFERRAL_CONTEXT_KEY = 'pending_referral_context'
const MAX_CONTEXT_AGE_MS = 24 * 60 * 60 * 1000

function storage() {
  if (typeof wx === 'undefined') return null
  return wx
}

function validToken(value) {
  const token = String(value || '').trim()
  return /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : ''
}

function readPendingReferral() {
  const api = storage()
  if (!api) return null
  const value = api.getStorageSync(REFERRAL_CONTEXT_KEY)
  if (!value || typeof value !== 'object') return null
  const token = validToken(value.token)
  const createdAt = Number(value.createdAt)
  if (!token || !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_CONTEXT_AGE_MS) {
    api.removeStorageSync(REFERRAL_CONTEXT_KEY)
    return null
  }
  return { token, createdAt }
}

function captureReferralContext(options = {}) {
  const token = validToken(options.token || options.invite || options.scene)
  if (!token) return readPendingReferral()
  const context = { token, createdAt: Date.now() }
  const api = storage()
  if (api) api.setStorageSync(REFERRAL_CONTEXT_KEY, context)
  return context
}

function hasPendingReferral() {
  return Boolean(readPendingReferral())
}

function clearPendingReferral() {
  const api = storage()
  if (api) api.removeStorageSync(REFERRAL_CONTEXT_KEY)
}

function postAuthenticationUrl(user) {
  if (!user || !user.profileCompleted) return '/pages/profile-setup/index'
  return hasPendingReferral() ? '/pages/referral-entry/index' : '/pages/home/index'
}

function postProfileUrl() {
  return hasPendingReferral() ? '/pages/referral-entry/index' : '/pages/home/index'
}

module.exports = {
  captureReferralContext,
  clearPendingReferral,
  hasPendingReferral,
  postAuthenticationUrl,
  postProfileUrl,
  readPendingReferral
}
