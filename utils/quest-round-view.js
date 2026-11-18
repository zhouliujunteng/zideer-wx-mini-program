// 续学（课程服务 lib/course/quest-round，2026-11-18）：一个目标的课全闯完以后，阶段复测 → 系统出下一轮方案 → 确认 → 后台制作。
// 这里把 /api/learn/quest-round 的详情整理成确认页（learning/quest-round）的模型，纯函数。

const STATUSES = ['testing', 'planning', 'proposed', 'building', 'blocked', 'built', 'achieved', 'failed']
const text = (value) => String(value === undefined || value === null ? '' : value)
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

function normalizeRound(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const proposal = value.proposal && typeof value.proposal === 'object'
    ? {
        title: text(value.proposal.title) || '下一轮课程',
        summary: text(value.proposal.summary),
        lessons: (Array.isArray(value.proposal.lessons) ? value.proposal.lessons : []).map((lesson, index) => ({
          index: index + 1,
          title: text(lesson && lesson.title) || `第${index + 1}节`,
          focus: text(lesson && lesson.focus),
          built: !!(lesson && lesson.built)
        }))
      }
    : null
  const credits = value.credits && typeof value.credits === 'object'
    ? {
        available: Number(value.credits.available) || 0,
        perLesson: Array.isArray(value.credits.perLesson) ? value.credits.perLesson.map(Number) : null,
        total: Array.isArray(value.credits.total) ? value.credits.total.map(Number) : null
      }
    : null
  const checkpoint = value.checkpoint && typeof value.checkpoint === 'object'
    ? { resolved: list(value.checkpoint.resolved), still: list(value.checkpoint.still), fresh: list(value.checkpoint.fresh) }
    : null
  return {
    id: Number(value.id) || 0,
    roundNo: Number(value.roundNo) || 2,
    status: STATUSES.includes(value.status) ? value.status : 'planning',
    diagnosisId: Number(value.diagnosisId) || 0,
    diagnosisStatus: text(value.diagnosisStatus),
    checkpoint,
    proposal,
    credits,
    blocked: value.blocked && value.blocked.message ? { code: text(value.blocked.code), message: text(value.blocked.message) } : null
  }
}

/** 复测和上次比的三组（空的不显示）。 */
function checkpointRows(checkpoint) {
  if (!checkpoint) return []
  return [
    { key: 'resolved', title: '已经补好', tone: 'good', items: checkpoint.resolved },
    { key: 'still', title: '还要再补一补', tone: 'warn', items: checkpoint.still },
    { key: 'fresh', title: '新发现的卡点', tone: 'warn', items: checkpoint.fresh }
  ].filter((row) => row.items.length)
}

/** 积分说明：只是预估，按每节真实用量扣。 */
function creditsLine(credits, lessons) {
  if (!credits) return ''
  const balance = `家庭现有 ${credits.available} 积分`
  if (credits.perLesson && credits.total && lessons)
    return `每节大约 ${credits.perLesson[0]}–${credits.perLesson[1]} 积分，${lessons} 节约 ${credits.total[0]}–${credits.total[1]} 积分（只是预估，按每节实际制作用量扣）。${balance}。`
  return `每节按实际制作用量扣积分。${balance}。`
}

/** 页面上的状态说明与按钮。 */
function roundStage(round) {
  switch (round.status) {
    case 'testing':
      return { title: '阶段复测还没做完', copy: '先把复测做完，系统才能按结果排下一轮课。', action: 'test', button: '去做复测', waiting: false }
    case 'planning':
      return { title: '正在排下一轮课程', copy: '按你的目标和复测结果排课，一般一两分钟。', action: '', button: '', waiting: true }
    case 'proposed':
      return { title: '下一轮课程排好了', copy: '看看每节课补什么，确认后就开始制作，做好了会出现在学习页的路径上。', action: 'confirm', button: '就按这个安排，开始制作', waiting: false }
    case 'building':
      return { title: '课程正在制作', copy: '一节一节在做，做好了会接在学习页的路径后面。', action: '', button: '', waiting: true }
    case 'blocked':
      return { title: '课程暂时做不了', copy: (round.blocked && round.blocked.message) || '稍后点一下接着制作。', action: 'retry', button: '接着制作', waiting: false }
    case 'failed':
      return { title: '刚才没排好', copy: '点一下重新排。', action: 'retry', button: '重新排', waiting: false }
    case 'built':
      return { title: '下一轮课程都在制作了', copy: '做好的课会陆续出现在学习页的路径上。', action: 'home', button: '回学习页', waiting: false }
    case 'achieved':
      return { title: '这个目标达成了', copy: '复测下来这个目标的知识点都掌握了，可以定一个新目标接着学。', action: 'goal', button: '定一个新目标', waiting: false }
    default:
      return { title: '', copy: '', action: '', button: '', waiting: false }
  }
}

/** 确认 / 重试失败时的提示：没开会员、积分不够要带去会员中心。 */
function confirmError(error) {
  const code = error && error.code
  if (code === 'MEMBERSHIP_REQUIRED') return { message: '开通会员后才能制作下一轮课程，方案会帮你留着。', membership: true }
  if (code === 'CREDITS_SHORT') return { message: '家庭积分不够制作下一轮课程了，续费后再来确认，方案会帮你留着。', membership: true }
  return { message: (error && error.message) || '没有确认成功，请再点一次。', membership: false }
}

module.exports = { normalizeRound, checkpointRows, creditsLine, roundStage, confirmError }
