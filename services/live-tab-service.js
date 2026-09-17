const { getHomeModel, getLearningModel, getMeModel } = require('./mock-service')
const { loadHomeDashboard, loadLearningDashboard, loadMeDashboard, loadCurrentGrowthCenter, loadMemberCourseLibrary, loadUiAssetMap, loadAgentCourses } = require('./identity')
const { agentCourseCard } = require('../utils/agent-course-view')

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function digits(value) { return String(value).split('').map((item) => ({ first: item, second: item })) }
function overview(items) {
  return items.map((item, index) => ({
    value: String(item.value), unit: item.unit, label: item.label,
    icon: `../../assets/home/${['overview-today.svg', 'overview-streak.svg', 'overview-tasks.svg'][index]}`,
    rollDirection: 'up', rollDigits: digits(item.value)
  }))
}
function calendar(tasks, selected) {
  const now = new Date(); const weekdays = ['周日','周一','周二','周三','周四','周五','周六']
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(now.getDate() + index); return {
    id: String(date.getTime()), date: date.getDate(), label: index === 0 ? '今天' : weekdays[date.getDay()], weekday: weekdays[date.getDay()],
    isToday: index === 0, isSelected: index === selected, hasTask: index === 0 && tasks.length > 0
  }})
}
function taskRows(tasks) { return tasks.map((item, index) => ({ ...item, title: item.title, meta: item.meta || item.subject || '学习任务', progress: Number.isFinite(item.progress) ? item.progress : item.status === 'done' ? 100 : 0, progressText: item.progressText || (item.status === 'done' ? '100%' : '待学习'), progressLabel: item.progressLabel || '学习进度', sidePillColor: ['#CFEDE3','#F7DCCF','#DCD8F3'][index % 3] })) }
function applyCurrentStudent(model, student) {
  if (!model || !model.student || !student) return
  const name = student.name || '同学'
  model.student.name = name
  model.student.nickname = name
  model.student.avatarText = student.initial || name.slice(0, 1)
  if (student.gradeLabel) model.student.grade = student.gradeLabel
}

async function getLiveHomeModel(selectedDayIndex = 0) {
  const dashboard = await loadHomeDashboard()
  const model = clone(getHomeModel('member', new Date(), 0, 0))
  const tasks = dashboard.today && dashboard.today.currentTask ? [{ title: dashboard.today.currentTask, meta: dashboard.today.currentTaskMeta, status: 'active' }] : []
  applyCurrentStudent(model, dashboard.students[0])
  model.notifications.count = dashboard.message ? 1 : 0
  model.learningCards = taskRows(tasks)
  model.studyTaskCalendar = calendar(tasks, selectedDayIndex)
  model.studyTasks = selectedDayIndex === 0 ? taskRows(tasks) : []
  model.studyTaskEmptyText = selectedDayIndex === 0 ? '今天还没有可开始的学习任务' : '当天暂无学习任务'
  model.overview = overview([{ value: dashboard.today && dashboard.today.progress || 0, unit: '%', label: '计划进度' }, { value: dashboard.assessment && dashboard.assessment.weakCount || 0, unit: '个', label: '待巩固知识点' }, { value: dashboard.balances && dashboard.balances.coursePoints || 0, unit: '积分', label: '可用课程积分' }])
  model.plan = dashboard.plan ? {
    id: String(dashboard.plan.id),
    name: dashboard.plan.name,
    phase: dashboard.plan.phase,
    progress: dashboard.plan.progress,
    next: dashboard.plan.nextMilestone
  } : null
  const library = await loadMemberCourseLibrary().catch(() => null)
  model.moreCourses = library ? library.map((course, index) => ({
    id: course.id,
    title: course.title,
    subtitle: [course.subject, course.grade ? course.grade + ' 年级' : ''].filter(Boolean).join(' · ') || '会员公共课程',
    isMember: course.isMember !== false,
    tone: index % 3
  })) : []
  model.hasLibraryAccess = Boolean(library && library.some((course) => course.isMember !== false))
  return { model, dashboard }
}

