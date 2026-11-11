/**
 * 智能体生成课程的展示规则（纯函数）：进度页、「我的课程」共用。
 * 服务端契约见 OpenMAIC-sync `app/api/learn/agent-courses`。
 */
const AGENT_COURSE_ID = /^stage-[A-Za-z0-9_-]{1,64}$/

// 对学生一律说「制作」，不说「生成」，更不提 AI（2026-09-23 用户规则）。
const COURSE_STATUS_LABELS = {
  generating: '制作中',
  completed: '已完成',
  partial: '部分完成',
  failed: '制作失败'
}

const PAGE_STATUS_LABELS = {
  pending: '排队中',
  generating: '制作中',
  done: '已完成',
  failed: '未完成'
}

// 课程详情页「课程内容」逐页的学习状态（课程服务 readAgentCourseLearning 的 scenes）。
// 学生说「一节」指一门课，所以这里说「这一页」，状态只说学没学（2026-09-24 用户需求）。
const LEARN_STATE_LABELS = {
  completed: '已学完',
  in_progress: '学习中',
  not_started: '未学'
}

// 课堂里的页面 id（scene_xxx）：点某一页从这一页开始学，经 learning/course 传给课程服务 /learn?scene=。
const SCENE_ID = /^[A-Za-z0-9_-]{1,80}$/

const PAGE_TYPE_LABELS = {
  slide: '讲解',
  quiz: '测验',
  interactive: '互动',
  pbl: '项目'
}

// 课程验收（学完 → 对话验收 → 老师核验）。入口在课程页（learning/agent-course）的「去验收」，
// 「我的课程」卡片上不放按钮，只在副标题里带一句进度（2026-09-24 用户规则）。
// label：课程页「去验收」右侧的状态标签；hint：「去验收」下面的一句说明；card：卡片副标题。
const ACCEPTANCE_LABELS = {
  not_started: { label: '', hint: '学完整门课后，把学到的讲给验收老师听', card: '' },
  in_progress: { label: '验收中', hint: '上次验收还没结束，接着聊就好', card: '验收中' },
  ai_retry: { label: '待重新验收', hint: '还有没讲清楚的地方，复习后再验收一次', card: '待重新验收' },
  pending_teacher: { label: '待老师核验', hint: '验收已完成，老师确认后知识点进入学习宇宙', card: '待老师核验' },
  teacher_passed: { label: '已通过', hint: '老师已确认，知识点已进入学习宇宙', card: '验收已通过' },
  teacher_rejected: { label: '建议重学', hint: '老师建议再巩固一下，点开看看老师怎么说', card: '老师建议重学' }
}

function isAgentCourseId(value) {
  return typeof value === 'string' && AGENT_COURSE_ID.test(value)
}

// 诊断会议一次定制几节课时，课程服务带上系列（老师建的系列文件夹名）；单节定制的课没有系列。
function normalizeSeries(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 120) : ''
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : ''
  return id && title ? { id, title } : null
}

// 系列课按顺序学（2026-10-15 用户规则）：系列里上一节还没学完进复述验收，这一节锁着，课程服务带上要先学的那一节。
function normalizeLock(raw) {
  if (!raw || raw.locked !== true || !raw.previous || !isAgentCourseId(raw.previous.stageId)) return null
  const title = typeof raw.previous.title === 'string' ? raw.previous.title.trim().slice(0, 80) : ''
  return { previousStageId: raw.previous.stageId, previousTitle: title || '上一节' }
}

function clampPercent(value) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0
}

