// 教师智能体邀请分享页的展示计算。
// 视觉与 M40 会议准备页同一套（learning/live-session），数据来自「查询教师智能体邀请」e0238566：
// 该动作流只对被邀请的学生本人返回 ready，老师或家长打开都会拿到 not_your_invite，
// 所以这里把各种非 ready 状态也翻译成页面能直说的文案，而不是空白页。

const { clockLabel, dateLabel, countdownLabel, joinCountdownLabel, timestamp } = require('./live-session-view')

const HOUR = 60 * 60 * 1000

// 学生看到的老师名字一律带「老师」两个字：名字取老师自己的小程序昵称，
// 已经以「老师」结尾的（比如「王老师」）就不再加，避免出现「王老师老师」。
function teacherDisplayName(name) {
  const value = String(name || '').trim()
  if (!value) return '老师'
  return value.endsWith('老师') ? value : `${value}老师`
}

const STATUS_PRESETS = {
  'not-started': { statusLabel: '待上线', statusTone: 'muted' },
  upcoming: { statusLabel: '即将开始', statusTone: 'soon' },
  online: { statusLabel: '已上线', statusTone: 'active' },
  learning: { statusLabel: '学习中', statusTone: 'active' },
  canceled: { statusLabel: '已取消', statusTone: 'alert' },
  closed: { statusLabel: '已结束', statusTone: 'muted' }
}

// 非 ready 的返回值翻译成页面直接展示的说明；文案如实说明原因，不含糊成「加载失败」。
const BLOCKED_STATES = {
  not_found: { title: '没有找到这场预约', copy: '邀请链接可能已失效，或者老师取消了这次预约。' },
  // 一个学生同时只有最后发起的那条预约生效，旧链接一律打不开。
  superseded: { title: '这条预约已被新的安排取代', copy: '老师后来又约了一次，请打开最新的那条邀请。' },
  not_your_invite: { title: '这场预约不是给你的', copy: '邀请只能由被约的学生本人打开。如果你是老师，请在工作台查看这条预约。' },
  canceled: { title: '这场预约已取消', copy: '老师取消了这次诊断，可以先继续自主学习。' },
  closed: { title: '这场诊断已结束', copy: '这场诊断已经结束了，如需继续请让老师重新约一次。' },
  unauthenticated: { title: '请先登录', copy: '登录后才能查看老师给你的预约。' },
  not_initialized: { title: '请先完善学习档案', copy: '完善档案后再打开这个邀请。' },
  unavailable: { title: '预约暂时无法读取', copy: '请稍后重试，或让老师重新发一次分享。' }
}

function resolveState(payload, now) {
  const invite = payload.invite || {}
  const status = String(invite.status || '').toLowerCase()
  if (status === 'canceled') return 'canceled'
  // 已结束：能进去看记录，不能再发言
  if (payload.closed) return 'closed'
  // 学生已经进过一次（后端写入了会话 id 并把状态置为 active），再打开就是继续学习。
  if (status === 'active') return 'learning'
  const startAt = timestamp(invite.scheduledOnlineAt)
  if (startAt === null) return 'not-started'
  if (now >= startAt) return 'online'
  // 最后一小时内才算「即将开始」，整一小时仍按待上线显示天/小时级倒计时。
  return startAt - now < HOUR ? 'upcoming' : 'not-started'
}

function statusDescription(state, startAt, now) {
  switch (state) {
    case 'not-started':
      return startAt === null ? '上线时间待确认' : countdownLabel(startAt, now)
    case 'upcoming':
      return startAt === null ? '即将开始' : joinCountdownLabel(startAt, now)
    case 'online':
      return '老师约的时间到了，可以开始今天的学习'
    case 'learning':
      return '继续上次的学习'
    case 'closed':
      return '这场诊断已经结束，可以进去看看当时的记录'
    case 'canceled':
      return '老师取消了这次诊断'
    default:
      return ''
  }
}

// observer：绑定了这名学生的家长。能进同一间诊断室，但只能看——文案要说清楚，
// 免得家长以为自己能替孩子答话。写不进去这件事由后端保证，不靠这里的文案。
function buildAction(state, observer) {
  if (state === 'canceled') return { canEnter: false, label: '返回学习任务' }
  if (state === 'closed') return { canEnter: true, label: '查看会议记录' }
  if (observer) return { canEnter: true, label: state === 'learning' ? '继续旁听' : '旁听诊断室' }
  if (state === 'online') return { canEnter: true, label: '进入诊断室' }
  if (state === 'learning') return { canEnter: true, label: '回到诊断室' }
  // 没到点也能进诊断室：进去看到的是「等待老师上线」，可以打字但发不出去，到点自动上线。
  return { canEnter: true, label: '进入诊断室' }
}

