// 真人陪跑会议准备页（M40）的展示计算。
// 页面视觉取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 2d60b7b 的
// package-learning/pages/learning/live-session；设计稿是本地 mock，这里换成
// 「读取当前学生真人陪跑日程」61446a3a 返回的真实场次字段。
//
// 后端只提供 live_service_session（session_no / service_mode / status / scheduled_start /
// scheduled_end / capacity / meeting_provider / meeting_ref / actual_start / actual_end / teacher）
// 与本人的 live_session_participant，没有会议名称、课程名称、老师头像或同场其他学生，
// 因此这些位置用真实可得的信息填，不伪造设计稿里的 mock 文案。

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// 会议入口与旧版详情页保持同一口径：开始前 10 分钟开放，结束即关闭。
const JOIN_WINDOW_BEFORE_START = 10 * MINUTE

const STATUS_PRESETS = {
  'not-started': { statusLabel: '待开始', statusTone: 'muted', joinLabel: '会议尚未开始' },
  upcoming: { statusLabel: '即将开始', statusTone: 'soon', joinLabel: '进入会议' },
  'in-progress': { statusLabel: '进行中', statusTone: 'active', joinLabel: '进入会议' },
  ended: { statusLabel: '已结束', statusTone: 'muted', joinLabel: '会议已结束' },
  exception: { statusLabel: '会议异常', statusTone: 'alert', joinLabel: '返回学习任务' },
  unauthorized: { statusLabel: '无权限', statusTone: 'muted', joinLabel: '返回上一页' }
}