function normalizeAgentCourse(raw) {
  if (!raw || !isAgentCourseId(raw.stageId)) return null
  const status = Object.prototype.hasOwnProperty.call(COURSE_STATUS_LABELS, raw.status) ? raw.status : 'generating'
  const progress = raw.progress && typeof raw.progress === 'object' ? raw.progress : {}
  const pages = (Array.isArray(raw.pages) ? raw.pages : [])
    .filter((page) => page && Number.isSafeInteger(Number(page.order)))
    .map((page) => {
      const pageStatus = Object.prototype.hasOwnProperty.call(PAGE_STATUS_LABELS, page.status) ? page.status : 'pending'
      return {
        order: Number(page.order),
        title: String(page.title || `第 ${page.order} 页`),
        type: PAGE_TYPE_LABELS[page.type] ? page.type : 'other',
        typeLabel: PAGE_TYPE_LABELS[page.type] || '课程页',
        status: pageStatus,
        statusLabel: PAGE_STATUS_LABELS[pageStatus],
        sceneId: typeof page.sceneId === 'string' && SCENE_ID.test(page.sceneId) ? page.sceneId : ''
      }
    })
  const total = Number.isSafeInteger(Number(progress.total)) ? Number(progress.total) : pages.length
  const done = Number.isSafeInteger(Number(progress.done)) ? Number(progress.done) : pages.filter((page) => page.status === 'done').length
  const percent = clampPercent(progress.percent)
  const canLearn = raw.canLearn === true
  return {
    stageId: raw.stageId,
    title: String(raw.title || '定制课程'),
    status,
    statusLabel: COURSE_STATUS_LABELS[status],
    isGenerating: status === 'generating',
    canLearn,
    percent,
    total,
    done,
    failed: pages.filter((page) => page.status === 'failed').length,
    pages,
    summary: agentCourseSummary(status, done, total),
    acceptanceStatus: Object.prototype.hasOwnProperty.call(ACCEPTANCE_LABELS, raw.acceptanceStatus) ? raw.acceptanceStatus : 'not_started',
    series: normalizeSeries(raw.series),
    lock: canLearn ? normalizeLock(raw.lock) : null,
    // 列表接口带的学习进度（学了几页 / 共几页 / 是否学完），「我的定制课程」据此分已学 / 未学；没读到为 null
    learning: canLearn ? normalizeAgentLearning(raw.learning) : null,
    // 课后作业（2026-10-13，课程服务 lib/course/homework）：学完整节才有；没有作业为 null
    homework: canLearn ? normalizeHomeworkBrief(raw.homework) : null,
    createdAt: String(raw.createdAt || '')
  }
}

/**
 * 「我的定制课程」的学习状态：completed 已学完（与学习端「本课已学完」同一口径）；in_progress 学了一部分；
 * not_started 做好了还没学（学习进度没读到也按没学）；generating 还在制作；unavailable 没有制作成功。
 * 已学 / 未学两栏里，只有 completed 算「已学」。
 */
function agentCourseLearnState(course) {
  if (!course.canLearn) return course.isGenerating ? 'generating' : 'unavailable'
  if (!course.learning) return 'not_started'
  if (course.learning.finished) return 'completed'
  return course.learning.completed > 0 ? 'in_progress' : 'not_started'
}

function agentCourseSummary(status, done, total) {
  if (status === 'generating') return total ? `正在制作第 ${Math.min(done + 1, total)} / ${total} 页` : '正在准备课程页面'
  if (status === 'completed') return `全部 ${total} 页已完成`
  if (status === 'partial') return `已完成 ${done} / ${total} 页，可以开始学习`
  return '这门课程没有制作成功，可以回到对话里重新安排'
}

const HOMEWORK_STATUSES = ['preparing', 'ready', 'failed', 'done']

function normalizeHomeworkBrief(raw) {
  if (!raw || !HOMEWORK_STATUSES.includes(raw.status)) return null
  return {
    status: raw.status,
    questionCount: Math.max(0, Number(raw.questionCount) || 0),
    correctCount: raw.correctCount == null ? null : Math.max(0, Number(raw.correctCount) || 0)
  }
}

