// 麦克风、摄像头、相册权限：用之前先问，被拒后引导去设置（2026-10-06，更新日志 1.0.2「修复相机、录音、相册无权限」）。
//
// 微信对同一项权限只弹一次系统授权框：用户拒过之后 wx.authorize 直接失败、不再弹框，只能去设置页重新打开。
// wx.openSetting 必须由用户点击触发——在 showModal 的确认回调里同步调用是允许的，所以被拒时先弹窗说明，点「去设置」再打开。
// 设置页解决不了的失败要分开说，不能一律引导去设置：
// - 没同意《隐私保护指引》（errno 104）或指引里没声明这项权限（errno 112）：设置页里根本没有这一项；
// - 手机系统没允许微信用麦克风 / 摄像头 / 相册（小程序里已授权，接口仍报权限错误）：要去手机的系统设置。
//
// 页面用法：开始前 `await ensureScope(scope, 文案)`，返回 false 就不往下走（弹窗已经说明过）；
// 接口 fail / onError 里 `guideOnFailure(error, 文案)`，返回 'other' 时说明不是权限问题，由页面自己提示。

const SCOPE_GUIDES = {
  'scope.record': { name: '麦克风', title: '需要麦克风权限', content: '请在设置里打开「麦克风」后再试。' },
  'scope.camera': { name: '摄像头', title: '需要摄像头权限', content: '请在设置里打开「摄像头」后再试。' },
  'scope.writePhotosAlbum': { name: '相册', title: '需要相册权限', content: '保存图片需要允许访问相册，请在设置里打开相册权限后再试。' }
}

// 隐私协议类失败的 errno：104 用户没同意隐私保护指引，112 指引里没声明这项接口
const ERRNO_PRIVACY_UNAGREED = 104
const ERRNO_PRIVACY_UNDECLARED = 112
// 「隐私协议」「系统权限」要先于一般的拒绝判断：它们的 errMsg 里也带 permission / not authorized
const PRIVACY_UNDECLARED_PATTERN = /not declared in the privacy|未声明/i
const PRIVACY_PATTERN = /privacy|隐私/i
const SYSTEM_DENIED_PATTERN = /system permission|system auth|系统权限/i
const AUTH_DENIED_PATTERN = /auth\s*den(?:y|ied)|authorize\s*no\s*response|permission\s*denied|not\s*authori[sz]ed|no\s*permission|未授权|拒绝/i
const CANCEL_PATTERN = /cancel/i

function hasApi(name) {
  return typeof wx !== 'undefined' && Boolean(wx) && typeof wx[name] === 'function'
}

function errorText(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  return String(error.errMsg || error.message || '')
}

function errorNumber(error) {
  const value = error && typeof error === 'object' ? Number(error.errno) : NaN
  return Number.isFinite(value) ? value : 0
}

// 'undeclared' 指引里没声明 / 'unagreed' 用户没同意 / '' 不是隐私协议的问题
function privacyReason(error) {
  const errno = errorNumber(error)
  const text = errorText(error)
  if (errno === ERRNO_PRIVACY_UNDECLARED || PRIVACY_UNDECLARED_PATTERN.test(text)) return 'undeclared'
  if (errno === ERRNO_PRIVACY_UNAGREED || PRIVACY_PATTERN.test(text)) return 'unagreed'
  return ''
}

function isPrivacyError(error) {
  return Boolean(privacyReason(error))
}

// 用户自己取消（关掉选择器、点了取消）：静默，不算失败
function isCancel(error) {
  const text = errorText(error)
  return CANCEL_PATTERN.test(text) && !isPrivacyError(error) && !AUTH_DENIED_PATTERN.test(text)
}

// 只看错误本身的分类：'cancel' | 'privacy' | 'system' | 'denied' | 'other'
function failureKind(error) {
  if (isPrivacyError(error)) return 'privacy'
  const text = errorText(error)
  if (SYSTEM_DENIED_PATTERN.test(text)) return 'system'
  if (AUTH_DENIED_PATTERN.test(text)) return 'denied'
  if (CANCEL_PATTERN.test(text)) return 'cancel'
  return 'other'
}

function guideText(scope, overrides) {
  const base = SCOPE_GUIDES[scope] || {}
  const options = overrides || {}
  return {
    scope: scope || '',
    name: options.name || base.name || '',
    title: options.title || base.title || '需要权限',
    content: options.content || base.content || '请在设置里打开对应权限后再试。'
  }
}

// 读不到设置（接口不存在或失败）给 null，调用方按「不知道」处理
function readAuthSetting() {
  return new Promise((resolve) => {
    if (!hasApi('getSetting')) return resolve(null)
    wx.getSetting({
      success: (result) => resolve((result && result.authSetting) || {}),
      fail: () => resolve(null)
    })
  })
}

function authorize(scope) {
  return new Promise((resolve) => {
    // 没有授权框的环境（部分开发者工具）直接放行：真正调用失败时还会走 guideOnFailure
    if (!hasApi('authorize')) return resolve({ ok: true, error: null })
    wx.authorize({
      scope,
      success: () => resolve({ ok: true, error: null }),
      fail: (error) => resolve({ ok: false, error })
    })
  })
}

function showNotice(title, content) {
  return new Promise((resolve) => {
    if (!hasApi('showModal')) {
      if (hasApi('showToast')) wx.showToast({ title, icon: 'none' })
      return resolve()
    }
    wx.showModal({ title, content, showCancel: false, confirmText: '知道了', success: () => resolve(), fail: () => resolve() })
  })
}

