// 陪跑直播间的消息通道（学生端 / 老师端共用一条动作流「陪跑直播间」）。
//
// 三个操作：
//   room.sync   学生端一次往返做完「上报自己和 AI 说的话 + 标已读 + 取老师的新消息」
//   room.watch  老师端读这场会议的完整记录（含学生已读）
//   room.say    老师端在学生的对话里插一句话
//
// 动作流 id 没填时一律返回 not_deployed：直播间照常上课，只是没有已读、老师也插不了话。
// 这比抛错好——课不能因为一个附加能力没部署就上不了。

const config = require('../config/index')
const { invokeActionFlow, parseActionFlowResult } = require('./identity')

const NOT_DEPLOYED = { status: 'not_deployed', messages: [], lastId: '', serverNow: '' }

function isConfigured() {
  const flow = config.ACTION_FLOWS.LIVE_ROOM_SERVICE
  return Boolean(flow && flow.id)
}

function normalize(payload) {
  const data = payload || {}
  return {
    status: String(data.status || 'unavailable'),
    serverNow: String(data.serverNow || ''),
    viewer: String(data.viewer || ''),
    // 这场会议是不是已经结束：结束状态存在邀请上，换设备打开也是同一个结论
    closed: Boolean(data.closed),
    closedReason: String(data.closedReason || ''),
    closedAt: String(data.closedAt || ''),
    invite: data.invite || null,
    lastId: String(data.lastId || ''),
    messages: (data.messages || []).map((item) => ({
      id: String(item.id || ''),
      sender: String(item.sender || ''),
      kind: String(item.kind || 'text'),
      content: String(item.content || ''),
      clientKey: String(item.clientKey || ''),
      readAt: String(item.readAt || ''),
      createdAt: item.createdAt || ''
    }))
  }
}

async function call(payload) {
  if (!isConfigured()) return NOT_DEPLOYED
  const result = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.LIVE_ROOM_SERVICE, { payload }))
  return normalize(result)
}

/** 学生端。append 里只允许 student / ai；老师方向的消息后端不收。 */
function syncStudentRoom({ token, since, append, readIds }) {
  return call({
    operation: 'room.sync',
    token: String(token || ''),
    since: String(since || '0'),
    append: Array.isArray(append) ? append : [],
    readIds: Array.isArray(readIds) ? readIds : []
  })
}

/** 学生端：这场因为静默超时自动结束。幂等，重复调用不会覆盖最初的原因。 */
function closeStudentRoom({ token, reason, since }) {
  return call({
    operation: 'room.close',
    token: String(token || ''),
    reason: String(reason || ''),
    since: String(since || '0')
  })
}

/** 老师端：看这场会议的全部记录。 */
function watchTeacherRoom({ inviteId, since }) {
  return call({ operation: 'room.watch', inviteId: String(inviteId || ''), since: String(since || '0') })
}

/** 老师端：插一句话。学生那边显示成老师发的。 */
function sayAsTeacher({ inviteId, text, clientKey, since }) {
  return call({
    operation: 'room.say',
    inviteId: String(inviteId || ''),
    text: String(text || ''),
    clientKey: String(clientKey || ''),
    since: String(since || '0')
  })
}

module.exports = { isConfigured, syncStudentRoom, closeStudentRoom, watchTeacherRoom, sayAsTeacher }
