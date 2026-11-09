// 老师端「直播间记录」的展示计算。纯函数，便于单测。
//
// 版式照学生在诊断室里看到的那一屏（pages/diagnosis-room 的会议模式）画：
// 老师方向的话（老师亲手打的、AI 代他说的、课前语音）在左边，上面带老师头像和名字；
// 学生说的在右边。老师看到的就是学生屏幕上的样子。
//
// 学生那边分不出哪句是 AI 替老师说的；老师这边必须分得清，所以名字旁多一个标签（我发的 / AI 代答 / 课前语音），
// 气泡下面的已读也是真的——学生已读只对老师方向的消息有意义，语音以学生点开播放为准。

const { clockLabel, timestamp } = require('./live-session-view')
const { teacherDisplayName } = require('./agent-invite-view')
const { decodeRoomCard } = require('../utils/room-card-record')

// 自动结束时学生端写进会议记录的那一行：不当成老师说的话，改画成结尾的「会议已结束」
const CLOSED_RECORD_PREFIX = '【会议结束】'
const CLOSED_NOTICE = '会议已结束'
const CLOSED_FALLBACK_REASON = '这场诊断已经结束。'
const CLOSED_COMPOSER_NOTE = '这场诊断已结束，不能再发言'
const COMPOSER_NOTE = '学生那边显示成老师发的，分不出是你还是 AI'

const SENDER_TAGS = {
  teacher: { tag: '我发的', tone: 'teacher' },
  ai: { tag: 'AI 代答', tone: 'ai' }
}

const BLOCKED_STATES = {
  not_deployed: { title: '直播间记录还没部署', copy: '跑一次 scripts/mp-teacher/deploy-live-room.mjs，这里就能看到学生和 AI 的对话。' },
  not_teacher: { title: '没有教师权限', copy: '当前账号不是启用中的老师。' },
  not_your_invite: { title: '这场会议不是你发起的', copy: '只有发起预约的老师能看这场会议。' },
  student_not_bound: { title: '学生已解绑', copy: '这名学生不在你名下了，看不到这场会议。' },
  not_found: { title: '没有找到这场会议', copy: '预约可能已被删除。' },
  room_closed: { title: '会议已结束', copy: '这场诊断已经结束，不能再发言。' },
  unauthenticated: { title: '请先登录', copy: '登录后才能查看。' },
  unavailable: { title: '暂时读不到', copy: '请稍后重试。' }
}

function isClosedRecord(row) {
  return String((row && row.content) || '').indexOf(CLOSED_RECORD_PREFIX) === 0
}

function voiceDurationText(durationMs) {
  const seconds = Math.round(Number(durationMs || 0) / 1000)
  return seconds > 0 ? `${seconds}″` : ''
}

function messageView(row, voice) {
  const timeLabel = clockLabel(row.createdAt)
  if (row.sender === 'student') {
    return { id: row.id, side: 'right', kind: 'text', text: row.content, timeLabel, readLabel: '', read: null }
  }
  // 课前语音：学生点开播放才算听过
  if (row.kind === 'voice') {
    return {
      id: row.id,
      side: 'left',
      kind: 'voice',
      tag: '课前语音',
      tone: 'voice',
      durationText: (voice && voice.durationText) || '',
      timeLabel,
      readLabel: row.readAt ? '已听' : '未听',
      read: Boolean(row.readAt),
      playing: false
    }
  }
  const sender = SENDER_TAGS[row.sender] || SENDER_TAGS.ai
  // 学生诊断室里的卡片（课程安排、选择题，utils/room-card-record.js）：老师看到的和学生屏幕上一样是卡片，不是一大段字。
  // 选择题只读，选项全列出来；学生选了什么看下一条学生的话。
  const { text, card } = decodeRoomCard(row.content)
  if (card) {
    return {
      id: row.id,
      side: 'left',
      ...card,
      ...(card.kind === 'question' ? { options: card.options.map((option) => ({ ...option, key: option.id })) } : {}),
      tag: sender.tag,
      tone: sender.tone,
      timeLabel,
      readLabel: row.readAt ? '已读' : '未读',
      read: Boolean(row.readAt)
    }
  }
  return {
    id: row.id,
    side: 'left',
    kind: 'text',
    tag: sender.tag,
    tone: sender.tone,
    text,
    timeLabel,
    readLabel: row.readAt ? '已读' : '未读',
    read: Boolean(row.readAt)
  }
}

