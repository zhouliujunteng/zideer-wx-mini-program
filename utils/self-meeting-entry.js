// 自助诊断会议（2026-11-17 用户规则）：管理端给孩子开通后，孩子不用等老师约时间，
// 点「开始诊断会议」就由课程服务按当前学习目标匹配学科、开一场（上一场没结束就接着进），直接进诊断室开始对话。
// 认不出学科时让孩子点一下选（微信的操作菜单最多 6 项：先给常用的 5 门，最后一项「其他学科」再列剩下的）。
const { startSelfMeeting } = require('../services/identity')

const COMMON = ['math', 'chi', 'eng', 'phy', 'chem']

function splitSubjects(subjects) {
  const list = Array.isArray(subjects) ? subjects.filter((item) => item && item.code && item.label) : []
  const first = COMMON.map((code) => list.find((item) => item.code === code)).filter(Boolean)
  const rest = list.filter((item) => !COMMON.includes(item.code))
  return { first, rest }
}

function pickFrom(items) {
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList: items.map((item) => item.label),
      success: (result) => resolve(items[result.tapIndex] || null),
      fail: () => resolve(null)
    })
  })
}

// 按学科代码选一门；取消返回空串
async function pickSubject(subjects) {
  const { first, rest } = splitSubjects(subjects)
  if (!first.length && !rest.length) return ''
  const more = { code: '__more', label: '其他学科' }
  const chosen = await pickFrom(rest.length ? first.concat(more) : first)
  if (!chosen) return ''
  if (chosen.code !== '__more') return chosen.code
  const second = await pickFrom(rest)
  return second ? second.code : ''
}

const FALLBACK_SUBJECTS = [
  { code: 'math', label: '数学' }, { code: 'chi', label: '语文' }, { code: 'eng', label: '英语' },
  { code: 'phy', label: '物理' }, { code: 'chem', label: '化学' }, { code: 'bio', label: '生物' },
  { code: 'sci', label: '科学' }, { code: 'pol', label: '道德与法治' }, { code: 'his', label: '历史' }, { code: 'geo', label: '地理' }
]

function roomUrl(token) {
  return `/pages/diagnosis-room/index?inviteToken=${encodeURIComponent(token)}`
}

/**
 * 开始（或接着进）自助诊断会议。page 用来防重复点（_selfMeetingBusy）。
 * 返回 'opened' / 'goal'（去设目标了）/ 'canceled' / 'failed'。
 */
async function openSelfMeeting(page) {
  if (page && page._selfMeetingBusy) return 'canceled'
  if (page) page._selfMeetingBusy = true
  const start = async (subject) => {
    wx.showLoading({ title: '正在请老师', mask: true })
    try {
      return await startSelfMeeting(subject)
    } finally {
      wx.hideLoading()
    }
  }
  try {
    let result
    try {
      result = await start('')
    } catch (error) {
      if (error && error.code === 'GOAL_REQUIRED') {
        wx.showToast({ title: error.message, icon: 'none' })
        wx.navigateTo({ url: '/learning/learning-goal/index?from=quest' })
        return 'goal'
      }
      if (!error || error.code !== 'SUBJECT_REQUIRED') throw error
      const subject = await pickSubject(FALLBACK_SUBJECTS)
      if (!subject) return 'canceled'
      result = await start(subject)
    }
    if (!result || !result.inviteToken) throw new Error('诊断会议暂时打不开，请稍后重试。')
    wx.navigateTo({ url: roomUrl(result.inviteToken) })
    return 'opened'
  } catch (error) {
    wx.showToast({ title: (error && error.message) || '诊断会议暂时打不开，请稍后重试。', icon: 'none' })
    return 'failed'
  } finally {
    if (page) page._selfMeetingBusy = false
  }
}

module.exports = { openSelfMeeting, splitSubjects, roomUrl }