function buildAgentInviteModel(payload, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const viewer = options.viewer || null
  const data = payload || {}

  if (data.status !== 'ready' || !data.invite) {
    const blocked = BLOCKED_STATES[String(data.status || 'unavailable')] || BLOCKED_STATES.unavailable
    return {
      blocked: true,
      state: String(data.status || 'unavailable'),
      stateTitle: blocked.title,
      // 后端给了具体原因就用它（比如「超过 30 分钟没有说话」），没有才用通用说明
      stateCopy: String(data.closedReason || '') || blocked.copy,
      closedReason: String(data.closedReason || '')
    }
  }

  const invite = data.invite
  const observer = String(data.viewer || 'student') === 'guardian'
  const state = resolveState(data, now)
  const preset = STATUS_PRESETS[state]
  const startAt = timestamp(invite.scheduledOnlineAt)
  const subject = invite.subject || '学科'
  // 老师到点即上线；学生已经进过诊断室（后端把状态置成 active）时同样算老师在线。
  const teacherOnline = ['online', 'learning'].includes(state)

  return {
    blocked: false,
    state,
    statusLabel: preset.statusLabel,
    statusTone: preset.statusTone,
    statusDescription: statusDescription(state, startAt, now),
    // 邀请没有结束时间，不做正计时，只在未到点时刷新倒计时文案。
    showTimer: false,
    statusTimer: '',
    ticking: ['not-started', 'upcoming'].includes(state),
    title: `${subject}专属诊断会议`,
    subtitle: '老师的专属诊断',
    teacher: {
      name: teacherDisplayName(invite.teacherName),
      roleLabel: `${subject}诊断老师`,
      avatarSrc: String(invite.teacherAvatarUrl || '')
    },
    schedule: {
      dateLabel: dateLabel(invite.scheduledOnlineAt, now),
      startTime: clockLabel(invite.scheduledOnlineAt) || '待定',
      subjectLabel: subject
    },
    // 参会者的上线状态：学生正在看这个页面，就是已上线；老师到了约定时间才算上线。
    participants: [
      {
        id: 'teacher',
        name: teacherDisplayName(invite.teacherName),
        roleLabel: '诊断老师',
        avatarSrc: String(invite.teacherAvatarUrl || ''),
        online: teacherOnline,
        statusLabel: teacherOnline ? '已上线' : '未上线'
      },
      {
        id: 'learner',
        name: (viewer && viewer.name) || '我',
        roleLabel: '学生本人',
        avatarSrc: (viewer && viewer.avatarUrl) || '',
        online: true,
        statusLabel: '已上线'
      }
    ],
    participantCountLabel: '共 2 位',
    action: buildAction(state, observer),
    observer,
    // 开始时间（毫秒）：「添加到日历」要用；没定时间时为 null，按钮自己会说明。
    startAt,
    // 订阅提醒、加日历只在还没开始时有意义；到点、学习中、已取消都不再给。
    showReminders: state === 'not-started' || state === 'upcoming',
    token: invite.token || '',
    sessionId: invite.sessionId || ''
  }
}

// 分享标题：【学生姓名】初二数学专属诊断会议，19:30开始
// 没有年级就省略年级段，没有时间就省略时间段，不用占位词拼一个假标题。
const GRADE_NUMERALS = ['一', '二', '三', '四', '五', '六']

function shortGradeLabel(grade) {
  const value = Number(grade)
  if (!Number.isInteger(value) || value < 1 || value > 12) return ''
  if (value <= 6) return `小${GRADE_NUMERALS[value - 1]}`
  if (value <= 9) return `初${GRADE_NUMERALS[value - 7]}`
  return `高${GRADE_NUMERALS[value - 10]}`
}

function buildInviteShareTitle({ studentName, grade, subject, scheduledOnlineAt }) {
  const name = String(studentName || '').trim() || '同学'
  const head = `${shortGradeLabel(grade)}${String(subject || '').trim()}`.trim()
  const startAt = timestamp(scheduledOnlineAt)
  const time = startAt === null ? '' : clockLabel(scheduledOnlineAt)
  const title = `【${name}】${head ? head : ''}专属诊断会议`
  return time ? `${title}，${time}开始` : title
}

// 分享卡片封面上的字（utils/share-cover.js 画，2026-10-04 用户要求打上学生名字）：
// 橙色一行「张小明同学」、大标题「专属诊断会议」、胶囊「初二数学 · 10月5日 周日 19:30」。
// 时间写具体日期不写「明天」：卡片可能隔几天才被点开。没有名字、年级、时间的就省掉那一段，不用占位词。
const INVITE_COVER_ICON = '/assets/help/share-meeting.png'
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function buildInviteCoverText({ studentName, grade, subject, scheduledOnlineAt }) {
  const name = String(studentName || '').trim()
  const head = `${shortGradeLabel(grade)}${String(subject || '').trim()}`
  const startAt = timestamp(scheduledOnlineAt)
  let when = ''
  if (startAt !== null) {
    const date = new Date(startAt)
    when = `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]} ${clockLabel(scheduledOnlineAt)}`
  }
  return {
    kicker: name ? (name.endsWith('同学') ? name : `${name}同学`) : '',
    title: '专属诊断会议',
    label: [head, when].filter(Boolean).join(' · ')
  }
}

function inviteCoverOptions(info) {
  return { iconKey: INVITE_COVER_ICON, text: buildInviteCoverText(info) }
}

// 学生进入对话时，AI 客服先把老师课前录的那段语音发过来：这里只产出消息数据，播放由页面控制。
// 没有录音就返回 null——不编一条「老师暂无语音」的假消息。
function buildInviteVoiceMessage(payload) {
  if (!payload || payload.status !== 'ready' || !payload.invite) return null
  const invite = payload.invite
  const url = String(invite.voiceUrl || '')
  if (!url) return null
  const seconds = Math.round(Number(invite.voiceDurationMs || 0) / 1000)
  return {
    id: 'invite-voice',
    role: 'assistant',
    kind: 'voice',
    label: `${teacherDisplayName(invite.teacherName)}的课前语音`,
    durationText: seconds > 0 ? `${seconds}″` : '',
    url,
    playing: false
  }
}

module.exports = { buildAgentInviteModel, resolveState, buildInviteShareTitle, buildInviteCoverText, inviteCoverOptions, shortGradeLabel, buildInviteVoiceMessage, teacherDisplayName }
