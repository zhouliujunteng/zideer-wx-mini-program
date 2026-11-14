// 老师「待接单的诊断会议」的展示用文字（teacher/meeting-requests、老师工作台入口共用）。规则在课程服务 lib/agent-trial/meeting-dispatch.ts。
const { gradeName } = require('./grade-name')

// 等了多久 / 多久以前：「刚刚」「35 分钟」「3 小时」「2 天」
function sinceText(value, now = Date.now()) {
  const time = Date.parse(value || '')
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((now - time) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小时`
  return `${Math.floor(minutes / 1440)} 天`
}

function childrenText(children) {
  const list = (children || []).map((child) => [child.name, gradeName(child.grade)].filter(Boolean).join(' · '))
  return list.length ? list.join('、') : '还没有绑定孩子'
}

const STATE_TEXT = { open: '待接单', claimed: '已接单，待约会议', arranged: '已约好会议' }

function decorateRequest(item, now = Date.now()) {
  const since = sinceText(item.requestedAt, now)
  return {
    ...item,
    childrenText: childrenText(item.children),
    hasChild: (item.children || []).length > 0,
    agentText: item.agentName ? `代理 ${item.agentName}` : '',
    stateText: STATE_TEXT[item.state] || '',
    waitText: since ? (since === '刚刚' ? '刚刚申请' : `${since}前申请`) : ''
  }
}

module.exports = { sinceText, childrenText, decorateRequest }
