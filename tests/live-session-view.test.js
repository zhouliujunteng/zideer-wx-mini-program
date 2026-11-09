const test = require('node:test')
const assert = require('node:assert/strict')

const { buildLiveSessionModel, resolveState, durationLabel, dateLabel, elapsedLabel } = require('../services/live-session-view')

const NOW = new Date('2026-09-21T10:00:00+08:00').getTime()

function participant(sessionOverrides = {}, overrides = {}) {
  return {
    id: '31',
    status: 'confirmed',
    attendanceSeconds: 0,
    ...overrides,
    session: {
      id: '7',
      sessionNo: 'LS-20260921-02',
      serviceMode: 'parallel_coaching',
      status: 'confirmed',
      scheduledStart: '2026-09-21T11:00:00+08:00',
      scheduledEnd: '2026-09-21T11:40:00+08:00',
      capacity: 1,
      meetingProvider: '',
      meetingRef: '',
      actualStart: null,
      actualEnd: null,
      teacher: { id: '3', displayName: '王老师', status: 'active' },
      ...sessionOverrides
    }
  }
}

test('schedule facts come from the real session fields', () => {
  const model = buildLiveSessionModel(participant(), { now: NOW, viewer: { name: '小鹿', avatarUrl: 'https://cdn.example.com/a.png' } })
  assert.equal(model.title, '真人陪跑会议')
  assert.equal(model.subtitle, '场次 LS-20260921-02')
  assert.equal(model.teacher.name, '王老师')
  assert.equal(model.teacher.roleLabel, '真人陪跑老师')
  assert.equal(model.schedule.dateLabel, '今天')
  assert.equal(model.schedule.startTime, '11:00')
  assert.equal(model.schedule.endTime, '11:40')
  assert.equal(model.schedule.durationLabel, '40 分钟')
  assert.deepEqual(model.participants.map((item) => item.name), ['王老师', '小鹿'])
  assert.equal(model.participants[0].avatarSrc, '')
  assert.equal(model.participants[1].avatarSrc, 'https://cdn.example.com/a.png')
})

test('states follow backend status first and scheduled time as fallback', () => {
  const at = (iso) => new Date(iso).getTime()
  assert.equal(resolveState(participant(), participant().session, at('2026-09-21T09:00:00+08:00')), 'not-started')
  assert.equal(resolveState(participant(), participant().session, at('2026-09-21T10:55:00+08:00')), 'upcoming')
  assert.equal(resolveState(participant(), participant().session, at('2026-09-21T11:20:00+08:00')), 'in-progress')
  // 后端状态没跟上时，结束时间之后不再显示成待开始。
  assert.equal(resolveState(participant(), participant().session, at('2026-09-21T13:00:00+08:00')), 'ended')
  assert.equal(resolveState(participant(), participant({ status: 'completed' }).session, NOW), 'ended')
  assert.equal(resolveState(participant(), participant({ status: 'in_progress' }).session, NOW), 'in-progress')
  assert.equal(resolveState(participant(), participant({ status: 'cancelled' }).session, NOW), 'exception')
  assert.equal(resolveState(participant(), participant({ status: 'reassigned' }).session, NOW), 'exception')
  assert.equal(resolveState({ status: 'cancelled' }, participant().session, NOW), 'unauthorized')
})

test('countdown copy is computed from the real start time', () => {
  const soon = buildLiveSessionModel(participant(), { now: new Date('2026-09-21T10:55:00+08:00').getTime() })
  assert.equal(soon.statusLabel, '即将开始')
  assert.equal(soon.statusTone, 'soon')
  assert.equal(soon.statusDescription, '距离开始还有 05:00')

  const later = buildLiveSessionModel(participant(), { now: new Date('2026-09-21T08:30:00+08:00').getTime() })
  assert.equal(later.statusLabel, '待开始')
  assert.equal(later.statusDescription, '还有 2 小时开始')

  const tomorrow = buildLiveSessionModel(participant(), { now: new Date('2026-09-20T08:30:00+08:00').getTime() })
  assert.equal(tomorrow.statusDescription, '还有 1 天开始')
  assert.equal(tomorrow.schedule.dateLabel, '明天')
})