/** 「我的课程」卡片：与首页「会员课程」同一结构（封面、标题、副标题、封面角标），kind=agent 区分入口。 */
function agentCourseCard(course, index = 0) {
  const acceptance = acceptanceEntry(course)
  const learnState = agentCourseLearnState(course)
  return {
    id: `agent:${course.stageId}`,
    kind: 'agent',
    stageId: course.stageId,
    canLearn: course.canLearn,
    isGenerating: course.isGenerating,
    title: course.title,
    meta: '课程学习',
    subtitle: agentCourseCardSubtitle(course, acceptance, learnState),
    // 系列名压在封面底部（styles/course-grid.wxss .more-course-series），一眼看出这节课属于哪一组定制
    seriesId: course.series ? course.series.id : '',
    seriesTitle: course.series ? course.series.title : '',
    learnState,
    learned: learnState === 'completed',
    locked: Boolean(course.lock),
    // 制作中的进度压在封面右上角，和首页非会员课程的「会员」角标同一个样式。
    // 学完后有练习题没做，角标提醒「作业待完成」（课后作业，2026-10-13）。
    tag: course.isGenerating ? `制作中 ${course.percent}%` : course.status === 'failed' ? '制作失败' : course.lock ? '待解锁' : course.homework && course.homework.status === 'ready' ? '作业待完成' : '',
    stateLabel: course.statusLabel,
    progress: course.isGenerating ? course.percent : course.canLearn ? 100 : 0,
    progressText: course.isGenerating ? `${course.percent}%` : course.canLearn ? '待学习' : '未完成',
    coverUrl: course.coverUrl || '',
    tone: index % 3,
    acceptanceStatus: acceptance.acceptanceStatus
  }
}

function agentCourseCardSubtitle(course, acceptance, learnState) {
  if (course.isGenerating) return course.total ? `已做好 ${course.done} / ${course.total} 页` : '正在准备课程页面'
  if (!course.canLearn) return '没有制作成功，点开查看'
  if (course.lock) return `先闯过「${course.lock.previousTitle}」`
  if (acceptance.card) return acceptance.card
  if (learnState === 'completed') return '已学完'
  if (learnState === 'in_progress') return `已学 ${course.learning.completed} / ${course.learning.total} 页`
  return course.total ? `定制课程 · ${course.total} 页` : '定制课程'
}

/** 已可学习的课程才有验收入口（课程页「去验收」）；验收状态以服务端为准。 */
function acceptanceEntry(course) {
  const acceptanceStatus = Object.prototype.hasOwnProperty.call(ACCEPTANCE_LABELS, course.acceptanceStatus) ? course.acceptanceStatus : 'not_started'
  const entry = course.canLearn ? ACCEPTANCE_LABELS[acceptanceStatus] : null
  return {
    acceptanceStatus,
    available: Boolean(entry),
    label: entry ? entry.label : '',
    hint: entry ? entry.hint : '',
    card: entry ? entry.card : ''
  }
}

/**
 * 学习进度：课程服务验收接口（GET /api/learn/agent-courses/<stageId>/acceptance）返回的 learning，
 * 已学完几页 / 共几页 / 是否学完，与验收判断「学完」同一口径（lib/course/agent-acceptance.ts readAgentCourseLearning）。
 * 没学完时最多显示 99%，免得出现「100% 却还不能验收」。
 */
function normalizeAgentLearning(raw) {
  if (!raw || typeof raw !== 'object') return null
  const total = Number(raw.total)
  const completed = Number(raw.completed)
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(completed) || completed < 0) return null
  const done = Math.min(completed, total)
  const finished = raw.allRecorded === true
  const scenes = {}
  const ordered = []
  for (const item of Array.isArray(raw.scenes) ? raw.scenes : []) {
    if (item && typeof item.sceneId === 'string' && SCENE_ID.test(item.sceneId) && LEARN_STATE_LABELS[item.state]) {
      scenes[item.sceneId] = item.state
      ordered.push({ sceneId: item.sceneId, done: item.state === 'completed' || item.counts === false })
    }
  }
  return {
    completed: done, total, finished, percent: finished ? 100 : Math.min(99, Math.round(done / total * 100)), scenes,
    beyond: finished ? {} : beyondCurrentPart(ordered, raw.parts)
  }
}

// 闯关学习（2026-11-11 用户规则：看课按章节拆的小关不能跳）：第一段没学完的之后的页都还锁着（课堂里也翻不过去）。
// 怎么分段以课程服务给的 learning.parts 为准（关卡规划按知识点切的，lib/course/quest-plan.ts）；
// 旧版课程服务没给时，按与 lib/course/quest-path.ts chapterParts 同一规则平分：1～2 页一段、3～5 页两段、再多三段。
function chapterParts(list) {
  const n = list.length
  const count = n <= 2 ? 1 : n <= 5 ? 2 : 3
  const parts = []
  for (let i = 0; i < count; i++) parts.push(list.slice(Math.round(i * n / count), Math.round((i + 1) * n / count)))
  return parts.filter((part) => part.length)
}

