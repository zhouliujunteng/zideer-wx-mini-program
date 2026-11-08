// 提分工具结果 → 页面要的形状（score-tools/tool 与测试共用，纯函数）。
// 服务端结果格式见课程服务 lib/score-tools/tools/*.ts 的 view()。

// 审题六类的颜色：题干高亮与卡片标题同色（样式类 rv-<key>）。
const REVIEW_KEYS = ['task', 'constraint', 'data', 'implicit', 'distractor', 'scope']

const STEP_STATUS_TEXT = { ok: '没问题', error: '出错', affected: '受影响', unclear: '看不出' }

// 题干分段 → 按换行切成一行一行：小程序里一段 <text> 里带换行会排成两行高的行内块，
// 和前后片段错位（「。」悬在行尾、下一行文字插到前面），所以每行单独一个 <view>，行内的片段都不含换行。
function stemLines(segments) {
  const lines = [[]]
  for (const segment of segments) {
    String(segment.text || '').split('\n').forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, key: segment.key })
    })
  }
  return lines.map((parts, index) => ({ index, parts }))
}

function decorateReview(result) {
  const categories = Array.isArray(result.categories) ? result.categories : []
  const meta = {}
  for (const category of categories) meta[category.key] = category
  const questions = (Array.isArray(result.questions) ? result.questions : []).map((question) => ({
    label: String(question.label || ''),
    type: String(question.type || ''),
    warnings: Array.isArray(question.warnings) ? question.warnings.map(String) : [],
    restatement: String(question.restatement || ''),
    segments: (Array.isArray(question.segments) ? question.segments : []).map((segment) => ({
      text: String(segment.text || ''),
      key: REVIEW_KEYS.includes(segment.key) ? segment.key : ''
    })),
    lines: stemLines((Array.isArray(question.segments) ? question.segments : []).map((segment) => ({
      text: String(segment.text || ''),
      key: REVIEW_KEYS.includes(segment.key) ? segment.key : ''
    }))),
    sections: (Array.isArray(question.sections) ? question.sections : [])
      .filter((section) => REVIEW_KEYS.includes(section.key))
      .map((section, index) => ({
        key: section.key,
        number: index < 9 ? `0${index + 1}` : String(index + 1),
        label: meta[section.key] ? String(meta[section.key].label) : '',
        hint: meta[section.key] ? String(meta[section.key].hint) : '',
        items: (Array.isArray(section.items) ? section.items : []).map((item) => ({ quote: String(item.quote || ''), interpretation: String(item.interpretation || '') })),
        emptyReason: String(section.emptyReason || '')
      }))
  }))
  return {
    kind: 'review',
    clarification: result.status === 'needs_clarification' ? String(result.message || '') : '',
    legend: REVIEW_KEYS.filter((key) => meta[key]).map((key) => ({ key, label: String(meta[key].label) })),
    questions
  }
}

