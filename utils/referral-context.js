// 登录与建档后去哪：没建档去建档页，其余一律回首页。
// 2026-11-10 起没有邀请码 / 推荐人线索了（改由爱心妈妈输入家长 ID 绑定家庭），这里只剩落地页规则。
function postAuthenticationUrl(user) {
  if (!user || !user.profileCompleted) return '/pages/profile-setup/index'
  return '/pages/home/index'
}

function postProfileUrl() {
  return '/pages/home/index'
}

module.exports = { postAuthenticationUrl, postProfileUrl }
