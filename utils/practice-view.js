// 互动练习（闯关学习第二关，2026-11-11）的纯函数：整理接口数据、拼当前这道题的画面、把作答拼成提交格式。
// 课程服务 lib/course/homework/practice.ts：题型 single / judge / fill / order / match，
// 下发的题面不带答案；order 交「按先后排好的条目下标」，match 交「左边每一项配的右边下标」。

const LETTERS = ['A', 'B', 'C', 'D']
const TYPE_LABELS = { single: '选择题', judge: '判断题', fill: '填空题', order: '排序题', match: '配对题' }
const TYPE_HINTS = {
  single: '选出正确的一项',
  judge: '这句话说得对吗？',
  fill: '把空里的内容填上',
  order: '按正确的顺序依次点一遍',
  match: '先点左边，再点右边，把它们连起来'
}
const STATUSES = ['locked', 'preparing', 'ready', 'failed', 'done']

function normalizePractice(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const status = STATUSES.includes(value.status) ? value.status : 'locked'
  const questions = (Array.isArray(value.questions) ? value.questions : []).map((question) => ({
    type: TYPE_LABELS[question && question.type] ? question.type : 'single',
    prompt: String(question && question.prompt || ''),
    options: (Array.isArray(question && question.options) ? question.options : []).map((option) => String(option || '')),
    left: (Array.isArray(question && question.left) ? question.left : []).map((item) => String(item || ''))
  }))
  const progress = value.progress && typeof value.progress === 'object' ? {
    current: Number.isInteger(value.progress.current) ? value.progress.current : null,
    remaining: Number(value.progress.remaining) || 0,
    cleared: Number(value.progress.cleared) || 0,
    streak: Number(value.progress.streak) || 0,
    bestStreak: Number(value.progress.bestStreak) || 0,
    answered: Number(value.progress.answered) || 0,
    // 当前这道之前答错过（又轮到它）
    retry: value.progress.retry === true
  } : null
  return {
    stageId: String(value.stageId || ''),
    title: String(value.title || '定制课程'),
    kind: value.kind === 'homework' ? 'homework' : 'practice',
    status,
    questionCount: Number(value.questionCount) || questions.length,
    questions,
    progress,
    review: Array.isArray(value.review) ? value.review : null,
    correctCount: value.correctCount === null || value.correctCount === undefined ? null : Number(value.correctCount)
  }
}

/** 空的作答（每道题换题时重置）。 */
function emptyAnswer(question) {
  if (!question) return null
  if (question.type === 'fill') return ''
  if (question.type === 'order') return []
  if (question.type === 'match') return { pairs: question.left.map(() => null), picked: null }
  return ''
}

/** 作答是否完整（「检查」按钮可点）。 */
function answerReady(question, answer) {
  if (!question) return false
  if (question.type === 'fill') return String(answer || '').trim().length > 0
  if (question.type === 'order') return Array.isArray(answer) && answer.length === question.options.length
  if (question.type === 'match') return !!answer && answer.pairs.every((value) => value !== null)
  return !!answer
}

/** 提交给课程服务的作答。 */
function responseOf(question, answer) {
  if (question.type === 'fill') return String(answer || '').trim()
  if (question.type === 'order') return answer.slice()
  if (question.type === 'match') return answer.pairs.slice()
  return String(answer || '')
}

// 配对题每一对的颜色（左右同色），最多 4 对
const PAIR_TONES = ['orange', 'blue', 'violet', 'teal']

