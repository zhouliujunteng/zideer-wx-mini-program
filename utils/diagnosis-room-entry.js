// 诊断室（pages/diagnosis-room，原 pages/agent-chat）只做老师的陪跑直播间（2026-09-29 用户规则）：
// 唯一的正常入口是老师发的预约邀请（learning/agent-invite → ?inviteToken=…）。
// 但页面注册在 app.json 里，任何人（包括审核）都能按路径直接打开，所以不带邀请打开时
// 一律只给「请从老师的邀请进入」，不给通用对话——对所有人一样，不区分是谁在看。
// `?mock=1` 演示时间线是开发者工具里调试用的，只在开发版放行。

function isDevelopVersion() {
  try {
    const accountInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return Boolean(accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion === 'develop')
  } catch (error) {
    return false
  }
}

function diagnosisRoomEntryAllowed(options = {}) {
  if (String((options && options.inviteToken) || '').trim()) return true
  return String((options && options.mock) || '') === '1' && isDevelopVersion()
}

module.exports = { diagnosisRoomEntryAllowed }
