const test = require('node:test')
const assert = require('node:assert/strict')

const { buildAgentInviteModel, resolveState, buildInviteShareTitle, shortGradeLabel } = require('../services/agent-invite-view')

const NOW = new Date('2026-09-21T10:00:00+08:00').getTime()

function ready(invite = {}, extra = {}) {
  return {
    status: 'ready',
    online: false,
    serverNow: '2026-09-21T02:00:00Z',
    ...extra,
    invite: {
      inviteId: '5',
      token: 'tkdemo',
      subject: '数学',
      scheduledOnlineAt: '2026-09-21T11:00:00+08:00',
      status: 'scheduled',
      sessionId: '',
      teacherName: '王老师',
      ...invite
    }
  }
}

test('the invite page shows the teacher, subject and scheduled time it was created with', () => {
  const model = buildAgentInviteModel(ready(), { now: NOW, viewer: { name: '小鹿', avatarUrl: 'https://cdn.example.com/a.png' } })
  assert.equal(model.blocked, false)
  assert.equal(model.title, '数学专属诊断会议')
  assert.equal(model.teacher.name, '王老师')
  assert.equal(model.teacher.roleLabel, '数学诊断老师')
  assert.equal(model.schedule.dateLabel, '今天')
  assert.equal(model.schedule.startTime, '11:00')
  assert.equal(model.schedule.subjectLabel, '数学')
  assert.deepEqual(model.participants.map((item) => item.name), ['王老师', '小鹿'])
})

test('states follow the scheduled time and the invite status', () => {
  const at = (iso) => new Date(iso).getTime()
  assert.equal(resolveState(ready(), at('2026-09-20T10:00:00+08:00')), 'not-started')
  assert.equal(resolveState(ready(), at('2026-09-21T10:30:00+08:00')), 'upcoming')
  assert.equal(resolveState(ready(), at('2026-09-21T11:30:00+08:00')), 'online')
  assert.equal(resolveState(ready({ status: 'active' }), at('2026-09-21T10:00:00+08:00')), 'learning')
  assert.equal(resolveState(ready({ status: 'canceled' }), at('2026-09-21T11:30:00+08:00')), 'canceled')
})

test('the student can walk into the room early; the countdown says when the teacher comes online', () => {
  const before = buildAgentInviteModel(ready(), { now: NOW })
  // 没到点也能进——进去是「等待老师上线」，不是把学生挡在会议页外面。
  assert.equal(before.action.canEnter, true)
  assert.equal(before.action.label, '进入诊断室')
  assert.equal(before.statusLabel, '待上线')
  assert.equal(before.statusDescription, '还有 1 小时开始')

  const soon = buildAgentInviteModel(ready(), { now: new Date('2026-09-21T10:55:00+08:00').getTime() })
  assert.equal(soon.statusLabel, '即将开始')
  assert.equal(soon.statusDescription, '距离开始还有 05:00')
  assert.equal(soon.action.canEnter, true)
  assert.equal(soon.action.label, '进入诊断室')

  const online = buildAgentInviteModel(ready(), { now: new Date('2026-09-21T11:05:00+08:00').getTime() })
  assert.equal(online.action.canEnter, true)
  assert.equal(online.action.label, '进入诊断室')
  assert.equal(online.ticking, false)

  const learning = buildAgentInviteModel(ready({ status: 'active', sessionId: 'sess-1' }), { now: NOW })
  assert.equal(learning.action.label, '回到诊断室')
  assert.equal(learning.sessionId, 'sess-1')
})

test('a cancelled invite offers self-study instead of entering', () => {
  const model = buildAgentInviteModel(ready({ status: 'canceled' }), { now: NOW })
  assert.equal(model.statusLabel, '已取消')
  assert.equal(model.statusTone, 'alert')
  assert.equal(model.action.canEnter, false)
  assert.equal(model.action.label, '返回学习任务')
})

