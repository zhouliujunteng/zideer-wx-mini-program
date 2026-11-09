// 诊断室（对话页的会议模式）的展示计算。
//
// 和会议准备页 learning/agent-invite 的区别：准备页回答「这场预约是什么」，
// 诊断室回答「老师上线了没有」。学生到点前也能进来，进来看到的是等待态：
// 可以打字，但发不出去（老师还没上线），到点自动解锁。
//
// 时间一律以服务端返回的 serverNow 为准：学生手机时钟偏几分钟，
// 不应该让他提前或延后看到老师上线。

const { buildAgentInviteModel, teacherDisplayName } = require('./agent-invite-view')
const { clockLabel, timestamp } = require('./live-session-view')

const HOUR = 60 * 60 * 1000
const DAY_MS = 24 * HOUR
// 等待态的说法一律是「会议开始」，不点老师的名字（2026-10-04 用户要求）
const SEND_BLOCKED_HINT = '会议还没开始，开始后就能发消息'
// 学生沉默满 2 分钟，老师主动问一句；满 30 分钟这场就自动结束。
// 两个阈值都从「学生最后一次说话」起算，老师说了什么不影响计时。
const IDLE_PROMPT_MS = 2 * 60 * 1000
const AUTO_CLOSE_MS = 30 * 60 * 1000
const IDLE_PROMPT_TEXT = '你好，同学，还在吗？'
const AUTO_CLOSE_REASON = '你超过 30 分钟没有说话，这场诊断已经自动结束了。'
// 对话流里的收场提示，和开场的「X老师已上线」一对：一短句，具体原因放在下面那张卡里。
const CLOSED_NOTICE = '会议已结束'
const AUTO_CLOSE_RECORD = '【会议结束】学生超过 30 分钟没有发言，诊断会议自动关闭。'
// 学生确认课程安排、老师开始建课的那一刻：老师说这一句就收场，学生不用在这页等课做完。
// 固定话术，不走模型（模型要先想一阵才开口，学生就得干等）。
const HANDOFF_TEXT = '好，那就按这个安排。你的课程我来帮你梳理，做好了会放在「学习 › 我的课程」里，你稍后去那儿看就行。今天就先到这儿，辛苦啦～'
const HANDOFF_CLOSE_REASON = '课程安排已经定好，老师正在为你准备。稍后到「学习 › 我的课程」里查看就行。'
const CLOSED_SEND_HINT = '这场诊断已结束，如需继续请让老师重新约一次'
// 学生在诊断室里面对的是老师本人：输入区下方不能出现「内容由AI生成」这类系统说明。
// 「老师会看到你发的每一句话」也去掉了（2026-10-04 用户要求）：会议进行中输入区下方不放说明，模板里空串不渲染。
const COMPOSER_NOTE = ''
// 家长旁听：看得到全程，但发不了言。这条后端也是强制的，不靠前端自觉。
const OBSERVER_HINT = '家长旁听中，这里由孩子和老师对话'

/**
 * 服务端时间与本机时间的差值（毫秒）。读取邀请时调用一次，之后用
 * `Date.now() + offset` 当作「现在」。拿不到 serverNow 就返回 0（退回本机时钟）。
 */
function serverClockOffset(payload, receivedAt) {
  const server = timestamp(payload && payload.serverNow)
  if (server === null) return 0
  const local = Number.isFinite(receivedAt) ? receivedAt : Date.now()
  return server - local
}

