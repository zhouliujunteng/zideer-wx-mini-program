// 考试挑战（2026-11-17 用户要求，课程服务 lib/course/homework/challenge.ts）：互动练习通关后可选的一关，
// 对标学校考试中档题，不挡闯关。题型：选择题、填空题、分步解答（一道大题拆成几问，每问填一个结果）。
// 每道题最多答两次：第一次答错只给错因和提示、留在这道题；第二次再错给答案和解析，往下走。
// 全部做完按第一次答对的比例给星：完成 1 星，≥ 60% 2 星，全对 3 星。

const LETTERS = ['A', 'B', 'C', 'D']
const TYPE_LABELS = { single: '选择题', fill: '填空题', steps: '分步解答' }
const TYPE_HINTS = { single: '选出正确的一项', fill: '把空填上', steps: '一问一问算出来' }
const STATUSES = ['locked', 'open', 'preparing', 'ready', 'failed', 'done', 'unavailable']

const text = (value) => String(value === undefined || value === null ? '' : value)

function normalizeChallenge(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const questions = (Array.isArray(value.questions) ? value.questions : []).map((question) => ({
    type: TYPE_LABELS[question && question.type] ? question.type : 'single',
    prompt: text(question && question.prompt),
    point: text(question && question.point),
    options: (Array.isArray(question && question.options) ? question.options : []).map(text),
    steps: (Array.isArray(question && question.steps) ? question.steps : []).map(text)
  }))
  const p = value.progress && typeof value.progress === 'object' ? value.progress : null
  return {
    stageId: text(value.stageId),
    title: text(value.title) || '定制课程',
    status: STATUSES.includes(value.status) ? value.status : 'locked',
    questionCount: Number(value.questionCount) || questions.length,
    questions,
    progress: p ? { current: Number(p.current) || 0, tries: Number(p.tries) || 0, solved: Number(p.solved) || 0 } : null,
    review: Array.isArray(value.review) ? value.review : null,
    stars: Math.max(0, Math.min(3, Number(value.stars) || 0)),
    firstTryCount: value.firstTryCount === null || value.firstTryCount === undefined ? null : Number(value.firstTryCount)
  }
}

/** 一道题的空作答：选择题是字母、填空是文字、分步解答是每问一个文字。 */
function emptyChallengeAnswer(question) {
  if (!question) return null
  if (question.type === 'steps') return question.steps.map(() => '')
  return ''
}

function answerReady(question, answer) {
  if (!question) return false
  if (question.type === 'steps') return Array.isArray(answer) && answer.length === question.steps.length && answer.every((item) => text(item).trim())
  return !!text(answer).trim()
}

function challengeResponse(question, answer) {
  if (question && question.type === 'steps') return (Array.isArray(answer) ? answer : []).map((item) => text(item).trim())
  return text(answer).trim()
}

/**
 * 当前这一屏：{ index, number, total, type, typeLabel, hint, prompt, point, options, steps, fill, ready, locked, again }。
 * stepMarks：上一次答错时每一问对没对（分步解答，提示学生改哪一问）。
 */
function challengeScreen(challenge, answer, locked, stepMarks) {
  if (!challenge || challenge.status !== 'ready' || !challenge.progress) return null
  const index = challenge.progress.current
  const question = challenge.questions[index]
  if (!question) return null
  const marks = Array.isArray(stepMarks) ? stepMarks : []
  return {
    index,
    number: index + 1,
    total: challenge.questions.length,
    type: question.type,
    typeLabel: TYPE_LABELS[question.type],
    hint: TYPE_HINTS[question.type],
    prompt: question.prompt,
    point: question.point,
    options: question.options.map((label, i) => ({ letter: LETTERS[i], label, selected: answer === LETTERS[i] })),
    steps: question.steps.map((ask, i) => ({ i, ask, value: Array.isArray(answer) ? text(answer[i]) : '', mark: marks[i] === true ? 'right' : marks[i] === false ? 'wrong' : '' })),
    fill: typeof answer === 'string' ? answer : '',
    ready: answerReady(question, answer),
    locked: !!locked,
    again: challenge.progress.tries > 0
  }
}

/** 答完一道的反馈条。held：第一次答错，只给错因和提示，留在这道题再答一次。 */
function challengeFeedback(result) {
  if (!result) return null
  const held = !result.correct && result.held === true
  const steps = Array.isArray(result.steps) ? result.steps : []
  const stepNote = held && steps.length && steps.some(Boolean)
    ? `第 ${steps.map((ok, i) => (ok ? '' : i + 1)).filter(Boolean).join('、')} 问不对，其余是对的`
    : ''
  return {
    correct: !!result.correct,
    held,
    title: result.correct ? '答对了！' : held ? '不对哦，再想想' : '这道没拿下',
    why: result.correct ? '' : text(result.feedback),
    stepNote,
    hint: held ? text(result.hint) : '',
    answer: result.correct || held ? '' : text(result.answer),
    explanation: held ? '' : text(result.explanation),
    action: held ? '再试一次' : '继续'
  }
}

function challengePercent(challenge) {
  if (!challenge || !challenge.questionCount) return 0
  if (challenge.status === 'done') return 100
  const current = challenge.progress ? challenge.progress.current : 0
  return Math.round((current / challenge.questionCount) * 100)
}

/** 做完后的总结：几颗星、一次答对几道、拿下几道、每道题的答案与解析。 */
function challengeSummary(challenge) {
  if (!challenge || challenge.status !== 'done') return null
  const total = challenge.questionCount || challenge.questions.length
  const review = (challenge.review || []).map((item, index) => ({
    number: index + 1,
    prompt: challenge.questions[index] ? challenge.questions[index].prompt : '',
    point: challenge.questions[index] ? challenge.questions[index].point : '',
    answer: text(item && item.answer),
    explanation: text(item && item.explanation),
    firstTry: item ? item.firstTry : null,
    solved: item ? item.solved : null
  }))
  const first = challenge.firstTryCount === null ? review.filter((item) => item.firstTry === true).length : challenge.firstTryCount
  const solved = review.filter((item) => item.solved === true).length
  const stars = challenge.stars || 1
  return {
    total,
    first,
    solved,
    stars: [0, 1, 2].map((i) => i < stars),
    comment: stars === 3 ? '全部一次做对，学校考试这类题难不倒你！' : stars === 2 ? '大部分一次就做对了，错的看看解析。' : '这些题比课堂练习难不少，看看解析，下次再挑战。',
    review
  }
}

/** 互动练习刚通关时的邀请：recommended（一次答对率高）或开了挑战模式（mode，直接进）。 */
function challengeInvite(offer) {
  if (!offer || typeof offer !== 'object') return null
  if (offer.mode === true) return { auto: true, title: '考试挑战', copy: '挑战模式开着，直接进入学校考试难度的题。' }
  if (offer.recommended === true) return { auto: false, title: '挑战一下学校考试难度？', copy: '你这节课掌握得不错，来几道和学校考试一样难的题，不做也不影响往下学。' }
  return null
}

module.exports = {
  normalizeChallenge,
  emptyChallengeAnswer,
  challengeResponse,
  challengeScreen,
  challengeFeedback,
  challengePercent,
  challengeSummary,
  challengeInvite,
  TYPE_LABELS
}