test('backend refusals are explained instead of shown as a blank page', () => {
  const notMine = buildAgentInviteModel({ status: 'not_your_invite' }, { now: NOW })
  assert.equal(notMine.blocked, true)
  assert.match(notMine.stateTitle, /不是给你的/)
  assert.match(notMine.stateCopy, /学生本人/)

  const superseded = buildAgentInviteModel({ status: 'superseded' }, { now: NOW })
  assert.equal(superseded.blocked, true)
  assert.match(superseded.stateTitle, /被新的安排取代/)
  assert.equal(buildAgentInviteModel({ status: 'not_found' }, { now: NOW }).blocked, true)
  assert.equal(buildAgentInviteModel({ status: 'unauthenticated' }, { now: NOW }).blocked, true)
  assert.equal(buildAgentInviteModel({ status: 'canceled' }, { now: NOW }).blocked, true)
  // 没见过的状态也要有兜底说明，不能返回 undefined 文案
  const unknown = buildAgentInviteModel({ status: 'weird_status' }, { now: NOW })
  assert.equal(unknown.blocked, true)
  assert.ok(unknown.stateTitle && unknown.stateCopy)
})

test('a missing scheduled time degrades to a waiting state', () => {
  const model = buildAgentInviteModel(ready({ scheduledOnlineAt: '' }), { now: NOW })
  assert.equal(model.state, 'not-started')
  assert.equal(model.schedule.dateLabel, '待确认')
  assert.equal(model.schedule.startTime, '待定')
  assert.equal(model.statusDescription, '上线时间待确认')
})

test('the share title leads with the student name, then grade, subject and start time', () => {
  assert.equal(
    buildInviteShareTitle({ studentName: '张三', grade: 8, subject: '数学', scheduledOnlineAt: '2026-09-22T19:30:00+08:00' }),
    '【张三】初二数学专属诊断会议，19:30开始'
  )
  assert.equal(shortGradeLabel(4), '小四')
  assert.equal(shortGradeLabel(7), '初一')
  assert.equal(shortGradeLabel(12), '高三')
  assert.equal(shortGradeLabel(0), '')
  assert.equal(shortGradeLabel(null), '')
})

test('the share title drops the parts the profile does not have instead of inventing them', () => {
  assert.equal(
    buildInviteShareTitle({ studentName: '李四', grade: null, subject: '英语', scheduledOnlineAt: '2026-09-22T19:30:00+08:00' }),
    '【李四】英语专属诊断会议，19:30开始'
  )
  assert.equal(
    buildInviteShareTitle({ studentName: '', grade: 8, subject: '数学', scheduledOnlineAt: '' }),
    '【同学】初二数学专属诊断会议'
  )
})

test('the AI assistant only forwards a voice the teacher actually recorded', () => {
  const { buildInviteVoiceMessage } = require('../services/agent-invite-view')
  const message = buildInviteVoiceMessage(ready({ voiceUrl: 'https://cdn.example.com/v.mp3', voiceDurationMs: 42000 }))
  assert.equal(message.kind, 'voice')
  assert.equal(message.role, 'assistant')
  assert.equal(message.label, '王老师的课前语音')
  assert.equal(message.durationText, '42″')
  assert.equal(message.url, 'https://cdn.example.com/v.mp3')
  assert.equal(message.playing, false)

  // 没录语音就没有这条消息，不编一条「暂无语音」占位
  assert.equal(buildInviteVoiceMessage(ready()), null)
  assert.equal(buildInviteVoiceMessage({ status: 'superseded' }), null)
  assert.equal(buildInviteVoiceMessage(null), null)
})