// 等待卡片上那行橙字：只说离开始还有多久（2026-09-24 用户要求）。上面的标题是「等待会议开始中」。
function waitingHint(teacherName, startAt, now) {
  if (startAt === null) return '诊断会议开始时间待确认'
  const remain = Math.max(0, startAt - now)
  const pad = (value) => String(value).padStart(2, '0')
  if (remain >= DAY_MS) return `距离诊断会议开始还有 ${Math.floor(remain / DAY_MS)} 天`
  if (remain >= HOUR) return `距离诊断会议开始还有 ${Math.floor(remain / HOUR)} 小时`
  const seconds = Math.floor(remain / 1000)
  return `距离诊断会议开始还有 ${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

/**
 * @param {object} payload loadTeacherAgentInvite 的返回值
 * @param {object} options { now }：已经加过 serverClockOffset 的时间戳
 */
function buildLiveRoomState(payload, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const model = buildAgentInviteModel(payload, { now })
  if (model.blocked) {
    return { blocked: true, phase: 'blocked', stateTitle: model.stateTitle, stateCopy: model.stateCopy, ticking: false }
  }

  const invite = payload.invite
  const observer = String(payload.viewer || 'student') === 'guardian'
  // 学生看到的老师名字一律带「老师」两个字，头像取老师本人的小程序头像。
  const teacherName = teacherDisplayName(invite.teacherName)
  const teacherAvatarUrl = String(invite.teacherAvatarUrl || '')
  const subject = String(invite.subject || '').trim()
  const startAt = timestamp(invite.scheduledOnlineAt)
  // 已结束：只读的历史记录。和时间无关——哪怕手机时钟还没到点，结束了就是结束了。
  const closed = Boolean(payload.closed)
  const online = closed || (startAt !== null && now >= startAt)

  return {
    blocked: false,
    phase: closed ? 'closed' : online ? 'online' : 'waiting',
    closedReason: closed ? String(payload.closedReason || '') : '',
    token: String(invite.token || ''),
    sessionId: String(invite.sessionId || ''),
    subject,
    teacherName,
    teacherAvatarUrl,
    startAt,
    startTimeLabel: clockLabel(invite.scheduledOnlineAt) || '待定',
    title: subject ? `${subject}专属诊断会议` : '专属诊断会议',
    // 顶栏副标题：等待时说几点上线，上线后说是谁在带
    subtitle: online ? `${teacherName} · 已上线` : `${teacherName} · ${clockLabel(invite.scheduledOnlineAt) || '时间待定'} 上线`,
    // 不点老师的名字（2026-10-04 用户要求）
    waitingTitle: '等待会议开始中',
    waitingHint: online ? '' : waitingHint(teacherName, startAt, now),
    onlineNotice: `${teacherName}已上线`,
    // 收场那句灰色小提示，和上面的「已上线」一对；模板里固定跟在最后一条消息后面
    closedNotice: CLOSED_NOTICE,
    observer,
    sendBlockedHint: closed ? CLOSED_SEND_HINT : observer ? OBSERVER_HINT : SEND_BLOCKED_HINT,
    composerNote: closed ? CLOSED_SEND_HINT : observer ? OBSERVER_HINT : COMPOSER_NOTE,
    ticking: !online
  }
}

/**
 * 学生静默到什么程度了。
 * @param {object} params lastStudentAt 学生最后一次说话的时间戳（进入诊断室也算一次），
 *                        now 服务端校准过的现在，prompted 是否已经催问过，closed 是否已经关闭。
 * @returns {'none'|'prompt'|'close'} prompt = 老师问一句「还在吗」，close = 这场自动结束。
 */
function resolveIdleAction({ lastStudentAt, now, prompted, closed } = {}) {
  if (closed) return 'none'
  // Number(null) 是 0 而不是 NaN：空值必须先挡掉，否则会被算成「沉默了几十年」直接关掉会议。
  if (lastStudentAt === null || lastStudentAt === undefined || lastStudentAt === '') return 'none'
  if (now === null || now === undefined || now === '') return 'none'
  const last = Number(lastStudentAt)
  const at = Number(now)
  if (!Number.isFinite(last) || !Number.isFinite(at) || last <= 0 || at <= 0) return 'none'
  const idle = at - last
  if (idle >= AUTO_CLOSE_MS) return 'close'
  // 催问只在同一轮沉默里发一次：学生一说话就重置，不会每两分钟刷一遍屏。
  if (idle >= IDLE_PROMPT_MS && !prompted) return 'prompt'
  return 'none'
}

module.exports = {
  CLOSED_NOTICE,
  OBSERVER_HINT,
  buildLiveRoomState,
  serverClockOffset,
  resolveIdleAction,
  SEND_BLOCKED_HINT,
  COMPOSER_NOTE,
  IDLE_PROMPT_MS,
  AUTO_CLOSE_MS,
  IDLE_PROMPT_TEXT,
  AUTO_CLOSE_REASON,
  AUTO_CLOSE_RECORD,
  HANDOFF_TEXT,
  HANDOFF_CLOSE_REASON,
  CLOSED_SEND_HINT
}
