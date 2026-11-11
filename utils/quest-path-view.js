// 学习页闯关路径（2026-11-11 用户规则，多邻国式）：课程服务 /api/learn/quest-path 给的路径 → 页面模型。
// 一段 = 目标导图里的一个大条件（没有导图的按系列）；一节课 = 连续几关（看课按章节拆成 1～3 段 → 互动练习 → AI 老师验收），
// 必须完成一关才解锁下一关；
// 每节课看课和互动练习之间有一个宝箱（看完这节课就能开，送成就卡抽卡次数，不算一关、不挡后面）；
// 每部分（一节课）末尾一个奖杯；阶段末尾是阶段徽章（这一阶段的课都过了验收就点亮，去成就卡）。
// 点关卡先弹出说明卡（多邻国式），再点「开始」才进去；动效设计见 docs/闯关学习动效设计记录.md。
// 关卡在路径上左右摆动排开（ZIGZAG，单位 rpx，相对中线的偏移），当前关上面飘一个「开始」气泡。

const ZIGZAG = [0, 90, 150, 90, 0, -90, -150, -90]
const STEP_ICONS = { watch: 'play', practice: 'pencil', accept: 'mic' }
// 关卡钮上的图标（2026-11-11 晚，照多邻国：学习关是星星，别的关换成各自的图标；锁着画锁）。
// 素材在后端 ui_asset（scripts/ui-assets/quest/），路径写全，verify-ui-assets 才扫得到。
const GLYPHS = {
  watch: '/assets/quest/star.svg',
  practice: '/assets/quest/dumbbell.svg',
  accept: '/assets/quest/mic.svg',
  review: '/assets/quest/repeat.svg',
  lock: '/assets/quest/lock.svg',
  trophy: '/assets/quest/trophy.svg',
  trophyLocked: '/assets/quest/trophy-locked.svg',
  chest: '/assets/quest/chest.svg',
  chestOpen: '/assets/quest/chest-open.svg',
  chestLocked: '/assets/quest/chest-locked.svg',
  badge: '/assets/quest/badge.svg',
  badgeLocked: '/assets/quest/badge-locked.svg'
}
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
 * 页面模型（2026-11-11 晚用户要求，照多邻国「阶段 → 部分 → 关卡」）：
 *   阶段 = 课程服务给的一段（目标导图的大条件 / 系列）；部分 = 一节课；一个部分里是这节课的几关
 *   （看课 1～3 段 → 宝箱 → 互动练习 → AI 老师验收，今天该复习时再加复习关），最多 7 个，不再把一段的几节课串成十几二十关。
 *   阶段最后一个部分末尾放阶段宝箱。还没有课的阶段给一个「联系老师定制」的部分。
 * 返回 { goal, progressText, percent, currentId, currentPartId, parts: [{ id, phaseNumber, partNumber, tone, phaseTitle,
 *   phaseSubtitle, firstOfPhase, title, stageId, progress, nodes }] }。
 * 节点 kind：step（一关）/ lesson-chest（这节课的宝箱）/ review（复习关）/ trophy（部分末尾的奖杯，这节课每关都过了才点亮）/
 *   chest（阶段徽章：这一阶段的课都过了验收就点亮，点了去成就卡）/ placeholder。每个节点带 glyph（图标素材路径）。
 * 部分还带 mascot（路径旁的小鹿：side 在路径弯出去的另一侧，stars = 看完 / 练习通关 / 验收通过 各一颗，dim = 这节课还没开始）。
 * 相邻两个部分左右镜像排开（多邻国路径一段往右弯、下一段往左弯）。
 */
