// 学习页闯关路径（2026-11-11 用户规则，多邻国式）：课程服务 /api/learn/quest-path 给的路径 → 页面模型。
// 一段 = 目标导图里的一个大条件（没有导图的按系列）；一节课 = 连续三关（看课 → 互动练习 → AI 老师验收）；
// 段末是复习关（今天该复习的课）和宝箱（这一段的课都过了验收就打开，去成就卡）。
// 关卡在路径上左右摆动排开（ZIGZAG，单位 rpx，相对中线的偏移），当前关上面飘一个「开始」气泡。

const ZIGZAG = [0, 90, 150, 90, 0, -90, -150, -90]
const STEP_ICONS = { watch: 'play', practice: 'pencil', accept: 'mic' }
const STEP_STATES = ['done', 'current', 'open', 'locked']
const STAGE_TONES = ['orange', 'blue', 'violet', 'teal', 'rose']

const text = (value) => String(value === undefined || value === null ? '' : value)

function normalizeStep(step) {
  const key = ['watch', 'practice', 'accept'].includes(step && step.key) ? step.key : 'watch'
  return {
    key,
    state: STEP_STATES.includes(step && step.state) ? step.state : 'locked',
    label: text(step && step.label),
    detail: text(step && step.detail)
  }
}

function normalizeQuestPath(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const stages = (Array.isArray(value.stages) ? value.stages : []).map((stage) => ({
    id: text(stage && stage.id),
    kind: text(stage && stage.kind),
    title: text(stage && stage.title) || '定制课程',
    subtitle: text(stage && stage.subtitle),
    empty: !!(stage && stage.empty),
    lessons: (Array.isArray(stage && stage.lessons) ? stage.lessons : []).map((lesson) => ({
      stageId: text(lesson && lesson.stageId),
      title: text(lesson && lesson.title) || '定制课程',
      locked: !!(lesson && lesson.locked),
      lockedBy: lesson && lesson.lockedBy ? { stageId: text(lesson.lockedBy.stageId), title: text(lesson.lockedBy.title) } : null,
      done: !!(lesson && lesson.done),
      steps: (Array.isArray(lesson && lesson.steps) ? lesson.steps : []).map(normalizeStep)
    })),
    review: stage && stage.review && Array.isArray(stage.review.stageIds) && stage.review.stageIds.length
      ? { count: Number(stage.review.count) || stage.review.stageIds.length, stageIds: stage.review.stageIds.map(text) }
      : null,
    chest: stage && stage.chest ? { opened: !!stage.chest.opened, done: Number(stage.chest.done) || 0, total: Number(stage.chest.total) || 0 } : null
  }))
  return {
    goal: value.goal && value.goal.title ? { title: text(value.goal.title), subject: text(value.goal.subject) } : null,
    stages,
    current: value.current && value.current.stageId ? { stageId: text(value.current.stageId), step: text(value.current.step) } : null,
    stats: { lessons: Number(value.stats && value.stats.lessons) || 0, done: Number(value.stats && value.stats.done) || 0 }
  }
}

/**
 * 页面模型：header（大目标与进度）+ sections（每段：横幅 + 一串节点）。
 * 节点 kind：step（三关之一）/ review（复习关）/ chest（宝箱）/ placeholder（还没有课的段）。
 */
function questPathView(path) {
  if (!path) return null
  let position = 0
  const nextOffset = () => ZIGZAG[(position++) % ZIGZAG.length]
  const sections = path.stages.map((stage, stageIndex) => {
    const nodes = []
    if (stage.empty) {
      nodes.push({ id: `${stage.id}-placeholder`, kind: 'placeholder', state: 'locked', offset: nextOffset(), label: '联系老师定制这一段', detail: '', icon: 'lock' })
    }
    stage.lessons.forEach((lesson) => {
      lesson.steps.forEach((step, stepIndex) => {
        nodes.push({
          id: `${lesson.stageId}-${step.key}`,
          kind: 'step',
          stageId: lesson.stageId,
          step: step.key,
          state: step.state,
          icon: step.state === 'locked' ? 'lock' : step.state === 'done' ? 'check' : STEP_ICONS[step.key],
          offset: nextOffset(),
          label: step.label,
          detail: step.detail,
          // 每节课的第一关上写课名
          lessonTitle: stepIndex === 0 ? lesson.title : '',
          lockedBy: lesson.lockedBy
        })
      })
    })
    if (stage.review) {
      nodes.push({ id: `${stage.id}-review`, kind: 'review', state: 'open', icon: 'review', offset: nextOffset(), label: '复习关', detail: `${stage.review.count} 节课该复习了`, stageId: stage.review.stageIds[0] })
    }
    if (stage.chest) {
      nodes.push({
        id: `${stage.id}-chest`,
        kind: 'chest',
        state: stage.chest.opened ? 'done' : 'locked',
        icon: stage.chest.opened ? 'chest-open' : 'chest',
        offset: nextOffset(),
        label: stage.chest.opened ? '宝箱已打开' : '阶段宝箱',
        detail: stage.chest.opened ? '去成就卡看看' : `这一段过了 ${stage.chest.done}/${stage.chest.total} 节`
      })
    }
    return {
      id: stage.id,
      number: stageIndex + 1,
      tone: STAGE_TONES[stageIndex % STAGE_TONES.length],
      title: stage.title,
      subtitle: stage.subtitle,
      empty: stage.empty,
      progress: stage.chest ? `${stage.chest.done}/${stage.chest.total}` : '',
      nodes
    }
  })
  return {
    goal: path.goal,
    hasLessons: path.stats.lessons > 0,
    progressText: path.stats.lessons ? `已闯过 ${path.stats.done}/${path.stats.lessons} 节` : '',
    percent: path.stats.lessons ? Math.round((path.stats.done / path.stats.lessons) * 100) : 0,
    currentId: path.current ? `${path.current.stageId}-${path.current.step}` : '',
    sections
  }
}

/** 点了一个节点该去哪：{ url } 或 { toast }。 */
function nodeTarget(node) {
  if (!node) return null
  const stage = encodeURIComponent(node.stageId || '')
  if (node.kind === 'placeholder') return { toast: '这一段还没有课，联系老师按你的目标定制' }
  if (node.kind === 'chest') return node.state === 'done' ? { url: '/learning/achievement-cards/index' } : { toast: '这一段的课都过了验收，宝箱就打开了' }
  if (node.kind === 'review') return { url: `/learning/review/index?stageId=${stage}` }
  if (node.state === 'locked') {
    if (node.lockedBy) return { toast: `先学完「${node.lockedBy.title}」` }
    return { toast: node.step === 'practice' ? '先把这节课看完' : node.step === 'accept' ? '先通关互动练习' : '这一关还没开放' }
  }
  if (node.step === 'practice') return { url: `/learning/practice/index?stageId=${stage}` }
  if (node.step === 'accept') return { url: `/learning/agent-acceptance/index?stageId=${stage}` }
  return { url: `/learning/agent-course/index?stageId=${stage}` }
}

module.exports = { normalizeQuestPath, questPathView, nodeTarget }