/** @param voice { durationText }：课前语音的时长（来自邀请，记录行本身不带） */
function buildTeacherRoomMessages(rows, voice) {
  return (rows || []).filter((row) => !isClosedRecord(row)).map((row) => messageView(row, voice))
}

// 学生超时自动结束时写进记录的原因（「【会议结束】学生超过 30 分钟没有发言……」），给结尾的卡片用。
// 邀请上存的 closedReason 是写给学生看的（「你超过 30 分钟没有说话……」），老师这边不用它。
function closedRecordReason(rows) {
  const row = (rows || []).filter(isClosedRecord).pop()
  return row ? String(row.content).slice(CLOSED_RECORD_PREFIX.length).trim() : ''
}

function blockedState(status) {
  return BLOCKED_STATES[String(status || 'unavailable')] || BLOCKED_STATES.unavailable
}

// 顶栏下面那行：学生读到哪了
function buildRoomSummary(messages) {
  const mine = (messages || []).filter((item) => item.side === 'left')
  const unread = mine.filter((item) => item.read === false).length
  if (!messages || !messages.length) return '学生还没有进入直播间'
  if (!mine.length) return `共 ${messages.length} 条`
  return unread ? `共 ${messages.length} 条 · 有 ${unread} 条学生还没看到` : `共 ${messages.length} 条 · 学生已全部读到`
}

/**
 * 房间本身：标题、老师头像与名字、开没开始、结束没有。和学生诊断室同一套说法（「数学专属诊断会议」「王老师已上线」）。
 * @param invite room.watch 返回的 invite（头像、名字、语音只在从头读时才有，调用方负责保留上一次的值）
 * @param options { now, rows }：now 是服务端时间，rows 是到目前为止的全部记录
 */
function buildTeacherRoom(invite, options = {}) {
  const data = invite || {}
  const subject = String(data.subject || '').trim()
  const teacherName = teacherDisplayName(data.teacherName)
  const startAt = timestamp(data.scheduledOnlineAt)
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const closed = data.status === 'closed'
  const started = closed || (startAt !== null && now >= startAt)
  const startLabel = clockLabel(data.scheduledOnlineAt)
  return {
    subject,
    title: subject ? `${subject}专属诊断会议` : '专属诊断会议',
    teacherName,
    teacherAvatarUrl: String(data.teacherAvatarUrl || ''),
    voiceUrl: String(data.voiceUrl || ''),
    voiceDurationText: voiceDurationText(data.voiceDurationMs),
    phase: closed ? 'closed' : started ? 'online' : 'waiting',
    onlineNotice: `${teacherName}已上线`,
    closedNotice: CLOSED_NOTICE,
    closedReason: closed ? (closedRecordReason(options.rows) || CLOSED_FALLBACK_REASON) : '',
    // 还没人说话时那张等待卡片
    standbyTitle: started ? '学生还没进入诊断室' : '诊断会议还没开始',
    standbyHint: started
      ? '学生进来后，这里会实时显示对话'
      : (startLabel ? `约好 ${startLabel} 开始，到点后学生进来就能看到对话` : '开始时间待确认'),
    composerNote: closed ? CLOSED_COMPOSER_NOTE : COMPOSER_NOTE
  }
}

module.exports = {
  buildTeacherRoomMessages,
  buildRoomSummary,
  buildTeacherRoom,
  closedRecordReason,
  blockedState,
  SENDER_TAGS,
  COMPOSER_NOTE,
  CLOSED_COMPOSER_NOTE
}
