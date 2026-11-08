// 诊断室里的卡片写进会议记录（2026-10-06，更新日志 1.0.3「老师观看定制直播间的时候，同步学生端 UI」）。
//
// 学生在诊断室看到的「课程安排」卡片、选择题卡片，原来写进会议记录的只有一段纯文字（方案）或者干脆没写（选择题），
// 老师端直播间、旁听的家长看到的就是一大段字，或者只看到学生选完后发出的那句话，不知道老师问了什么。
//
// 会议记录只存文字（Zion「直播间记录」room.sync 一律按 text 存，最长 4000 字），所以这里不改后端：
// 一条记录 = 可读文字 + 分隔标记 + 卡片数据（JSON）。老师端、家长端认得标记就画成和学生端一样的卡片；
// 认不得（或者被截断、解析失败）就只显示前面那段可读文字，和原来一样。

const CARD_MARK = '\n⁣zl-card:'
const RECORD_MAX = 4000
const MAX_LESSONS = 12
const MAX_OPTIONS = 12

function text(value, max) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, max)
}

function planPayload(card) {
  return {
    kind: 'plan',
    label: text(card.label, 20),
    title: text(card.title, 80),
    countText: text(card.countText, 20),
    findings: text(card.findings, 240),
    lessons: (card.lessons || []).slice(0, MAX_LESSONS).map((lesson) => ({
      numberText: text(lesson.numberText, 12),
      title: text(lesson.title, 80),
      point: text(lesson.point, 80),
      outline: text(lesson.outline, 200),
      prerequisitesText: text(lesson.prerequisitesText, 120)
    }))
  }
}

function questionPayload(card) {
  return {
    kind: 'question',
    question: text(card.question, 400),
    multiSelect: card.multiSelect === true,
    options: (card.options || []).slice(0, MAX_OPTIONS).map((option) => ({ id: text(option.id, 60), label: text(option.label, 120) }))
  }
}

// 选择题卡片的可读文字（老师端认不出卡片时显示这段）
function questionRecordText(card) {
  const lines = [`【${card.multiSelect ? '多选题' : '提问'}】${text(card.question, 400)}`]
  for (const option of card.options || []) {
    const label = text(option.label, 120)
    if (label) lines.push(`· ${label}`)
  }
  return lines.join('\n')
}

/** 可读文字后面接上卡片数据；放不下 4000 字时只留可读文字（宁可退回原来的样子，也不能把数据截成半截）。 */
function encodeRoomCard(readable, card) {
  const base = text(readable, RECORD_MAX)
  if (!card || (card.kind !== 'plan' && card.kind !== 'question')) return base
  const json = JSON.stringify(card.kind === 'plan' ? planPayload(card) : questionPayload(card))
  const budget = RECORD_MAX - CARD_MARK.length - json.length
  if (budget < 1) return base
  return `${base.slice(0, budget)}${CARD_MARK}${json}`
}

function normalizePlan(value) {
  const lessons = (Array.isArray(value.lessons) ? value.lessons : [])
    .filter((lesson) => lesson && text(lesson.title, 80))
    .slice(0, MAX_LESSONS)
    .map((lesson, index) => ({
      key: `${index}`,
      numberText: text(lesson.numberText, 12) || `第${index + 1}节`,
      title: text(lesson.title, 80),
      point: text(lesson.point, 80),
      outline: text(lesson.outline, 200),
      prerequisitesText: text(lesson.prerequisitesText, 120)
    }))
  if (!lessons.length) return null
  return {
    kind: 'plan',
    label: text(value.label, 20) || '课程安排',
    title: text(value.title, 80) || '系列课程',
    countText: text(value.countText, 20) || `共 ${lessons.length} 节`,
    findings: text(value.findings, 240),
    lessons
  }
}

function normalizeQuestion(value) {
  const question = text(value.question, 400)
  if (!question) return null
  const options = (Array.isArray(value.options) ? value.options : [])
    .map((option, index) => ({ id: text(option && option.id, 60) || `option-${index}`, label: text(option && option.label, 120) }))
    .filter((option) => option.label)
    .slice(0, MAX_OPTIONS)
  return { kind: 'question', question, multiSelect: value.multiSelect === true, options }
}

/**
 * 拆开一条会议记录：{ text 可读文字, card 卡片或 null }。
 * 没有标记、数据被截断或格式不对，card 都是 null，text 是去掉标记后的文字。
 */
function decodeRoomCard(content) {
  const value = String(content || '')
  const at = value.indexOf(CARD_MARK)
  if (at < 0) return { text: value, card: null }
  const readable = value.slice(0, at)
  let data = null
  try { data = JSON.parse(value.slice(at + CARD_MARK.length)) } catch (error) { data = null }
  const card = !data || typeof data !== 'object' ? null
    : data.kind === 'plan' ? normalizePlan(data)
      : data.kind === 'question' ? normalizeQuestion(data)
        : null
  return { text: readable, card }
}

module.exports = { CARD_MARK, RECORD_MAX, encodeRoomCard, decodeRoomCard, questionRecordText }