test('in-progress shows elapsed time from the actual start when the backend has one', () => {
  const withActual = buildLiveSessionModel(
    participant({ status: 'in_progress', actualStart: '2026-09-21T11:02:00+08:00' }),
    { now: new Date('2026-09-21T11:12:30+08:00').getTime() }
  )
  assert.equal(withActual.showTimer, true)
  assert.equal(withActual.statusTimer, '00:10:30')
  assert.equal(withActual.statusTone, 'active')

  const withoutActual = buildLiveSessionModel(
    participant({ status: 'in_progress' }),
    { now: new Date('2026-09-21T11:05:00+08:00').getTime() }
  )
  assert.equal(withoutActual.statusTimer, '00:05:00')
})

test('joining needs both an open window and a configured meeting link', () => {
  const noLink = buildLiveSessionModel(participant(), { now: new Date('2026-09-21T11:20:00+08:00').getTime() })
  assert.equal(noLink.meeting.canJoin, false)
  assert.equal(noLink.meeting.joinLabel, '会议入口待配置')

  const withLink = buildLiveSessionModel(
    participant({ meetingRef: 'https://meeting.example.com/s/abc' }),
    { now: new Date('2026-09-21T11:20:00+08:00').getTime() }
  )
  assert.equal(withLink.meeting.canJoin, true)
  assert.equal(withLink.meeting.joinLabel, '进入会议')

  const beforeWindow = buildLiveSessionModel(
    participant({ meetingRef: 'https://meeting.example.com/s/abc' }),
    { now: new Date('2026-09-21T09:00:00+08:00').getTime() }
  )
  assert.equal(beforeWindow.meeting.canJoin, false)
  assert.equal(beforeWindow.meeting.joinLabel, '会议尚未开始')

  const ended = buildLiveSessionModel(
    participant({ status: 'completed', meetingRef: 'https://meeting.example.com/s/abc' }),
    { now: NOW }
  )
  assert.equal(ended.meeting.canJoin, false)
  assert.equal(ended.meeting.joinLabel, '会议已结束')
})

test('seat copy never claims to list students the backend did not return', () => {
  const single = buildLiveSessionModel(participant(), { now: NOW })
  assert.equal(single.participantCountLabel, '共 2 位')
  const shared = buildLiveSessionModel(participant({ capacity: 4 }), { now: NOW })
  assert.equal(shared.participantCountLabel, '本场 4 席 · 这里只显示你与老师')
  assert.equal(shared.participants.length, 2)
})

test('missing or malformed times degrade instead of throwing', () => {
  const model = buildLiveSessionModel(participant({ scheduledStart: null, scheduledEnd: null }), { now: NOW })
  assert.equal(model.state, 'exception')
  assert.equal(model.schedule.dateLabel, '待确认')
  assert.equal(model.schedule.startTime, '待定')
  assert.equal(model.schedule.durationLabel, '待确认')
  assert.equal(durationLabel('2026-09-21T09:00:00+08:00', '2026-09-21T11:30:00+08:00'), '2 小时 30 分钟')
  assert.equal(dateLabel('2026-09-19T09:00:00+08:00', NOW), '9月19日')
  assert.equal(elapsedLabel(NOW - 3661000, NOW), '01:01:01')
})

test('teacher name falls back when the session has no teacher record', () => {
  const model = buildLiveSessionModel(participant({ teacher: null, serviceMode: 'other' }), { now: NOW })
  assert.equal(model.teacher.name, '老师待确认')
  assert.equal(model.teacher.roleLabel, '真人服务老师')
  assert.equal(model.participants[0].name, '老师待确认')
})