function timestamp(value) {
  // new Date(null) 是 1970 而不是 Invalid Date，空值必须先挡掉，
  // 否则没写 actual_start / scheduled_end 的场次会被算成早已结束。
  if (value === null || value === undefined || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function clockLabel(value) {
  const time = timestamp(value)
  if (time === null) return ''
  const date = new Date(time)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function dateLabel(value, now) {
  const time = timestamp(value)
  if (time === null) return '待确认'
  const date = new Date(time)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const offsetDays = Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - startOfToday) / DAY)
  if (offsetDays === 0) return '今天'
  if (offsetDays === 1) return '明天'
  if (offsetDays === -1) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function durationLabel(start, end) {
  const startAt = timestamp(start)
  const endAt = timestamp(end)
  if (startAt === null || endAt === null || endAt <= startAt) return '待确认'
  const minutes = Math.round((endAt - startAt) / MINUTE)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

// 进行中用「时:分:秒」展示真实已进行时长，与设计稿的大号计时位置一致。
function elapsedLabel(fromTime, now) {
  const elapsed = Math.max(0, now - fromTime)
  const seconds = Math.floor(elapsed / 1000)
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`
}

function countdownLabel(target, now) {
  const remain = Math.max(0, target - now)
  if (remain >= DAY) return `还有 ${Math.floor(remain / DAY)} 天开始`
  if (remain >= HOUR) return `还有 ${Math.floor(remain / HOUR)} 小时开始`
  if (remain >= MINUTE) return `还有 ${Math.floor(remain / MINUTE)} 分钟开始`
  return '即将开始'
}

function joinCountdownLabel(target, now) {
  const remain = Math.max(0, target - now)
  const seconds = Math.floor(remain / 1000)
  if (seconds >= HOUR / 1000) return `距离开始还有 ${Math.floor(seconds / 3600)} 小时`
  return `距离开始还有 ${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

function meetingLinkConfigured(session) {
  return /^https:\/\/[^\s]+$/i.test(String(session.meetingRef || ''))
}

function resolveState(participant, session, now) {
  const participantStatus = String(participant.status || '').toLowerCase()
  if (['cancelled', 'removed', 'withdrawn'].includes(participantStatus)) return 'unauthorized'

  const sessionStatus = String(session.status || '').toLowerCase()
  if (['cancelled', 'reassigned'].includes(sessionStatus)) return 'exception'
  if (sessionStatus === 'completed') return 'ended'
  if (sessionStatus === 'in_progress') return 'in-progress'

  const startAt = timestamp(session.scheduledStart)
  const endAt = timestamp(session.scheduledEnd)
  if (startAt === null || endAt === null) return 'exception'
  // 后端状态可能停留在 scheduled/confirmed，按时间兜底，不把过期场次显示成待开始。
  if (now > endAt) return 'ended'
  if (now >= startAt - JOIN_WINDOW_BEFORE_START) return now >= startAt ? 'in-progress' : 'upcoming'
  return 'not-started'
}

function statusDescription(state, session, now) {
  const startAt = timestamp(session.scheduledStart)
  switch (state) {
    case 'not-started':
      return startAt === null ? '会议时间待确认' : countdownLabel(startAt, now)
    case 'upcoming':
      return startAt === null ? '会议即将开始' : joinCountdownLabel(startAt, now)
    case 'ended':
      return '本场陪跑已结束'
    case 'exception':
      return String(session.status || '').toLowerCase() === 'reassigned' ? '本场已改派，请留意新的场次安排' : '本场已取消，可继续自主学习'
    case 'unauthorized':
      return '当前账号暂不能加入此会议'
    default:
      return ''
  }
}

function buildMeeting(state, session) {
  const preset = STATUS_PRESETS[state]
  const linkReady = meetingLinkConfigured(session)
  const joinable = ['upcoming', 'in-progress'].includes(state)
  if (joinable && !linkReady) {
    // 线上 live_service_session 目前没有写入 meeting_ref，如实说明而不是给一个点不动的「进入会议」。
    return { canJoin: false, joinLabel: '会议入口待配置', notice: '本场会议入口尚未配置，请等待老师或平台通知。', linkReady: false }
  }
  return {
    canJoin: joinable && linkReady,
    joinLabel: preset.joinLabel,
    linkReady,
    notice: joinable
      ? '会议由外部会议服务承载，本页只做会前确认。'
      : state === 'not-started'
        ? '会议在开始前 10 分钟开放。'
        : state === 'ended'
          ? '本场陪跑已结束，服务记录待后端开放后展示。'
          : state === 'exception'
            ? '会议暂不可进入，可返回每日学习任务继续自主学习。'
            : '当前账号暂不可查看这场会议。'
  }
}

function buildParticipants(session, viewer) {
  const teacher = session.teacher || null
  return [
    {
      id: 'teacher',
      name: teacher && teacher.displayName ? teacher.displayName : '老师待确认',
      roleLabel: '陪跑老师',
      // teacher_profile 没有头像字段，老师位保持设计稿的灰色占位圆。
      avatarSrc: ''
    },
    {
      id: 'learner',
      name: viewer && viewer.name ? viewer.name : '我',
      roleLabel: '学生本人',
      avatarSrc: viewer && viewer.avatarUrl ? viewer.avatarUrl : ''
    }
  ]
}

function participantCountLabel(session) {
  const capacity = Number(session.capacity)
  // 平行陪跑同场可能还有其他学生，但接口只返回本人，不谎称"共 N 位"。
  if (Number.isFinite(capacity) && capacity > 1) return `本场 ${capacity} 席 · 这里只显示你与老师`
  return '共 2 位'
}

function buildLiveSessionModel(participant, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const viewer = options.viewer || null
  const session = (participant && participant.session) || {}
  const state = resolveState(participant || {}, session, now)
  const preset = STATUS_PRESETS[state]
  const startAt = timestamp(session.scheduledStart)
  const timerFrom = timestamp(session.actualStart) === null ? startAt : timestamp(session.actualStart)

  return {
    state,
    statusLabel: preset.statusLabel,
    statusTone: preset.statusTone,
    statusDescription: statusDescription(state, session, now),
    statusTimer: state === 'in-progress' && timerFrom !== null ? elapsedLabel(timerFrom, now) : '',
    showTimer: state === 'in-progress' && timerFrom !== null,
    // 待开始、即将开始的说明与进行中的计时都随时间变化，页面按这个标记决定是否开秒级刷新。
    ticking: ['not-started', 'upcoming', 'in-progress'].includes(state),
    title: '真人陪跑会议',
    subtitle: session.sessionNo ? `场次 ${session.sessionNo}` : '真人陪跑',
    teacher: {
      name: session.teacher && session.teacher.displayName ? session.teacher.displayName : '老师待确认',
      roleLabel: session.serviceMode === 'parallel_coaching' ? '真人陪跑老师' : '真人服务老师'
    },
    schedule: {
      dateLabel: dateLabel(session.scheduledStart, now),
      startTime: clockLabel(session.scheduledStart) || '待定',
      endTime: clockLabel(session.scheduledEnd) || '待定',
      durationLabel: durationLabel(session.scheduledStart, session.scheduledEnd)
    },
    participants: buildParticipants(session, viewer),
    participantCountLabel: participantCountLabel(session),
    meeting: buildMeeting(state, session),
    attendanceLabel: Number(participant && participant.attendanceSeconds)
      ? `已出勤 ${Math.round(Number(participant.attendanceSeconds) / 60)} 分钟`
      : ''
  }
}

module.exports = {
  buildLiveSessionModel,
  // 导出供单测覆盖边界，以及供智能体邀请页复用同一套时间文案
  resolveState,
  elapsedLabel,
  durationLabel,
  dateLabel,
  clockLabel,
  countdownLabel,
  joinCountdownLabel,
  timestamp,
  JOIN_WINDOW_BEFORE_START
}
