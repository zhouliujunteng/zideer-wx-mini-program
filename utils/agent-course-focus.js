/**
 * 对话里的课程链接 →「学习 › 我的课程」的交接。
 *
 * switchTab 不能带参数，所以点课程卡片时把要聚焦的课程写进 storage，学习页读到后消费一次：
 * 已经生成好的课直接进入学习，还在生成的课滚到「我的课程」并高亮显示生成进度。
 */
const STORAGE_KEY = 'agent-course-focus'
// 交接是一次点击的即时行为：超过 5 分钟的残留不再打扰用户。
const FOCUS_TTL_MS = 5 * 60 * 1000
const AGENT_COURSE_ID = /^stage-[A-Za-z0-9_-]{1,64}$/

function rememberAgentCourseFocus(stageId) {
  if (!AGENT_COURSE_ID.test(String(stageId || ''))) return false
  try {
    wx.setStorageSync(STORAGE_KEY, { stageId: String(stageId), at: Date.now() })
  } catch {
    return false
  }
  return true
}

/** 读取并清除待聚焦的课程；没有、已过期或数据损坏都返回空串。 */
function takeAgentCourseFocus() {
  let stored = null
  try {
    stored = wx.getStorageSync(STORAGE_KEY)
  } catch {
    return ''
  }
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch {
    // 清不掉也只会多聚焦一次，不影响正确性
  }
  if (!stored || !AGENT_COURSE_ID.test(String(stored.stageId || ''))) return ''
  return Date.now() - Number(stored.at || 0) <= FOCUS_TTL_MS ? String(stored.stageId) : ''
}

module.exports = { rememberAgentCourseFocus, takeAgentCourseFocus }
