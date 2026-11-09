const test = require('node:test')
const assert = require('node:assert/strict')

const { buildLiveRoomState, serverClockOffset, resolveIdleAction, SEND_BLOCKED_HINT } = require('../services/live-room-view')

function payload(overrides = {}, invite = {}) {
  return {
    status: 'ready',
    online: false,
    serverNow: '2026-09-22T11:00:00+08:00',
    ...overrides,
    invite: {
      inviteId: '5',
      token: 'tk1',
      subject: '数学',
      scheduledOnlineAt: '2026-09-22T19:00:00+08:00',
      status: 'scheduled',
      sessionId: '',
      teacherName: '王老师',
      voiceUrl: '',
      voiceDurationMs: 0,
      ...invite
    }
  }
}

const at = (iso) => new Date(iso).getTime()

test('before the scheduled time the room waits, and says who comes online when', () => {
  const room = buildLiveRoomState(payload(), { now: at('2026-09-22T18:48:00+08:00') })
  assert.equal(room.blocked, false)
  assert.equal(room.phase, 'waiting')
  assert.equal(room.title, '数学专属诊断会议')
  // 等待态只说会议，不点老师的名字（2026-10-04 用户要求）
  assert.equal(room.waitingTitle, '等待会议开始中')
  assert.ok(!/上线/.test(room.sendBlockedHint))
  assert.equal(room.waitingHint, '距离诊断会议开始还有 12:00')
  assert.ok(!/上线/.test(room.waitingHint))
  assert.equal(room.sendBlockedHint, SEND_BLOCKED_HINT)
  assert.equal(room.ticking, true)
})

test('an hour out the countdown stays coarse instead of ticking seconds', () => {
  const room = buildLiveRoomState(payload(), { now: at('2026-09-22T11:00:00+08:00') })
  assert.equal(room.waitingHint, '距离诊断会议开始还有 8 小时')
})

test('the teacher is online from the scheduled second onwards', () => {
  assert.equal(buildLiveRoomState(payload(), { now: at('2026-09-22T18:59:59+08:00') }).phase, 'waiting')
  const room = buildLiveRoomState(payload(), { now: at('2026-09-22T19:00:00+08:00') })
  assert.equal(room.phase, 'online')
  assert.equal(room.ticking, false)
  assert.equal(room.waitingHint, '')
  assert.equal(room.onlineNotice, '王老师已上线')
})

test('the room runs on server time so a wrong phone clock cannot bring the teacher on early', () => {
  // 手机比服务端快 20 分钟
  const fast = payload({ serverNow: '2026-09-22T18:40:00+08:00' })
  const offset = serverClockOffset(fast, at('2026-09-22T19:00:00+08:00'))
  assert.equal(offset, -20 * 60 * 1000)
  const now = at('2026-09-22T19:00:00+08:00') + offset
  assert.equal(buildLiveRoomState(fast, { now }).phase, 'waiting')
  // 拿不到服务端时间就退回本机时钟，不是把房间卡死
  assert.equal(serverClockOffset({ serverNow: '' }, Date.now()), 0)
})

test('a missing scheduled time keeps waiting and says so, instead of opening the room', () => {
  const room = buildLiveRoomState(payload({}, { scheduledOnlineAt: '' }), { now: at('2026-09-22T19:00:00+08:00') })
  assert.equal(room.phase, 'waiting')
  assert.match(room.waitingHint, /开始时间待确认/)
})

test('a refused invite is passed through with the same wording as the meeting page', () => {
  const room = buildLiveRoomState({ status: 'not_your_invite' }, { now: at('2026-09-22T19:00:00+08:00') })
  assert.equal(room.blocked, true)
  assert.equal(room.phase, 'blocked')
  assert.match(room.stateTitle, /不是给你的/)
  assert.equal(room.ticking, false)
})

test('an invite the student already entered carries its session back into the room', () => {
  const room = buildLiveRoomState(payload({}, { status: 'active', sessionId: 'sess-7' }), { now: at('2026-09-22T19:30:00+08:00') })
  assert.equal(room.phase, 'online')
  assert.equal(room.sessionId, 'sess-7')
})

test('the room shows the teacher with 老师 after the name and their own avatar', () => {
  const room = buildLiveRoomState(payload({}, { teacherName: '周流君騰', teacherAvatarUrl: 'https://cdn.example.com/t.jpg' }), { now: at('2026-09-22T18:48:00+08:00') })
  assert.equal(room.teacherName, '周流君騰老师')
  assert.equal(room.teacherAvatarUrl, 'https://cdn.example.com/t.jpg')
  assert.match(room.subtitle, /^周流君騰老师 · /)
  assert.equal(room.onlineNotice, '周流君騰老师已上线')
})

test('silence rules: two minutes gets a nudge, thirty minutes ends the session', () => {
  const now = at('2026-09-22T19:30:00+08:00')
  const minutes = (n) => now - n * 60 * 1000

  assert.equal(resolveIdleAction({ lastStudentAt: minutes(1), now }), 'none')
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(1.9), now }), 'none')
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(2), now }), 'prompt')
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(10), now }), 'prompt')
  // 同一轮沉默只催一次，不会每两分钟刷一遍
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(10), now, prompted: true }), 'none')
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(29.9), now, prompted: true }), 'none')
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(30), now, prompted: true }), 'close')
  // 已经关了就不再重复关
  assert.equal(resolveIdleAction({ lastStudentAt: minutes(45), now, closed: true }), 'none')
  // 时间读不出来时什么都不做，不能凭空关掉一场会议
  assert.equal(resolveIdleAction({ lastStudentAt: null, now }), 'none')
  assert.equal(resolveIdleAction({}), 'none')
})