function plannedParts(ordered, rawParts) {
  if (!Array.isArray(rawParts) || !rawParts.length) return null
  const byId = {}
  ordered.forEach((item) => { byId[item.sceneId] = item })
  const parts = rawParts.map((part) => (Array.isArray(part && part.sceneIds) ? part.sceneIds : []).map((id) => byId[id]))
  const flat = [].concat(...parts)
  // 必须正好是这些页、顺序一致，否则不用
  if (flat.length !== ordered.length || flat.some((item, index) => !item || item !== ordered[index])) return null
  return parts
}

function beyondCurrentPart(ordered, rawParts) {
  const parts = plannedParts(ordered, rawParts) || chapterParts(ordered)
  const open = parts.findIndex((part) => !part.every((item) => item.done))
  const beyond = {}
  if (open < 0) return beyond
  parts.slice(open + 1).forEach((part) => part.forEach((item) => { beyond[item.sceneId] = true }))
  return beyond
}

/**
 * 课程详情页（learning/agent-course，设计稿 M37 课程详情）的展示字段：只用课程服务真实返回的数据。
 * 设计稿里的学科年级副标题、知识领域、积分消耗，定制课程都没有来源，不显示。
 * learning 为空（课程没做好，或学习进度没读到）时，卡片底部退回显示页数。
 */
function agentCourseDetail(course, learning = null) {
  const created = new Date(course.createdAt)
  const learnable = Boolean(course.canLearn && learning)
  const progressRow = course.isGenerating
    ? { label: '制作进度', value: `${course.percent}%`, percent: course.percent, track: true }
    : learnable
      ? { label: '学习进度', value: `${learning.percent}%`, percent: learning.percent, track: true }
      : course.status === 'completed'
        ? { label: '课程内容', value: `共 ${course.total} 页`, percent: null, track: false }
        : { label: '已做好', value: `${course.done} / ${course.total} 页`, percent: null, track: false }
  return {
    // 属于某个定制系列时写系列名（2026-10-06），学生知道这节课是哪一组定制里的
    subtitle: [
      course.series ? `系列：${course.series.title}` : '',
      course.createdAt && Number.isFinite(created.getTime()) ? `${created.getMonth() + 1}月${created.getDate()}日制作` : (course.series ? '' : '对话里安排的课程')
    ].filter(Boolean).join(' · '),
    // 学生看到「已完成」容易当成「学完了」：制作状态写「已做好」，学习状态写「已学完」。
    statusPill: course.lock ? '待解锁' : learnable
      ? (learning.finished ? '已学完' : learning.completed ? '学习进行中' : '尚未开始')
      : course.canLearn ? (course.status === 'partial' ? '部分做好' : '已做好') : course.statusLabel,
    statusTone: course.lock ? 'warm' : course.isGenerating || learnable ? 'blue' : course.status === 'failed' ? 'red' : 'green',
    progressRow,
    // 底部按钮（设计稿：开始学习 / 继续学习 / 再次学习）；没读到学习进度时写「学习课程」。
    learnAction: course.lock ? '去学上一节' : learnable ? (learning.finished ? '再次学习' : learning.completed ? '继续学习' : '开始学习') : '学习课程',
    // 锁着时详情页最上面的一张提示卡：先学完哪一节、进了复述验收才解锁
    lock: course.lock
      ? { title: '闯过上一节后解锁', text: `闯关要一关一关过：先把「${course.lock.previousTitle}」的看课、互动练习、AI 老师验收都过了，这一节才能开始。`, previousStageId: course.lock.previousStageId }
      : null,
    review: agentCourseReview(course, learning),
    pages: agentCoursePageRows(course, learning),
    // 「课程内容」标题右侧的一句：学了几页 / 做好了几页 / 共几页
    pagesSummary: course.isGenerating
      ? (course.total ? `已做好 ${course.done}/${course.total} 页` : '')
      : learnable ? `已学 ${learning.completed}/${learning.total} 页` : (course.total ? `共 ${course.total} 页` : '')
  }
}

/**
 * 「课程内容」列表：制作中显示每一页的制作状态；做好后每一页显示学没学（已学完 / 学习中 / 未学），
 * 点一下从这一页开始学（openable）。学习进度没读到时不猜，做好的页不写状态，照样可以点。
 */
