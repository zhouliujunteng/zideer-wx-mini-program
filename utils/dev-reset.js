// 「重置测试账号」的本机开关（2026-09-28 用户规则）：在兑换码页输入开启码、后端核对通过后才打开，
// 没开过的手机不显示按钮；打开后这台手机上登录的任何账号都能用（后端不再按账号白名单）。
// 开启码只在后端「开发安全重开」动作流里核对，小程序包里没有它：这里只记住用户输入过、后端认过的那串码，
// 每次重置带给后端再核一遍——后端换了开启码，旧码就失效，按钮随之消失。
const STORAGE_KEY = 'zhilu_dev_reset_code'
const listeners = []

function readDevResetCode() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    return typeof value === 'string' ? value : ''
  } catch (error) {
    return ''
  }
}

function notify() {
  for (const listener of listeners.slice()) {
    try { listener() } catch (error) {}
  }
}

function rememberDevResetCode(code) {
  try { wx.setStorageSync(STORAGE_KEY, String(code || '')) } catch (error) {}
  notify()
}

function forgetDevResetCode() {
  try { wx.removeStorageSync(STORAGE_KEY) } catch (error) {}
  notify()
}

// 按钮组件订阅：在兑换码页刚开启时，同一页上的按钮不用等下次 onShow 就出现。返回取消订阅的函数。
function onDevResetChange(listener) {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

module.exports = { readDevResetCode, rememberDevResetCode, forgetDevResetCode, onDevResetChange }