// 错因诊断第二版（10-08）多了：可能原因排序、首错的正确写法、分三层的建议、自查问题、参考解法。
// 旧记录只有 causeLabel 与字符串数组的 fixes，服务端 view() 已兼容成新结构，这里再兜一层。
function decorateDiagnosis(result) {
  const labels = result.stepLabels || {}
  const reference = result.reference && typeof result.reference === 'object' ? result.reference : null
  const fixes = (Array.isArray(result.fixes) ? result.fixes : []).map((fix) =>
    typeof fix === 'string'
      ? { kind: 'method', kindLabel: '', text: fix }
      : { kind: String(fix.kind || 'method'), kindLabel: String(fix.kindLabel || ''), text: String(fix.text || '') }
  ).filter((fix) => fix.text)
  return {
    kind: 'diagnosis',
    status: ['diagnosed', 'correct', 'needs_clarification'].includes(result.status) ? result.status : 'needs_clarification',
    message: String(result.message || ''),
    summary: String(result.summary || ''),
    causeLabel: String(result.causeLabel || ''),
    causes: (Array.isArray(result.causes) ? result.causes : []).map((cause, index) => ({
      index,
      label: String(cause.label || ''),
      likelihood: ['high', 'medium', 'low'].includes(cause.likelihood) ? cause.likelihood : 'medium',
      likelihoodLabel: String(cause.likelihoodLabel || ''),
      evidence: String(cause.evidence || '')
    })).filter((cause) => cause.label),
    steps: (Array.isArray(result.steps) ? result.steps : []).map((step) => ({
      key: String(step.key || ''),
      label: String(labels[step.key] || ''),
      status: STEP_STATUS_TEXT[step.status] ? step.status : 'unclear',
      statusText: STEP_STATUS_TEXT[step.status] || STEP_STATUS_TEXT.unclear,
      note: String(step.note || '')
    })),
    firstError: result.firstError ? {
      stepLabel: String(labels[result.firstError.step] || ''),
      quote: String(result.firstError.quote || ''),
      explanation: String(result.firstError.explanation || ''),
      correction: String(result.firstError.correction || '')
    } : null,
    chain: Array.isArray(result.chain) ? result.chain.map(String) : [],
    compare: result.compare ? {
      student: String(result.compare.student || ''),
      ai: String(result.compare.ai || ''),
      agree: result.compare.agree === true ? 'yes' : result.compare.agree === false ? 'no' : ''
    } : null,
    fixes,
    selfCheck: Array.isArray(result.selfCheck) ? result.selfCheck.map(String).filter(Boolean) : [],
    knowledgePoints: Array.isArray(result.knowledgePoints) ? result.knowledgePoints.map(String) : [],
    reference: reference ? {
      finalAnswer: String(reference.finalAnswer || ''),
      steps: Array.isArray(reference.steps) ? reference.steps.map(String) : [],
      uncertainNote: reference.uncertain === true ? String(reference.uncertainNote || '有拿不准的地方') : ''
    } : null
  }
}

const LEVEL_TONES = { basic: 'green', trap: 'orange', transfer: 'blue' }

// 举一反三：作答之前服务端不下发答案和解析（answered=false 时 answer、explanation 为空）。
function decoratePractice(result) {
  const questions = (Array.isArray(result.questions) ? result.questions : []).map((question, position) => {
    const index = Number.isInteger(question.index) ? question.index : position
    const answered = question.answered === true
    const yourAnswer = String(question.yourAnswer || '')
    const answer = String(question.answer || '')
    return {
      index,
      number: position + 1,
      level: String(question.level || ''),
      levelLabel: String(question.levelLabel || ''),
      levelHint: String(question.levelHint || ''),
      tone: LEVEL_TONES[question.level] || 'green',
      type: question.type === 'fill' ? 'fill' : 'choice',
      stem: String(question.stem || ''),
      stemLines: String(question.stem || '').split('\n'),
      options: (Array.isArray(question.options) ? question.options : []).map((option) => {
        const letter = String(option.letter || '')
        return {
          letter,
          text: String(option.text || ''),
          // 交了之后：正确答案标绿，选错的那个标红
          state: !answered ? '' : letter === answer ? 'right' : letter === yourAnswer ? 'wrong' : ''
        }
      }),
      design: String(question.design || ''),
      point: String(question.point || ''),
      answered,
      correct: question.correct === true,
      yourAnswer,
      answer,
      explanation: String(question.explanation || '')
    }
  })
  const answeredCount = questions.filter((q) => q.answered).length
  const correctCount = questions.filter((q) => q.answered && q.correct).length
  return {
    kind: 'practice',
    questions,
    total: questions.length,
    answeredCount,
    correctCount,
    finished: questions.length > 0 && answeredCount === questions.length
  }
}

function decorateRunResult(run) {
  const result = run && run.result
  if (!result || typeof result !== 'object') return null
  if (run.tool === 'question-review') return decorateReview(result)
  if (run.tool === 'error-diagnosis') return decorateDiagnosis(result)
  if (run.tool === 'error-variation') return decoratePractice(result)
  return null
}

module.exports = { decorateRunResult, stemLines, REVIEW_KEYS }
