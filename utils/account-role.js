// 账号身份（学生 / 家长）的本地记录（2026-09-25 用户规则：家长底栏只有四项，没有「图谱」）。
// 底栏在页面挂载时就要决定画几项，等资料读回来再改会闪一下，所以每次读到学习档案都记一份。
// 只决定界面怎么显示；绑定学生、切换身份等权限以后端为准。
const STORAGE_KEY = 'zhilu_account_type'

function readAccountType() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    return value === 'guardian' || value === 'student' ? value : ''
  } catch (error) {
    return ''
  }
}

function isGuardianAccount() {
  return readAccountType() === 'guardian'
}

// 早期建档没记身份的账号按学生处理（与「身份与登录」一致）；还没有档案时不改动。
function rememberAccountType(profile) {
  if (!profile) return
  const type = profile.account_type === 'guardian' ? 'guardian' : 'student'
  try {
    if (wx.getStorageSync(STORAGE_KEY) !== type) wx.setStorageSync(STORAGE_KEY, type)
  } catch (error) {}
}

function clearAccountType() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
    wx.removeStorageSync(CHILDREN_KEY)
  } catch (error) {}
}

// 家长是否已绑定学生：「我的 → 常用入口」据此把「测评中心」换成「学生看板」（2026-09-25 用户规则）。
// 记一份是为了首屏就画对入口，不先闪「测评中心」；每次进「我的」都会按后端结果更新。
const CHILDREN_KEY = 'zhilu_guardian_has_children'

function readGuardianHasChildren() {
  try { return wx.getStorageSync(CHILDREN_KEY) === true } catch (error) { return false }
}

function rememberGuardianHasChildren(value) {
  try { wx.setStorageSync(CHILDREN_KEY, Boolean(value)) } catch (error) {}
}

module.exports = { readAccountType, isGuardianAccount, rememberAccountType, clearAccountType, readGuardianHasChildren, rememberGuardianHasChildren }