// 隐私协议没同意 / 没声明：去设置页没用，只说明原因
function showPrivacyNotice(error, guide) {
  const name = guide.name || '这项功能'
  if (privacyReason(error) === 'undeclared') {
    return showNotice(`暂时无法使用${name}`, `小程序的隐私保护指引里还没有声明${name}权限，设置里也打不开。请联系客服处理。`)
  }
  return showNotice('需要同意隐私保护指引', `使用${name}前需要先同意《隐私保护指引》。请重新操作，在弹出的隐私提示里点「同意」。`)
}

// 手机系统没允许微信使用：能打开微信的系统权限页就带过去（基础库 2.25.3 起），否则只说明
function showSystemGuide(guide) {
  const name = guide.name || '这项权限'
  const content = `手机系统还没允许微信使用${name}。请在手机「设置 → 微信」里打开${name}后再试。`
  if (!hasApi('openAppAuthorizeSetting') || !hasApi('showModal')) return showNotice(`微信没有${name}权限`, content)
  return new Promise((resolve) => {
    wx.showModal({
      title: `微信没有${name}权限`,
      content,
      confirmText: '去设置',
      cancelText: '暂不开启',
      success: (result) => {
        if (result && result.confirm) wx.openAppAuthorizeSetting({ fail() {} })
        resolve()
      },
      fail: () => resolve()
    })
  })
}

// 弹窗说明 → 用户点「去设置」→ 打开设置页 → 回来再查一次。返回回来时这项权限是否已打开。
function guideToSetting(scope, guide) {
  return new Promise((resolve) => {
    if (!hasApi('showModal')) {
      if (hasApi('showToast')) wx.showToast({ title: guide.title, icon: 'none' })
      return resolve(false)
    }
    wx.showModal({
      title: guide.title,
      content: guide.content,
      confirmText: '去设置',
      cancelText: '暂不开启',
      success: (result) => {
        if (!result || !result.confirm || !hasApi('openSetting')) return resolve(false)
        const recheck = (fromSetting) => readAuthSetting().then((latest) => {
          const auth = latest || fromSetting || {}
          resolve(Boolean(scope) && auth[scope] === true)
        })
        // 必须在用户点「去设置」的这次回调里同步调用，隔一个异步就不算用户点击了
        wx.openSetting({
          success: (setting) => recheck(setting && setting.authSetting),
          fail: () => recheck(null)
        })
      },
      fail: () => resolve(false)
    })
  })
}

/**
 * 用之前确认已授权：已授权直接通过；没问过就弹系统授权框；拒过（或刚拒绝）就弹窗引导去设置，回来再查一次。
 * 永不 reject，结果 true 表示可以往下走。
 */
async function ensureScope(scope, overrides) {
  const guide = guideText(scope, overrides)
  try {
    const auth = await readAuthSetting()
    const state = auth ? auth[scope] : undefined
    if (state === true) return true
    if (state !== false) {
      const result = await authorize(scope)
      if (result.ok) return true
      if (isPrivacyError(result.error)) {
        await showPrivacyNotice(result.error, guide)
        return false
      }
      // 刚在授权框里点了拒绝：接着引导去设置，和早就拒过的一样
    }
    return await guideToSetting(scope, guide)
  } catch (error) {
    return false
  }
}

/**
 * 接口失败后按原因处理：取消 → 静默；隐私协议 → 说明；系统没给微信权限 → 引导去系统设置；
 * 小程序权限被拒 → 引导去设置页。guides 可以是一项 { scope, title, content, name }，
 * 也可以是几项（如录像同时要摄像头和麦克风），按设置里先查到被拒的那项引导。
 * 返回 'cancel' | 'privacy' | 'system' | 'granted'（去设置后打开了）| 'denied' | 'other'（不是权限问题，调用方自己提示）。
 */
async function guideOnFailure(error, guides) {
  const list = (Array.isArray(guides) ? guides : [guides || {}]).map((item) => guideText(item && item.scope, item))
  const first = list[0] || guideText('', {})
  const kind = failureKind(error)
  if (kind === 'cancel') return 'cancel'
  if (kind === 'privacy') {
    await showPrivacyNotice(error, first)
    return 'privacy'
  }
  if (kind === 'system' && first.name) {
    await showSystemGuide(first)
    return 'system'
  }
  const scoped = list.filter((item) => item.scope)
  if (scoped.length) {
    const auth = await readAuthSetting()
    const denied = auth && scoped.find((item) => auth[item.scope] === false)
    if (denied) return (await guideToSetting(denied.scope, denied)) ? 'granted' : 'denied'
    if (kind !== 'denied') return 'other'
    // 报的是权限错误：设置里还有没打开的就去设置；都打开了，那就是手机系统没允许微信
    const missing = auth ? scoped.find((item) => auth[item.scope] !== true) : scoped[0]
    if (missing) return (await guideToSetting(missing.scope, missing)) ? 'granted' : 'denied'
    await showSystemGuide(scoped[0])
    return 'system'
  }
  // 没有对应小程序权限的接口（从相册选图等）报权限错误：只可能是手机系统没允许微信
  if (kind === 'denied' && first.name) {
    await showSystemGuide(first)
    return 'system'
  }
  return 'other'
}

module.exports = {
  ensureScope,
  guideOnFailure,
  isCancel,
  isPrivacyError,
  failureKind
}
