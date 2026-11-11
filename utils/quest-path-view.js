// 学习页闯关路径（2026-11-11 用户规则，多邻国式）：课程服务 /api/learn/quest-path 给的路径 → 页面模型。
// 一段 = 目标导图里的一个大条件（没有导图的按系列）；一节课 = 连续几关（看课按章节拆成 1～3 段 → 互动练习 → AI 老师验收），
// 必须完成一关才解锁下一关；
// 每节课看课和互动练习之间有一个宝箱（看完这节课就能开，送成就卡抽卡次数，不算一关、不挡后面）；
// 段末是复习关（今天该复习的课）和宝箱（这一段的课都过了验收就打开，去成就卡）。
// 点关卡先弹出说明卡（多邻国式），再点「开始」才进去；动效设计见 docs/闯关学习动效设计记录.md。
// 关卡在路径上左右摆动排开（ZIGZAG，单位 rpx，相对中线的偏移），当前关上面飘一个「开始」气泡。

const ZIGZAG = [0, 90, 150, 90, 0, -90, -150, -90]
const STEP_ICONS = { watch: 'play', practice: 'pencil', accept: 'mic' }
const STEP_STATES = ['done', 'current', 'open', 'locked']
const STAGE_TONES = ['orange', 'blue', 'violet', 'teal', 'rose']
const CHEST_STATES = ['locked', 'ready', 'opened']

const stepId = (stageId, key, part) => `${stageId}-${key}${part ? `-${part}` : ''}`
const text = (value) => String(value === undefined || value === null ? '' : value)

