/**
 * 智能体生成课程的展示规则（纯函数）：进度页、「我的课程」共用。
 * 服务端契约见 OpenMAIC-sync `app/api/learn/agent-courses`。
 */
const AGENT_COURSE_ID = /^stage-[A-Za-z0-9_-]{1,64}$/

const COURSE_STATUS_LABELS = {
  generating: '生成中',
  completed: '已生成',
  partial: '部分生成',
  failed: '生成失败'
}

const PAGE_STATUS_LABELS = {
  pending: '排队中',
  generating: '生成中',
  done: '已完成',
  failed: '未生成'
}

const PAGE_TYPE_LABELS = {
  slide: '讲解',
  quiz: '测验',
  interactive: '互动',
  pbl: '项目'
}

function isAgentCourseId(value) {
  return typeof value === 'string' && AGENT_COURSE_ID.test(value)
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
        typeLabel: PAGE_TYPE_LABELS[page.type] || '课程页',
        status: pageStatus,
        statusLabel: PAGE_STATUS_LABELS[pageStatus]
      }
    })
  const total = Number.isSafeInteger(Number(progress.total)) ? Number(progress.total) : pages.length
  const done = Number.isSafeInteger(Number(progress.done)) ? Number(progress.done) : pages.filter((page) => page.status === 'done').length
  const percent = clampPercent(progress.percent)
  const canLearn = raw.canLearn === true
  return {
    stageId: raw.stageId,
    title: String(raw.title || 'AI 课程'),
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
    createdAt: String(raw.createdAt || '')
  }
}

function agentCourseSummary(status, done, total) {
  if (status === 'generating') return total ? `正在生成第 ${Math.min(done + 1, total)} / ${total} 页` : '正在准备课程页面'
  if (status === 'completed') return `全部 ${total} 页已生成`
  if (status === 'partial') return `已生成 ${done} / ${total} 页，可以开始学习`
  return '这门课程没有生成成功，可以回到对话里重新生成'
}

/** 「我的课程」卡片：与知鹿学习计划课程同一结构，kind=agent 区分入口。 */
function agentCourseCard(course, index = 0) {
  return {
    id: `agent:${course.stageId}`,
    kind: 'agent',
    stageId: course.stageId,
    canLearn: course.canLearn,
    isGenerating: course.isGenerating,
    title: course.title,
    meta: 'AI 定制课程',
    stateLabel: course.statusLabel,
    progress: course.isGenerating ? course.percent : course.canLearn ? 100 : 0,
    progressText: course.isGenerating ? `${course.percent}%` : course.canLearn ? '待学习' : '未完成',
    coverUrl: '',
    fallbackTone: ['mint', 'peach', 'lilac'][index % 3]
  }
}

module.exports = {
  isAgentCourseId,
  normalizeAgentCourse,
  agentCourseCard,
  COURSE_STATUS_LABELS,
  PAGE_STATUS_LABELS
}
