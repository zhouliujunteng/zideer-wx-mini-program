// 游客浏览与未完善学习资料（2026-09-27 用户规则）：按微信小程序平台规则，未登录也能浏览小程序，
// 用到要登录的功能时再去登录；已登录、还没完善学习资料的，用到要学习资料的功能时再去完善。
// 页面的访问状态（access）：guest 未登录；profile 已登录、学习资料未完善；ready 正常。
//
// 登录页、建档页都用 navigateTo 打开：登录、建档完成后回到原页面（见 pages/login、pages/profile-setup），
// 不想登录、不想填也能直接返回接着看。
function openLogin() {
  wx.navigateTo({ url: '/pages/login/login' })
}

function openProfileSetup() {
  wx.navigateTo({ url: '/pages/profile-setup/index' })
}

// 提示卡上的按钮：游客先登录（登录后没建档会接着去建档），已登录的去完善学习资料。
function openAccessStep(access) {
  if (access === 'guest') return openLogin()
  if (access === 'profile') return openProfileSetup()
}

// 已登录没建档时点了要学习资料的功能：先说明为什么，再去完善。
function promptProfileRequired(content = '完善学习资料后就能使用这项功能。') {
  wx.showModal({
    title: '请先完善学习资料',
    content,
    confirmText: '去完善',
    cancelText: '暂不',
    success(result) {
      if (result && result.confirm) openProfileSetup()
    }
  })
}

// 没登录、没建档时点了要登录 / 要学习资料的功能，就地拦下并带去对应一步；返回 true 表示已拦下。
function guardAccess(access, profileContent) {
  if (access === 'guest') { openLogin(); return true }
  if (access === 'profile') { promptProfileRequired(profileContent); return true }
  return false
}

module.exports = { openLogin, openProfileSetup, openAccessStep, promptProfileRequired, guardAccess }