/** 当前这道题的画面。 */
function questionScreen(practice, answer, locked) {
  const progress = practice && practice.progress
  if (!practice || !progress || progress.current === null) return null
  const index = progress.current
  const question = practice.questions[index]
  if (!question) return null
  const screen = {
    index,
    type: question.type,
    typeLabel: TYPE_LABELS[question.type],
    hint: TYPE_HINTS[question.type],
    prompt: question.prompt,
    options: [],
    picked: [],
    pool: [],
    left: [],
    right: [],
    fill: question.type === 'fill' ? String(answer || '') : '',
    ready: answerReady(question, answer),
    locked: !!locked
  }
  if (question.type === 'single' || question.type === 'judge') {
    screen.options = question.options.map((label, i) => ({ letter: LETTERS[i], label, selected: answer === LETTERS[i] }))
  } else if (question.type === 'order') {
    const chosen = Array.isArray(answer) ? answer : []
    screen.picked = chosen.map((optionIndex, position) => ({ optionIndex, position, number: position + 1, label: question.options[optionIndex] }))
    screen.pool = question.options.map((label, optionIndex) => ({ optionIndex, label, used: chosen.includes(optionIndex) }))
  } else if (question.type === 'match') {
    const pairs = answer && answer.pairs || question.left.map(() => null)
    const picked = answer ? answer.picked : null
    screen.left = question.left.map((label, i) => ({
      i,
      label,
      tone: pairs[i] === null ? '' : PAIR_TONES[i % PAIR_TONES.length],
      active: picked === i
    }))
    screen.right = question.options.map((label, j) => {
      const owner = pairs.indexOf(j)
      return { j, label, tone: owner === -1 ? '' : PAIR_TONES[owner % PAIR_TONES.length] }
    })
  }
  return screen
}

/** 点了排序题的一个条目：没用过就排到后面；点已排的就拿掉。 */
function toggleOrder(answer, optionIndex) {
  const list = Array.isArray(answer) ? answer.slice() : []
  const at = list.indexOf(optionIndex)
  if (at >= 0) list.splice(at, 1)
  else list.push(optionIndex)
  return list
}

/** 配对题：点左边选中（再点一次取消已配的这对）；选中左边后点右边，连成一对（右边原来的那对拆开）。 */
function tapMatch(answer, side, index) {
  const pairs = answer.pairs.slice()
  if (side === 'left') {
    if (pairs[index] !== null && answer.picked !== index) {
      pairs[index] = null
      return { pairs, picked: index }
    }
    return { pairs, picked: answer.picked === index ? null : index }
  }
  if (answer.picked === null) {
    // 先点了右边：如果它已经配过，拆开
    const owner = pairs.indexOf(index)
    if (owner >= 0) pairs[owner] = null
    return { pairs, picked: null }
  }
  const owner = pairs.indexOf(index)
  if (owner >= 0) pairs[owner] = null
  pairs[answer.picked] = index
  const next = pairs.indexOf(null)
  return { pairs, picked: next >= 0 ? next : null }
}

/** 答完一道之后的反馈条。 */
/**
 * 答题结果 → 底部反馈条。第一次答错（held）不给答案：只说错在哪（why）、给个提示（hint），题目放到后面再做；
 * 再答错才给答案和解析（2026-11-12 错项针对性反馈，网页端 lib/portal/practice-view.ts 同一套）。
 */
function feedbackOf(result) {
  if (!result) return null
  const streak = result.practice && result.practice.progress ? result.practice.progress.streak : 0
  const held = !result.correct && result.held === true
  return {
    correct: !!result.correct,
    title: result.correct ? (streak >= 3 ? `太棒了！连对 ${streak} 道` : '答对了！') : held ? '不对哦，再想想' : '再想想',
    answer: result.correct ? '' : String(result.answer || ''),
    explanation: String(result.explanation || ''),
    why: result.correct ? '' : String(result.feedback || ''),
    hint: held ? String(result.hint || '') : '',
    retryHint: result.correct ? '' : held ? '这道题放到后面，等会儿再做一次' : '这道题会放到后面再考你一次'
  }
}

/** 通关页的数字。 */
function clearSummary(practice) {
  if (!practice || practice.status !== 'done') return null
  const total = practice.questionCount || practice.questions.length
  const first = practice.correctCount === null ? total : practice.correctCount
  return {
    total,
    first,
    comment: first === total ? '一道没错，满分通关！' : `一次就对了 ${first} 道，错的也都改对了。`,
    review: (practice.review || []).map((item, index) => ({
      number: index + 1,
      prompt: practice.questions[index] ? practice.questions[index].prompt : '',
      answer: String(item.answer || ''),
      explanation: String(item.explanation || ''),
      firstTry: item.firstTry
    }))
  }
}

