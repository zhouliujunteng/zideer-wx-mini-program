// 课后作业（2026-10-13 用户规则「每节课学完 AI 出练习题」）的显示：课程服务 lib/course/homework 给的作业 → 页面模型。
// 一节定制课程整节学完后，后台按本课知识点出 3～5 道客观题（单选为主，可有判断题），学生做完服务端判分。
// 用在三处：课程详情「课后作业」卡片（learning/agent-course）、作业页（learning/homework）、家长学生看板「作业动态」。
// 给家长、学生看的字里不出现「AI」。

const LETTERS = ['A', 'B', 'C', 'D']
const STATUSES = ['locked', 'preparing', 'ready', 'failed', 'done']
const BEIJING_OFFSET_MS = 8 * 3600000

function normalizeHomework(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const status = STATUSES.includes(value.status) ? value.status : 'locked'
  const questions = (Array.isArray(value.questions) ? value.questions : []).map((question) => ({
    type: question && question.type === 'judge' ? 'judge' : 'single',
    prompt: String(question && question.prompt || ''),
    options: (Array.isArray(question && question.options) ? question.options : []).map((option) => String(option || ''))
  }))
  const result = value.result && typeof value.result === 'object' ? {
    correct: Math.max(0, Number(value.result.correct) || 0),
    total: Math.max(0, Number(value.result.total) || 0),
    items: (Array.isArray(value.result.items) ? value.result.items : []).map((item) => ({
      choice: String(item && item.choice || ''),
      answer: String(item && item.answer || ''),
      correct: Boolean(item && item.correct),
      explanation: String(item && item.explanation || '')
    }))
  } : null
  return {
    stageId: String(value.stageId || ''),
    title: String(value.title || '定制课程'),
    status,
    questionCount: Math.max(0, Number(value.questionCount) || questions.length),
    questions,
    result: status === 'done' ? result : null,
    submittedAt: value.submittedAt || ''
  }
}

// 课程详情页「课后作业」卡片。homework 为 null：还没读到（页面画骨架）；error 为真：读取失败（点一下重读）。
// 图标沿用「复述验收」卡的几种（talk / waiting / passed / lock），样式同一套。
function homeworkCard(homework, error = false) {
  if (error) {
    return { icon: 'waiting', title: '课后作业暂时没有读到', text: '点一下重新读取', cta: '重新读取', available: true, action: 'reload' }
  }
  if (!homework) return null
  const count = homework.questionCount
  switch (homework.status) {
    case 'preparing':
      return { icon: 'waiting', title: '正在出练习题', text: '按这节课的知识点出 3～5 道题，稍等一会儿就好', cta: '', available: true, action: 'open' }
    case 'ready':
      return { icon: 'talk', title: `${count} 道练习题待完成`, text: '做完马上出结果，看看这节课掌握得怎么样', cta: '去做题', available: true, action: 'open' }
    case 'failed':
      return { icon: 'waiting', title: '练习题没有出好', text: '点进去重新出一次题', cta: '重新出题', available: true, action: 'open' }
    case 'done': {
      const correct = homework.result ? homework.result.correct : 0
      return { icon: 'passed', title: `答对 ${correct}/${count} 道`, text: '课后作业已完成，点开看每道题的解析', cta: '看解析', available: true, action: 'open' }
    }
    default:
      return { icon: 'lock', title: '学完整节课后出练习题', text: '学完全部内容，会按本课知识点出 3～5 道练习题', cta: '', available: false, action: '', toast: '学完整节课后才有课后作业' }
  }
}

// 作业页做题时的题目卡：选中的选项高亮；交卷后标出对错与正确答案。
function questionRows(homework, choices = []) {
  const result = homework.result
  return homework.questions.map((question, index) => {
    const item = result && result.items[index]
    const choice = item ? item.choice : String(choices[index] || '')
    return {
      index,
      number: index + 1,
      typeLabel: question.type === 'judge' ? '判断题' : '单选题',
      prompt: question.prompt,
      options: question.options.map((label, optionIndex) => {
        const letter = LETTERS[optionIndex]
        let state = choice === letter ? 'selected' : ''
        if (item) {
          if (letter === item.answer) state = 'right'
          else if (letter === choice) state = 'wrong'
          else state = ''
        }
        return { letter, label, state }
      }),
      answered: Boolean(choice),
      correct: item ? item.correct : null,
      answerText: item ? `正确答案 ${item.answer}` : '',
      explanation: item ? item.explanation : ''
    }
  })
}

function allAnswered(homework, choices = []) {
  return homework.questions.length > 0 && homework.questions.every((_, index) => Boolean(choices[index]))
}

function resultSummary(homework) {
  const result = homework.result
  if (!result || !result.total) return null
  const ratio = result.correct / result.total
  const comment = ratio >= 1 ? '全对，这节课掌握得很扎实' : ratio >= 0.6 ? '大部分都会了，看看做错的题的解析' : '还有几处没弄明白，看完解析可以回课程里再学一遍'
  return { score: `${result.correct}/${result.total}`, comment }
}

// 北京时间日期 'YYYY-MM-DD'、时刻 'HH:mm'
function dateKey(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

function clockText(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(11, 16)
}

// 家长学生看板「学习诊断 → 作业动态」：所选那天布置（出好）或完成的作业。
// state: { loaded, failed, items }；还没读到画骨架，读失败给重试，读到了才显示「当日没有作业」。
function guardianHomeworkSection(state, date) {
  const base = { id: 'homework', title: '作业动态', tone: 'blue' }
  if (!state || (!state.loaded && !state.failed)) return { ...base, rows: [], summary: '', skeleton: true }
  if (!state.loaded && state.failed) return { ...base, rows: [], summary: '作业暂时没有读到', failed: true }
  const rows = []
  for (const item of state.items || []) {
    const assigned = dateKey(item.readyAt || item.createdAt)
    const submitted = item.status === 'done' ? dateKey(item.submittedAt) : ''
    if (assigned !== date && submitted !== date) continue
    const count = Number(item.questionCount) || 0
    let detail = ''
    let statusLabel = ''
    if (item.status === 'done') {
      detail = `${count} 道练习题 · ${clockText(item.submittedAt)} 完成 · 答对 ${Number(item.correctCount) || 0} 道`
      statusLabel = '已完成'
    } else if (item.status === 'ready') {
      detail = `${count} 道练习题 · 还没做`
      statusLabel = '待完成'
    } else if (item.status === 'preparing') {
      detail = '练习题正在准备'
      statusLabel = '准备中'
    } else continue
    rows.push({ id: `homework-${item.stageId}`, title: item.title || '定制课程', detail, statusLabel })
  }
  const pending = rows.filter((row) => row.statusLabel === '待完成').length
  const summary = rows.length
    ? `当日 ${rows.length} 份作业${pending ? ` · ${pending} 份待完成` : ' · 已全部完成'}`
    : '当日没有课后作业'
  return { ...base, rows, summary }
}

module.exports = {
  normalizeHomework,
  homeworkCard,
  questionRows,
  allAnswered,
  resultSummary,
  guardianHomeworkSection,
  LETTERS
}