test('the teacher is always shown with 老师 after the name, and with their own avatar', () => {
  const { teacherDisplayName } = require('../services/agent-invite-view')
  // 老师自己的小程序昵称加后缀；已经带「老师」的不再重复
  assert.equal(teacherDisplayName('周流君騰'), '周流君騰老师')
  assert.equal(teacherDisplayName('王老师'), '王老师')
  assert.equal(teacherDisplayName('  李四  '), '李四老师')
  assert.equal(teacherDisplayName(''), '老师')
  assert.equal(teacherDisplayName(null), '老师')

  const model = buildAgentInviteModel(ready({ teacherName: '周流君騰', teacherAvatarUrl: 'https://cdn.example.com/t.jpg' }), { now: NOW })
  assert.equal(model.teacher.name, '周流君騰老师')
  assert.equal(model.teacher.avatarSrc, 'https://cdn.example.com/t.jpg')
  assert.equal(model.participants[0].name, '周流君騰老师')
  assert.equal(model.participants[0].avatarSrc, 'https://cdn.example.com/t.jpg')
  // 老师没设头像时退回占位，不显示破图
  assert.equal(buildAgentInviteModel(ready({ teacherName: '周流君騰' }), { now: NOW }).teacher.avatarSrc, '')

  const { buildInviteVoiceMessage: buildVoice } = require('../services/agent-invite-view')
  const voice = buildVoice(ready({ teacherName: '周流君騰', voiceUrl: 'https://cdn.example.com/v.mp3', voiceDurationMs: 8000 }))
  assert.equal(voice.label, '周流君騰老师的课前语音')
})

test('attendees show who is online: the student always, the teacher once the time has come', () => {
  const waiting = buildAgentInviteModel(ready(), { now: NOW, viewer: { name: '小鹿', avatarUrl: '' } })
  assert.equal(waiting.participants[0].online, false)
  assert.equal(waiting.participants[0].statusLabel, '未上线')
  // 学生正在看这个页面，他就是已上线
  assert.equal(waiting.participants[1].online, true)
  assert.equal(waiting.participants[1].statusLabel, '已上线')

  const online = buildAgentInviteModel(ready(), { now: new Date('2026-09-21T11:05:00+08:00').getTime() })
  assert.equal(online.participants[0].online, true)
  assert.equal(online.participants[0].statusLabel, '已上线')

  // 学生已经进过诊断室（后端把邀请置成 active）时，老师同样显示已上线
  const learning = buildAgentInviteModel(ready({ status: 'active' }), { now: NOW })
  assert.equal(learning.participants[0].statusLabel, '已上线')
})

test('an invite the backend closed explains itself with the real reason', () => {
  const closed = buildAgentInviteModel({
    status: 'closed',
    closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。',
    closedAt: '2026-09-22T20:00:00Z',
    invite: null
  }, { now: NOW })
  assert.equal(closed.blocked, true)
  assert.equal(closed.stateTitle, '这场诊断已结束')
  // 后端给了具体原因就用它，而不是一句笼统的说明
  assert.match(closed.stateCopy, /30 分钟/)

  // 没给原因时退回通用说明，不显示空白
  const bare = buildAgentInviteModel({ status: 'closed', invite: null }, { now: NOW })
  assert.match(bare.stateCopy, /重新约/)
})

test('a finished meeting can still be opened to look back; a cancelled one cannot', () => {
  for (const viewer of ['student', 'guardian']) {
    const closed = buildAgentInviteModel(ready({ status: 'closed' }, { viewer, closed: true, closedReason: '学生超过 30 分钟没有发言' }), { now: NOW })
    assert.equal(closed.blocked, false, viewer)
    assert.equal(closed.state, 'closed')
    assert.equal(closed.statusLabel, '已结束')
    assert.equal(closed.action.canEnter, true)
    assert.equal(closed.action.label, '查看会议记录')
    assert.equal(closed.showReminders, false, '结束了就不给订阅和加日历')
    assert.equal(closed.ticking, false)
  }
  const canceled = buildAgentInviteModel({ status: 'canceled' }, { now: NOW })
  assert.equal(canceled.blocked, true)
  assert.match(canceled.stateTitle, /已取消/)
})