function normalizeStep(step) {
  const key = ['watch', 'practice', 'accept'].includes(step && step.key) ? step.key : 'watch'
  const part = Number(step && step.part)
  return {
    key,
    part: Number.isInteger(part) && part > 0 ? part : 0,
    sceneId: /^[A-Za-z0-9_-]{1,80}$/.test(text(step && step.sceneId)) ? text(step.sceneId) : '',
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
      chest: { state: CHEST_STATES.includes(lesson && lesson.chest && lesson.chest.state) ? lesson.chest.state : 'locked' },
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
    current: value.current && value.current.stageId
      ? { stageId: text(value.current.stageId), step: text(value.current.step), part: Number(value.current.part) || 0 }
      : null,
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
      const total = lesson.steps.length
      const passed = lesson.steps.filter((step) => step.state === 'done').length
      const lastWatch = lesson.steps.reduce((last, step, index) => (step.key === 'watch' ? index : last), -1)
      lesson.steps.forEach((step, stepIndex) => {
        nodes.push({
          id: stepId(lesson.stageId, step.key, step.part),
          kind: 'step',
          stageId: lesson.stageId,
          step: step.key,
          part: step.part,
          sceneId: step.sceneId,
          state: step.state,
          icon: step.state === 'locked' ? 'lock' : step.state === 'done' ? 'check' : STEP_ICONS[step.key],
          offset: nextOffset(),
          label: step.label,
          detail: step.detail,
          // 每节课的第一关上写课名
          lessonTitle: stepIndex === 0 ? lesson.title : '',
          course: lesson.title,
          position: `第 ${stepIndex + 1} 关 / 共 ${total} 关`,
          // 当前关外圈的进度环：这节课过了几关（百分比）
          ring: total ? Math.round((passed / total) * 100) : 0,
          lockedBy: lesson.lockedBy
        })
        if (stepIndex === lastWatch) nodes.push(lessonChestNode(lesson, nextOffset()))
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
    currentId: path.current ? stepId(path.current.stageId, path.current.step, path.current.part) : '',
    sections
  }
}

/** 每节课的宝箱节点（看课之后、互动练习之前）。 */
function lessonChestNode(lesson, offset) {
  const state = lesson.chest.state
  return {
    id: `${lesson.stageId}-chest`,
    kind: 'lesson-chest',
    stageId: lesson.stageId,
    state: state === 'opened' ? 'done' : state === 'ready' ? 'open' : 'locked',
    icon: state === 'opened' ? 'chest-open' : 'chest',
    offset,
    label: state === 'opened' ? '宝箱已打开' : '宝箱',
    detail: state === 'ready' ? '看完这节课的奖励' : state === 'opened' ? '' : '看完这节课就能打开',
    course: lesson.title,
    lockedBy: null
  }
}

/** 节点 id → 节点（点击、弹卡、动效都按 id 找）。 */
function findNode(view, id) {
  if (!view || !id) return null
  for (const section of view.sections) for (const node of section.nodes) if (node.id === id) return node
  return null
}

/**
 * 点关卡后弹出的说明卡（多邻国式：先说明这一关，再点「开始」）。
 * { title, detail, course, position, action: 按钮字 | ''（不能进时没有按钮）, note: 锁着时的说明 }。
 */
function nodePopover(node) {
  if (!node) return null
  const base = { id: node.id, title: node.label, detail: node.detail, course: node.course || '', position: node.position || '', action: '', note: '' }
  if (node.kind === 'placeholder') return { ...base, title: '这一段还没有课', note: '联系老师，按你的目标定制这一段' }
  if (node.kind === 'chest') return node.state === 'done' ? { ...base, action: '去成就卡' } : { ...base, note: '这一段的课都过了验收，宝箱就打开了' }
  if (node.kind === 'lesson-chest') {
    if (node.state === 'open') return { ...base, title: '宝箱', detail: '打开送 1 次成就卡抽卡机会', action: '打开宝箱' }
    if (node.state === 'done') return { ...base, note: '这个宝箱已经开过了' }
    return { ...base, note: '看完这节课，宝箱就能打开' }
  }
  if (node.kind === 'review') return { ...base, action: '开始复习' }
  if (node.state === 'locked') {
    const target = nodeTarget(node)
    return { ...base, note: target && target.toast ? target.toast : '这一关还没开放' }
  }
  return { ...base, action: node.state === 'done' ? (node.step === 'watch' ? '再看一遍' : '再看看') : '开始' }
}

/**
 * 回到学习页时的过关动效（多邻国式）：上次的当前关这次过了 → 它「完成弹跳」；当前关换了 → 新的当前关「解锁弹起」。
 * previousId 是上次看到的当前关 id；第一次打开或没变化时返回 null。
 */
function questTransition(previousId, view) {
  if (!view || !previousId || !view.currentId || previousId === view.currentId) return null
  const previous = findNode(view, previousId)
  return { doneId: previous && previous.state === 'done' ? previousId : '', unlockId: view.currentId }
}

/** 点了一个节点该去哪：{ url } / { toast } / { chest: stageId }（打开这节课的宝箱）。 */
function nodeTarget(node) {
  if (!node) return null
  const stage = encodeURIComponent(node.stageId || '')
  if (node.kind === 'placeholder') return { toast: '这一段还没有课，联系老师按你的目标定制' }
  if (node.kind === 'chest') return node.state === 'done' ? { url: '/learning/achievement-cards/index' } : { toast: '这一段的课都过了验收，宝箱就打开了' }
  if (node.kind === 'review') return { url: `/learning/review/index?stageId=${stage}` }
  if (node.kind === 'lesson-chest') {
    if (node.state === 'open') return { chest: node.stageId }
    return { toast: node.state === 'done' ? '这个宝箱已经开过了' : '看完这节课，宝箱就能打开' }
  }
  if (node.state === 'locked') {
    if (node.lockedBy) return { toast: `先学完「${node.lockedBy.title}」` }
    return { toast: node.step === 'practice' ? '先把这节课看完' : node.step === 'accept' ? '先通关互动练习' : node.step === 'watch' && node.part > 1 ? '先学完上一段' : '这一关还没开放' }
  }
  if (node.step === 'practice') return { url: `/learning/practice/index?stageId=${stage}` }
  if (node.step === 'accept') return { url: `/learning/agent-acceptance/index?stageId=${stage}` }
  // 看课的章节小关：直接从这一段第一页没学完的开始学；没有页信息时进课程页
  if (node.sceneId) return { url: `/learning/course/index?agentCourseId=${stage}&sceneId=${encodeURIComponent(node.sceneId)}` }
  return { url: `/learning/agent-course/index?stageId=${stage}` }
}

module.exports = { normalizeQuestPath, questPathView, nodeTarget, nodePopover, findNode, questTransition }
