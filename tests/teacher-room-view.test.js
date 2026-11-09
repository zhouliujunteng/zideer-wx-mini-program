const test = require('node:test')
const assert = require('node:assert/strict')

const { buildTeacherRoomMessages, buildRoomSummary, buildTeacherRoom, closedRecordReason, blockedState } = require('../services/teacher-room-view')

const ROWS = [
  { id: '1', sender: 'teacher', kind: 'voice', content: '课前语音', readAt: '2026-09-22T19:01:00+08:00', createdAt: '2026-09-22T19:00:05+08:00' },
  { id: '2', sender: 'ai', kind: 'text', content: '小鹿，我看了你的数学摸底。', readAt: '2026-09-22T19:01:10+08:00', createdAt: '2026-09-22T19:01:10+08:00' },
  { id: '3', sender: 'student', kind: 'text', content: '二次函数', readAt: '', createdAt: '2026-09-22T19:02:00+08:00' },
  { id: '4', sender: 'teacher', kind: 'text', content: '先别急着算', readAt: '', createdAt: '2026-09-22T19:03:00+08:00' }
]

test('laid out the way the student sees it: the teacher side on the left, the student on the right', () => {
  const view = buildTeacherRoomMessages(ROWS)
  assert.deepEqual(view.map((item) => item.side), ['left', 'left', 'right', 'left'])
})

test('the teacher can still tell his own lines from the ones the AI said for him', () => {
  const view = buildTeacherRoomMessages(ROWS)
  assert.deepEqual(view.map((item) => item.tag), ['课前语音', 'AI 代答', undefined, '我发的'])
  assert.deepEqual(view.map((item) => item.tone), ['voice', 'ai', undefined, 'teacher'])
})

test('read state is shown on the teacher side only, and says both states out loud', () => {
  const view = buildTeacherRoomMessages(ROWS)
  assert.deepEqual(view.map((item) => item.readLabel), ['已听', '已读', '', '未读'])
  assert.equal(view[3].read, false)
  assert.equal(view[2].read, null, '学生自己说的话不存在「老师已读」这回事')
})

test('the voice row is a playable voice bar with its length, not the words 课前语音 typed out', () => {
  const view = buildTeacherRoomMessages(ROWS, { durationText: '42″' })
  assert.equal(view[0].kind, 'voice')
  assert.equal(view[0].durationText, '42″')
  assert.equal(view[0].text, undefined)
  assert.equal(view[0].timeLabel, '19:00')
  assert.equal(view[1].kind, 'text')
  const unplayed = buildTeacherRoomMessages([{ ...ROWS[0], readAt: '' }])
  assert.equal(unplayed[0].readLabel, '未听', '语音以学生点开播放为准')
})

test('the auto-close line becomes the closing card, not a bubble the AI said', () => {
  const rows = ROWS.concat([{ id: '5', sender: 'ai', kind: 'text', content: '【会议结束】学生超过 30 分钟没有发言，诊断会议自动关闭。', readAt: '', createdAt: '2026-09-22T19:40:00+08:00' }])
  assert.equal(buildTeacherRoomMessages(rows).length, 4)
  assert.equal(closedRecordReason(rows), '学生超过 30 分钟没有发言，诊断会议自动关闭。')
  const room = buildTeacherRoom({ subject: '数学', status: 'closed', closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。' }, { rows })
  assert.equal(room.phase, 'closed')
  assert.match(room.closedReason, /^学生超过 30 分钟/, '老师这边不用写给学生的「你超过……」')
  assert.equal(room.composerNote, '这场诊断已结束，不能再发言')
  assert.ok(buildTeacherRoom({ status: 'closed' }, { rows: [] }).closedReason, '没有记录行时也要说明结束了')
})

test('the room reads like the student\'s: same title, teacher name with 老师, online once the time has come', () => {
  const invite = { subject: '数学', teacherName: '王建国', teacherAvatarUrl: 'https://cdn/a.png', scheduledOnlineAt: '2026-09-22T19:00:00+08:00', status: 'scheduled', voiceUrl: 'https://cdn/v.mp3', voiceDurationMs: 41600 }
  const before = buildTeacherRoom(invite, { now: Date.parse('2026-09-22T18:30:00+08:00') })
  assert.equal(before.title, '数学专属诊断会议')
  assert.equal(before.teacherName, '王建国老师')
  assert.equal(before.onlineNotice, '王建国老师已上线')
  assert.equal(before.phase, 'waiting')
  assert.match(before.standbyHint, /19:00 开始/)
  assert.equal(before.voiceDurationText, '42″')
  const after = buildTeacherRoom(invite, { now: Date.parse('2026-09-22T19:00:01+08:00') })
  assert.equal(after.phase, 'online')
  assert.equal(after.standbyTitle, '学生还没进入诊断室')
  // 旧版后端没带头像、名字时也画得出来
  const bare = buildTeacherRoom({ subject: '' })
  assert.equal(bare.title, '专属诊断会议')
  assert.equal(bare.teacherName, '老师')
  assert.equal(bare.voiceUrl, '')
})

test('the summary says whether anything is still unseen', () => {
  const view = buildTeacherRoomMessages(ROWS)
  assert.equal(buildRoomSummary(view), '共 4 条 · 有 1 条学生还没看到')
  assert.equal(buildRoomSummary(buildTeacherRoomMessages(ROWS.slice(0, 3))), '共 3 条 · 学生已全部读到')
  assert.equal(buildRoomSummary([]), '学生还没有进入直播间')
})

test('a backend refusal is explained, including the one that means the flow is not deployed yet', () => {
  assert.match(blockedState('not_deployed').copy, /deploy-live-room\.mjs/)
  assert.match(blockedState('not_your_invite').title, /不是你发起的/)
  assert.match(blockedState('student_not_bound').title, /解绑/)
  assert.match(blockedState('room_closed').title, /已结束/)
  // 没见过的状态也要有兜底文案
  assert.ok(blockedState('weird').title && blockedState('weird').copy)
})
