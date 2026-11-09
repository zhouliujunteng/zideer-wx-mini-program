const REFERRAL_CONTEXT_KEY = 'pending_referral_context'
// 邀请码不设有效期（2026-09-22 用户要求）：扫了码的人可能过很久才注册，线索一直留着，
// 直到绑上、被新的一次扫码覆盖，或者用户自己清掉小程序缓存。扫码时还没登录，
// 服务端不知道有人扫过，本地缓存是「扫码 → 注册」之间唯一的桥。
// 邀请 token 仍只留一天：链接本身在服务端有有效期，深测资格也是限量权益。
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000

function storage() {
  if (typeof wx === 'undefined') return null
  return wx
}

function validToken(value) {
  const token = String(value || '').trim()
  return /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : ''
}

// 邀请码：后端生成的 ZL + 8 位（去掉易混淆字符），大小写不敏感。
function validCode(value) {
  const code = String(value || '').trim().toUpperCase()
  return /^ZL[A-Z2-9]{8}$/.test(code) ? code : ''
}

// 小程序码的场景值：Zion 按 key=value&key=value 下发，我们只认 pc=<邀请码>；
// 整串就是邀请码时也接受（扫码入口只带一个值的情况）。
function codeFromScene(scene) {
  const raw = String(scene || '').trim()
  if (!raw) return ''
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch (error) { decoded = raw }
  const direct = validCode(decoded)
  if (direct) return direct
  for (const part of decoded.split('&')) {
    const [key, value] = part.split('=')
    if (String(key || '').trim().toLowerCase() === 'pc') {
      const code = validCode(value)
      if (code) return code
    }
  }
  return ''
}

function readPendingReferral() {
  const api = storage()
  if (!api) return null
  const value = api.getStorageSync(REFERRAL_CONTEXT_KEY)
  if (!value || typeof value !== 'object') return null
  const token = validToken(value.token)
  const code = validCode(value.code)
  const createdAt = Number(value.createdAt)
  const expiredToken = Boolean(token) && Date.now() - createdAt > MAX_TOKEN_AGE_MS
  if ((!token && !code) || !Number.isFinite(createdAt) || expiredToken) {
    api.removeStorageSync(REFERRAL_CONTEXT_KEY)
    return null
  }
  return token ? { token, createdAt } : { code, createdAt }
}

// 两种入口：分享卡片带 token（邀请链路），扫小程序码带 scene（邀请码链路）。
function captureReferralContext(options = {}) {
  const token = validToken(options.token || options.invite || options.scene)
  const code = token ? '' : (codeFromScene(options.scene) || validCode(options.pc))
  if (!token && !code) return readPendingReferral()
  const context = token ? { token, createdAt: Date.now() } : { code, createdAt: Date.now() }
  const api = storage()
  if (api) api.setStorageSync(REFERRAL_CONTEXT_KEY, context)
  return context
}

function clearPendingReferral() {
  const api = storage()
  if (api) api.removeStorageSync(REFERRAL_CONTEXT_KEY)
}

// 登录与建档后一律回首页：待绑定的推荐人线索由首页在后台静默兑现（services/referral-binding），
// 不再把用户甩到「推广伙伴邀请」整页——那会让 24 小时内的每次冷启动都落错地方。
function postAuthenticationUrl(user) {
  if (!user || !user.profileCompleted) return '/pages/profile-setup/index'
  return '/pages/home/index'
}

function postProfileUrl() {
  return '/pages/home/index'
}

module.exports = {
  captureReferralContext,
  codeFromScene,
  clearPendingReferral,
  validPromotionCode: validCode,
  postAuthenticationUrl,
  postProfileUrl,
  readPendingReferral
}