function agentCoursePageRows(course, learning = null) {
  const rows = course.pages.map((page) => {
    // 后面几段的页：这一段学完才开（闯关不能跳）
    const segmentLocked = Boolean(learning && learning.beyond && page.sceneId && learning.beyond[page.sceneId])
    const openable = Boolean(course.canLearn && !course.lock && !segmentLocked && page.status === 'done' && page.sceneId)
    const learnState = openable && learning ? (learning.scenes && learning.scenes[page.sceneId]) || 'not_started' : ''
    const stateLabel = learnState
      ? LEARN_STATE_LABELS[learnState]
      : segmentLocked ? '待解锁' : !course.canLearn ? page.statusLabel : page.status === 'done' ? '' : '没有做好'
    return { ...page, openable, segmentLocked, learnState, stateLabel, isNext: false }
  })
  // 接下来该学的那一页（第一页还没学完的）在列表里点亮，和底部「继续学习」对得上
  const next = rows.find((row) => row.learnState === 'in_progress') || rows.find((row) => row.learnState === 'not_started')
  if (next) next.isNext = true
  return rows
}

// 与验收页（learning/agent-acceptance）一致：这些状态下没学完不能开始验收。
const ANSWERABLE_ACCEPTANCE = ['not_started', 'in_progress', 'ai_retry', 'teacher_rejected']

// 「复述验收」卡左侧图标（learning/review-acceptance-<icon>.svg）：只有老师确认通过才画对勾——
// 原来一可以验收就画对勾，学生一看就以为已经验收过了（2026-09-24 用户反馈）。
// talk：该学生去讲（开始 / 接着 / 重新验收）；waiting：等老师核验；passed：老师已确认；lock：还不能验收。
const REVIEW_ICONS = {
  not_started: 'talk',
  in_progress: 'talk',
  ai_retry: 'talk',
  teacher_rejected: 'talk',
  pending_teacher: 'waiting',
  teacher_passed: 'passed'
}

// 「复述验收」卡：课程做好并学完后可以去验收，标题是验收进度；否则是锁住的说明，点了只提示。
// cta：右侧按钮（去验收 / 查看）；ring：没学完时右侧画学习进度环（已学 / 共几页），一眼看出离开放还差多少。
function agentCourseReview(course, learning = null) {
  const acceptance = acceptanceEntry(course)
  if (acceptance.available && learning && !learning.finished && ANSWERABLE_ACCEPTANCE.includes(acceptance.acceptanceStatus)) {
    return {
      available: false, status: 'locked', icon: 'lock', title: '学完后开放验收',
      text: `还有 ${learning.total - learning.completed} 页没学完，学完整门课就能开始复述验收`, toast: '学完整门课后才能验收',
      cta: '', ring: { percent: learning.percent, text: `${learning.completed}/${learning.total}` }
    }
  }
  if (acceptance.available) {
    const answerable = ANSWERABLE_ACCEPTANCE.includes(acceptance.acceptanceStatus)
    return {
      available: true, status: acceptance.acceptanceStatus, icon: REVIEW_ICONS[acceptance.acceptanceStatus],
      title: acceptance.label || '开始复述验收', text: acceptance.hint, toast: '',
      cta: answerable ? '去验收' : '查看', ring: null
    }
  }
  if (course.status === 'failed') {
    return { available: false, status: 'locked', icon: 'lock', title: '课程没有制作成功', text: '回到对话里重新安排课程后，再来学习和验收', toast: '这门课程没有制作成功', cta: '', ring: null }
  }
  return { available: false, status: 'locked', icon: 'lock', title: '等待课程做好', text: '课程做好并学完后，就可以开始复述验收', toast: '课程做好后才能验收', cta: '', ring: null }
}

module.exports = {
  isAgentCourseId,
  normalizeAgentCourse,
  agentCourseLearnState,
  agentCourseCard,
  agentCourseDetail,
  normalizeAgentLearning,
  agentCoursePageRows,
  acceptanceEntry,
  ACCEPTANCE_LABELS,
  COURSE_STATUS_LABELS,
  PAGE_STATUS_LABELS,
  LEARN_STATE_LABELS
}