function questPathView(path) {
  if (!path) return null
  const parts = []
  let currentPartId = ''
  let partIndex = 0
  path.stages.forEach((stage, stageIndex) => {
    const tone = STAGE_TONES[stageIndex % STAGE_TONES.length]
    const phase = { phaseNumber: stageIndex + 1, tone, phaseTitle: stage.title, phaseSubtitle: stage.subtitle }
    const reviewDue = new Set(stage.review ? stage.review.stageIds : [])
    const stageParts = []
    if (stage.empty || !stage.lessons.length) {
      stageParts.push({
        id: `${stage.id}-empty`,
        title: stage.title,
        stageId: '',
        progress: '',
        nodes: [{ id: `${stage.id}-placeholder`, kind: 'placeholder', state: 'locked', offset: 0, label: '联系老师定制这一部分', detail: '', icon: 'lock', glyph: GLYPHS.lock }],
        mascot: null
      })
      partIndex++
    }
    stage.lessons.forEach((lesson) => {
      let position = 0
      const sign = partIndex++ % 2 ? -1 : 1
      const nextOffset = () => sign * ZIGZAG[(position++) % ZIGZAG.length] || 0
      const nodes = []
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
          glyph: step.state === 'locked' ? GLYPHS.lock : GLYPHS[step.key],
          offset: nextOffset(),
          label: step.label,
          detail: step.detail,
          course: lesson.title,
          position: `第 ${stepIndex + 1} 关 / 共 ${total} 关`,
          // 当前关外圈的进度环：这节课过了几关（百分比）
          ring: total ? Math.round((passed / total) * 100) : 0,
          segs: Math.max(total, 1),
          lockedBy: lesson.lockedBy
        })
        if (stepIndex === lastWatch) nodes.push(lessonChestNode(lesson, nextOffset()))
      })
      if (reviewDue.has(lesson.stageId)) {
        nodes.push({ id: `${lesson.stageId}-review`, kind: 'review', state: 'open', icon: 'review', glyph: GLYPHS.review, offset: nextOffset(), label: '复习关', detail: '这节课今天该复习了', stageId: lesson.stageId, course: lesson.title })
      }
      // 部分末尾的奖杯（多邻国每个单元最后一个钮）：这节课每一关都过了才点亮；不算一关
      const cleared = total > 0 && passed === total
      nodes.push({
        id: `${lesson.stageId}-trophy`,
        kind: 'trophy',
        stageId: lesson.stageId,
        state: cleared ? 'done' : 'locked',
        icon: 'trophy',
        glyph: cleared ? GLYPHS.trophy : GLYPHS.trophyLocked,
        offset: nextOffset(),
        label: cleared ? '这一部分通关了' : '部分奖杯',
        detail: cleared ? '' : `这节课过了 ${passed}/${total} 关`,
        course: lesson.title,
        lockedBy: null
      })
      const partId = `part-${lesson.stageId}`
      if (path.current && path.current.stageId === lesson.stageId) currentPartId = partId
      stageParts.push({ id: partId, title: lesson.title, stageId: lesson.stageId, progress: `${passed}/${total}`, nodes, offsetNext: nextOffset, mascot: lessonMascot(lesson, sign) })
    })
    if (stage.chest && stageParts.length) {
      const last = stageParts[stageParts.length - 1]
      last.nodes.push({
        id: `${stage.id}-chest`,
        kind: 'chest',
        state: stage.chest.opened ? 'done' : 'locked',
        icon: stage.chest.opened ? 'chest-open' : 'chest',
        glyph: stage.chest.opened ? GLYPHS.badge : GLYPHS.badgeLocked,
        badge: stageIndex + 1,
        offset: last.offsetNext ? last.offsetNext() : 0,
        label: stage.chest.opened ? `第 ${stageIndex + 1} 阶段徽章` : '阶段徽章',
        detail: stage.chest.opened ? '去成就卡看看' : `这一阶段过了 ${stage.chest.done}/${stage.chest.total} 节`
      })
    }
    stageParts.forEach((part, index) => {
      const { offsetNext: _offsetNext, ...rest } = part
      parts.push({ ...rest, ...phase, partNumber: index + 1, firstOfPhase: index === 0 })
    })
  })
  const currentId = path.current ? stepId(path.current.stageId, path.current.step, path.current.part) : ''
  return {
    goal: path.goal,
    hasLessons: path.stats.lessons > 0,
    progressText: path.stats.lessons ? `已闯过 ${path.stats.done}/${path.stats.lessons} 节` : '',
    percent: path.stats.lessons ? Math.round((path.stats.done / path.stats.lessons) * 100) : 0,
    currentId,
    currentPartId: currentPartId || (parts[0] ? parts[0].id : ''),
    parts
  }
}

/**
 * 路径旁的小鹿（多邻国部分中间那个角色 + 下面三颗星）：放在路径弯出去的另一侧。
 * 三颗星 = 看完这节课、互动练习通关、AI 老师验收通过；这节课还一关都没开时小鹿暗着。
 */
function lessonMascot(lesson, sign) {
  const steps = lesson.steps
  const watched = steps.some((step) => step.key === 'watch') && steps.filter((step) => step.key === 'watch').every((step) => step.state === 'done')
  const passedKey = (key) => steps.some((step) => step.key === key && step.state === 'done')
  const stars = [watched, passedKey('practice'), passedKey('accept')].filter(Boolean).length
  const started = steps.some((step) => step.state !== 'locked')
  return { side: sign > 0 ? 'left' : 'right', stars: [0, 1, 2].map((index) => index < stars), dim: lesson.locked || !started }
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
    glyph: state === 'opened' ? GLYPHS.chestOpen : state === 'ready' ? GLYPHS.chest : GLYPHS.chestLocked,
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
  for (const part of view.parts) for (const node of part.nodes) if (node.id === id) return node
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
  if (node.kind === 'chest') return node.state === 'done' ? { ...base, action: '去成就卡' } : { ...base, note: '这一阶段的课都过了验收，徽章就点亮了' }
  if (node.kind === 'trophy') return node.state === 'done' ? { ...base, note: '这节课每一关都过了' } : { ...base, note: '这节课每一关都过了，奖杯就点亮' }
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
  if (node.kind === 'chest') return node.state === 'done' ? { url: '/learning/achievement-cards/index' } : { toast: '这一阶段的课都过了验收，徽章就点亮了' }
  if (node.kind === 'trophy') return { toast: node.state === 'done' ? '这节课每一关都过了' : '这节课每一关都过了，奖杯就点亮' }
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