/** 连对到这几道时，进度条上方弹一句（多邻国式连对提示）。 */
const COMBO_STEPS = [3, 5, 8, 12]
function comboText(streak) {
  return COMBO_STEPS.includes(streak) ? `连对 ${streak} 道！` : ''
}

/** 进度条（0～100）。 */
function progressPercent(practice) {
  const progress = practice && practice.progress
  const total = practice ? practice.questionCount || practice.questions.length : 0
  if (practice && practice.status === 'done') return 100
  if (!progress || !total) return 0
  return Math.round((progress.cleared / total) * 100)
}

// 课程详情「第二关 · 互动练习」卡片。practice 为 null：还没读到（画骨架）；error：读取失败（点一下重读）。
// 以前排的课后作业（kind = homework）照旧叫「课后作业」，点进作业页。图标与验收卡同一套（talk / waiting / passed / lock）。
function practiceCard(practice, error = false) {
  if (error) return { icon: 'waiting', title: '互动练习暂时没有读到', text: '点一下重新读取', cta: '重新读取', available: true, action: 'reload', cleared: false, homework: false }
  if (!practice) return null
  const homework = practice.kind === 'homework'
  const count = practice.questionCount
  // 必须完成一关才解锁下一关（2026-11-11）：做完（通关 / 交了卷）才算过，出题失败要重新出题做完
  const base = { available: true, action: 'open', homework, cleared: practice.status === 'done' }
  switch (practice.status) {
    case 'preparing':
      return { ...base, icon: 'waiting', title: '正在出题', text: '按这节课的知识点出几道小题，稍等一会儿就好', cta: '' }
    case 'ready':
      if (homework) return { ...base, icon: 'talk', title: `${count} 道课后作业待完成`, text: '做完马上出结果', cta: '去做题' }
      return {
        ...base,
        icon: 'talk',
        title: practice.progress && practice.progress.answered ? `已闯过 ${practice.progress.cleared}/${count} 道` : `${count} 道小题等你闯关`,
        text: '一屏一道，答错的会再考一次，全部做对就通关',
        cta: '去闯关'
      }
    case 'failed':
      return { ...base, icon: 'waiting', title: '这次没出好题', text: '点进去重新出一次题，做完就能去验收', cta: '重新出题' }
    case 'done':
      if (homework) return { ...base, icon: 'passed', title: '课后作业已完成', text: '点开看每道题的解析', cta: '看解析' }
      return { ...base, icon: 'passed', title: '互动练习已通关', text: `一次答对 ${practice.correctCount === null ? count : practice.correctCount}/${count} 道`, cta: '回顾' }
    default:
      return { icon: 'lock', title: '看完课就能闯关', text: '学完整节课，按本课知识点出 5～8 道小题', cta: '', available: false, action: '', toast: '先把这节课学完', cleared: false, homework: false }
  }
}

// 第三关「AI 老师验收」要先通关第二关（2026-11-11）：还没开始过验收、练习没通关时，验收卡锁住。
// 练习读不到（card 为 null 或读取失败）时不锁，免得因为读不到把学生挡在外面（服务端还会再拦一次）。
function gateReview(review, card) {
  if (!review || !card || card.action === 'reload' || card.cleared) return review
  if (!review.available || review.status !== 'not_started') return review
  return { ...review, available: false, status: 'locked', icon: 'lock', title: '通关互动练习后开放验收', text: '先把第二关的小题都做对，再来讲给老师听', toast: '先通关互动练习', cta: '', ring: null }
}

module.exports = {
  comboText,
  practiceCard,
  gateReview,
  TYPE_LABELS,
  normalizePractice,
  emptyAnswer,
  answerReady,
  responseOf,
  questionScreen,
  toggleOrder,
  tapMatch,
  feedbackOf,
  clearSummary,
  progressPercent
}
