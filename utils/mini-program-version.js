// 小程序版本号，取微信给的：正式版是上传时填的版本号；开发版、体验版微信不给版本号，只标出是哪一版。
// 读不到（旧基础库）返回空字符串，页面就不显示这一行。
function miniProgramVersionText() {
  const accountInfo = typeof wx !== 'undefined' && wx.getAccountInfoSync && wx.getAccountInfoSync()
  const miniProgram = (accountInfo && accountInfo.miniProgram) || {}
  if (miniProgram.envVersion === 'develop') return '开发版'
  if (miniProgram.envVersion === 'trial') return '体验版'
  return miniProgram.version ? `版本 ${miniProgram.version}` : ''
}

module.exports = { miniProgramVersionText }