async function getLiveLearningModel(selectedDayIndex = 0) {
  // 智能体课程与学习计划并行读取；读取失败不影响学习页，只是这次不显示 AI 课程。
  const [dashboard, agentCourses] = await Promise.all([
    loadLearningDashboard(),
    typeof loadAgentCourses === 'function' ? loadAgentCourses().catch(() => []) : Promise.resolve([])
  ])
  const model = clone(getLearningModel(new Date(), 0, 0)); const tasks = taskRows(dashboard.tasks || [])
  applyCurrentStudent(model, dashboard.students[0])
  model.notifications.count = 0; model.studyTaskCalendar = calendar(tasks, selectedDayIndex); model.studyTasks = selectedDayIndex === 0 ? tasks : []
  model.studyTaskEmptyText = selectedDayIndex === 0 ? '今天还没有可开始的学习任务' : '当天暂无学习任务'
  model.todoItems = (dashboard.tasks || []).map((item) => ({ id: item.id, planId: item.planId, title: item.title, meta: item.meta, status: item.status === 'done' ? 'completed' : item.status === 'active' ? 'in-progress' : 'pending' }))
  model.myCourses = (dashboard.myCourses || dashboard.tasks || [])
    .filter((item) => item.courseInstanceId && item.canLaunch)
    .map((item, index) => ({
      id: String(item.courseInstanceId),
      planId: item.planId,
      title: item.title,
      meta: item.meta || item.subject || '课程学习',
      stateLabel: item.stateLabel || (item.progressLabel === '已完成' ? '已完成' : '待学习'),
      progress: Number.isFinite(item.progress) ? item.progress : 0,
      progressText: item.progressText || '待学习',
      coverUrl: item.coverUrl || '',
      fallbackTone: ['mint', 'peach', 'lilac'][index % 3]
    }))
  // 智能体生成的课程无论是否生成完都进「我的课程」，生成中的排在最前并显示进度。
  const agentCards = (agentCourses || []).map((course, index) => agentCourseCard(course, index))
  model.myCourses = agentCards.filter((card) => card.isGenerating)
    .concat(agentCards.filter((card) => !card.isGenerating), model.myCourses)
  model.hasGeneratingAgentCourse = agentCards.some((card) => card.isGenerating)
  model.overview = overview([{ value: dashboard.summary && dashboard.summary.completed || 0, unit: '项', label: '已完成' }, { value: dashboard.summary && dashboard.summary.total || 0, unit: '项', label: '计划任务' }, { value: dashboard.currentTask && dashboard.currentTask.duration || 0, unit: '分钟', label: '当前任务' }])
  return { model, dashboard }
}
async function getLiveMeModel() {
  const [dashboard, growth, uiAssets] = await Promise.all([
    loadMeDashboard(),
    loadCurrentGrowthCenter().catch(() => null),
    typeof loadUiAssetMap === 'function' ? loadUiAssetMap().catch(() => ({})) : Promise.resolve({})
  ])
  const model = clone(getMeModel())
  model.membershipCard = model.membershipCard || {
    title: '知鹿会员',
    subtitle: '解锁更多专属学习权益',
    crownIcon: '../../assets/me/membership-crown-matte.png'
  }
  model.profile.name = dashboard.profile.displayName
  model.profile.id = String(dashboard.profile.publicId || '')
  model.profile.avatarUrl = dashboard.profile.avatarUrl || ''
  model.profile.avatarSrc = model.profile.avatarUrl
  model.profile.initial = dashboard.profile.initial
  model.profile.gradeLabel = dashboard.profile.gradeLabel
  model.accountSummary[0].value = String(dashboard.balances && dashboard.balances.coursePoints || 0)
  model.accountSummary[0].meta = `冻结 ${dashboard.balances && dashboard.balances.frozenPoints || 0}`
  model.accountSummary[1].value = String(growth && growth.coinAccount && growth.coinAccount.available || 0)
  if (uiAssets['ui-me-course-points']) model.accountSummary[0].icon = uiAssets['ui-me-course-points'].url
  if (uiAssets['ui-me-coins']) model.accountSummary[1].icon = uiAssets['ui-me-coins'].url
  const serviceGroup = (model.serviceGroups || []).find((group) => group.title === '知鹿服务')
  if (serviceGroup && Array.isArray(serviceGroup.items) && !serviceGroup.items.some((item) => item.title === '测评中心')) {
    serviceGroup.items.push({ title: '测评中心', description: '开始基础测评与查看测评记录' })
  }
  return model
}
module.exports = { getLiveHomeModel, getLiveLearningModel, getLiveMeModel }
