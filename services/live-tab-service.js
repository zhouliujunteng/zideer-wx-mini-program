const { getLearningModel, getMeModel } = require('./mock-service')
const { hasSession, loadViewerAccess, accessOfError, loadLearningDashboard, loadMeDashboard, loadCurrentGrowthCenter, loadMemberCourseLibrary, loadAgentCourses, loadCurrentLearningCheckin, loadCourseCovers, loadCurrentFamilyRelations, loadStudyPlanDays } = require('./identity')
const { isGuardianAccount, readGuardianHasChildren, rememberGuardianHasChildren } = require('../utils/account-role')
const checkinModel = require('./checkin-model')
const learningStreak = require('./learning-streak')
const { agentCourseCard } = require('../utils/agent-course-view')

function clone(value) { return JSON.parse(JSON.stringify(value)) }
// 未登录也能浏览（2026-09-27 用户规则）：本机没有登录凭证就是游客，不发要登录的请求
function isGuest() { return typeof hasSession === 'function' && !hasSession() }
// 读取失败是因为登录失效 / 没完善学习资料时，换成访问状态（guest / profile），别的失败返回空
function accessOf(error) { return typeof accessOfError === 'function' ? accessOfError(error) : '' }
function digits(value) { return String(value).split('').map((item) => ({ first: item, second: item })) }
function overview(items) {
  return items.map((item, index) => ({
    value: String(item.value), unit: item.unit, label: item.label,
    icon: `../../assets/home/${['overview-today.svg', 'overview-streak.svg', 'overview-tasks.svg'][index]}`,
    rollDirection: 'up', rollDigits: digits(item.value)
  }))
}
// planDays：老师排好的每日学习任务，与日期条逐天对应（第 0 天是今天）；有任务的日期显示小圆点。
function calendar(tasks, selected, planDays = []) {
  const now = new Date(); const weekdays = ['周日','周一','周二','周三','周四','周五','周六']
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(now.getDate() + index); return {
    id: String(date.getTime()), date: date.getDate(), label: index === 0 ? '今天' : weekdays[date.getDay()], weekday: weekdays[date.getDay()],
    isToday: index === 0, isSelected: index === selected,
    hasTask: (index === 0 && tasks.length > 0) || Boolean(planDays[index] && planDays[index].tasks.length)
  }})
}
function taskRows(tasks) { return tasks.map((item, index) => ({ ...item, title: item.title, meta: item.meta || item.subject || '学习任务', progress: Number.isFinite(item.progress) ? item.progress : item.status === 'done' ? 100 : 0, progressText: item.progressText || (item.status === 'done' ? '100%' : '待学习'), progressLabel: item.progressLabel || '学习进度', sidePillColor: ['#CFEDE3','#F7DCCF','#DCD8F3'][index % 3] })) }
// 老师排课的任务行（课程服务 /api/learn/study-plan）：点进去从这条任务第一页没学的开始学；前几天没学完的排在今天最前面。
// 间隔复习（kind = review）排在当天最前面，点进去做复习小测。
function planTaskRows(day) {
  return (day && day.tasks || []).map((task) => task.kind === 'review' ? {
    id: `plan-${task.id}`,
    kind: 'review',
    stageId: task.stageId,
    sceneId: '',
    done: task.done,
    minutes: task.minutes,
    title: `复习：${task.title}`,
    meta: [task.overdue ? '前几天没复习' : '', '不看课程回答几个问题', task.minutes ? `约 ${task.minutes} 分钟` : ''].filter(Boolean).join(' · '),
    progress: task.progress,
    progressText: task.done ? '100%' : `${task.progress}%`
  } : {
    id: `plan-${task.id}`,
    kind: 'study-plan',
    stageId: task.stageId,
    sceneId: task.nextSceneId,
    done: task.done,
    minutes: task.minutes,
    title: task.title,
    meta: [task.overdue ? '前几天没学完' : '', task.pageLabel, task.minutes ? `约 ${task.minutes} 分钟` : ''].filter(Boolean).join(' · '),
    progress: task.progress,
    progressText: task.done ? '100%' : `${task.progress}%`
  })
}
function applyCurrentStudent(model, student) {
  if (!model || !model.student || !student) return
  const name = student.name || '同学'
  model.student.name = name
  model.student.nickname = name
  model.student.avatarText = student.initial || name.slice(0, 1)
  if (student.gradeLabel) model.student.grade = student.gradeLabel
}

// 首页只展示提分工具和会员课程（2026-09-19 设计稿），所以只读会员课程列表：未登录、没完善学习资料也能看
// （2026-09-27 用户规则）。以前先读学习计划、测评等整套首页数据，没建档时整页读不到，课程也跟着出不来。
// access 决定点课程时去哪：guest 先登录，profile 先完善学习资料，ready 按会员资格进课程或提示开通会员。
// 课程列表读取失败抛给页面显示重试，不显示「课程正在上架」；会员资格不足（旧版课程服务）才当作没有课。
async function getLiveHomeModel() {
  const [access, library] = await Promise.all([
    loadViewerAccess(),
    loadMemberCourseLibrary().catch((error) => {
      if (error && error.code === 'MEMBERSHIP_REQUIRED') return []
      throw error
    })
  ])
  const model = { notifications: { count: 0 }, access }
  model.moreCourses = library.map((course, index) => ({
    id: course.id,
    title: course.title,
    subtitle: [course.subject, course.grade ? course.grade + ' 年级' : ''].filter(Boolean).join(' · ') || '会员公共课程',
    isMember: course.isMember !== false,
    coverUrl: course.coverUrl || '',
    tone: index % 3
  }))
  model.hasLibraryAccess = library.some((course) => course.isMember !== false)
  return { model, dashboard: null }
}

// 冻结 / 复活补上的日子接得上连胜，和学习连胜页同一个口径。
function learningStreakDays(checkin) {
  if (!checkin || typeof checkinModel.streakDaysOf !== 'function') return 0
  return checkinModel.streakDaysOf(checkin)
}
// 「我的课程」卡片：定制课程（制作中的排最前）+ 学习计划课程。学习页「我的课程」与「我的课程库」共用这一份。
async function buildMyCourses(dashboard, agentCourses) {
  const planCourses = (dashboard.myCourses || dashboard.tasks || [])
    .filter((item) => item.courseInstanceId && item.canLaunch)
    .map((item, index) => {
      const meta = item.meta || item.subject || '课程学习'
      const progressText = item.progressText || '待学习'
      return {
        id: String(item.courseInstanceId),
        kind: 'plan',
        planId: item.planId,
        title: item.title,
        meta,
        // 卡片与首页「会员课程」同一结构：封面、标题、一行副标题（styles/course-grid.wxss）。
        subtitle: `${meta} · ${progressText}`,
        tag: '',
        stateLabel: item.stateLabel || (item.progressLabel === '已完成' ? '已完成' : '待学习'),
        progress: Number.isFinite(item.progress) ? item.progress : 0,
        progressText,
        contentVersionRef: item.contentVersionRef || '',
        coverUrl: '',
        tone: index % 3
      }
    })
  // 学习计划课程的封面在课程服务里，按课程内容标识批量取；取不到只显示占位底色，不影响页面。
  const covers = typeof loadCourseCovers === 'function'
    ? await loadCourseCovers(planCourses.map((course) => course.contentVersionRef)).catch(() => ({}))
    : {}
  planCourses.forEach((course) => { course.coverUrl = covers[course.contentVersionRef] || '' })
  // 智能体生成的课程无论是否生成完都进「我的课程」，生成中的排在最前并显示进度。
  const agentCards = (agentCourses || []).map((course, index) => agentCourseCard(course, index))
  return {
    courses: agentCards.filter((card) => card.isGenerating).concat(agentCards.filter((card) => !card.isGenerating), planCourses),
    hasGenerating: agentCards.some((card) => card.isGenerating)
  }
}
// 「我的课程」→「课程库」：只列学生自己的课程（定制课程 + 学习计划课程），不是会员公共课程。
// 这里是整页的主内容，读取失败要显示错误与重试，所以定制课程读不到时不吞掉错误（学习页那边吞掉是为了不影响别的区块）。
async function getMyCourseLibrary() {
  const [dashboard, agentCourses] = await Promise.all([loadLearningDashboard(), loadAgentCourses()])
  return buildMyCourses(dashboard, agentCourses)
}
// access：ready 正常；guest 未登录、profile 没完善学习资料（2026-09-27 起未登录也能浏览）——这两种没有学习任务和课程可读，
// 只给日期条等固定结构（同骨架模型），页面把任务、课程位换成去登录 / 去完善的提示。
async function getLiveLearningModel(selectedDayIndex = 0) {
  if (isGuest()) return { model: getLearningSkeletonModel(selectedDayIndex), dashboard: null, access: 'guest' }
  // 智能体课程与学习计划并行读取；读取失败不影响学习页，只是这次不显示 AI 课程。
  // 连续学习天数来自每日学习打卡（当天学完一节课或费曼验收通过算一天，冻结 / 补回的日子接得上）；读取失败显示 0，不影响学习页。
  // 打卡数据经学习连胜共享状态读（services/learning-streak.js）：与顶栏火苗入口合并成一个请求，两处的天数与点亮状态一致。
  const loadCheckin = learningStreak && typeof learningStreak.loadCheckin === 'function'
    ? () => learningStreak.loadCheckin()
    : loadCurrentLearningCheckin
  // 老师排好的每日学习任务同样并行读；读取失败只是这次不显示这些任务，不影响学习页。
  let dashboard, agentCourses, checkin, studyPlan
  try {
    [dashboard, agentCourses, checkin, studyPlan] = await Promise.all([
      loadLearningDashboard(),
      typeof loadAgentCourses === 'function' ? loadAgentCourses().catch(() => []) : Promise.resolve([]),
      typeof loadCheckin === 'function' ? loadCheckin().catch(() => null) : Promise.resolve(null),
      typeof loadStudyPlanDays === 'function' ? loadStudyPlanDays().catch(() => null) : Promise.resolve(null)
    ])
  } catch (error) {
    const access = accessOf(error)
    if (access) return { model: getLearningSkeletonModel(selectedDayIndex), dashboard: null, access }
    throw error
  }
  const planDays = studyPlan && Array.isArray(studyPlan.days) ? studyPlan.days : []
  const model = clone(getLearningModel(new Date(), 0, 0)); const tasks = taskRows(dashboard.tasks || [])
  applyCurrentStudent(model, dashboard.students[0])
  const planTasks = planTaskRows(planDays[selectedDayIndex])
  model.notifications.count = 0; model.studyTaskCalendar = calendar(tasks, selectedDayIndex, planDays)
  model.studyTasks = taskRows(planTasks.concat(selectedDayIndex === 0 ? dashboard.tasks || [] : []))
  const restDay = Boolean(planDays[selectedDayIndex] && planDays[selectedDayIndex].rest)
  model.studyTaskEmptyText = restDay ? (selectedDayIndex === 0 ? '今天是休息日，好好放松一下' : '这天是休息日，不排学习任务') : (selectedDayIndex === 0 ? '今天还没有可开始的学习任务' : '当天暂无学习任务')
  model.todoItems = (dashboard.tasks || []).map((item) => ({ id: item.id, planId: item.planId, title: item.title, meta: item.meta, status: item.status === 'done' ? 'completed' : item.status === 'active' ? 'in-progress' : 'pending' }))
  const myCourses = await buildMyCourses(dashboard, agentCourses)
  model.myCourses = myCourses.courses
  model.hasGeneratingAgentCourse = myCourses.hasGenerating
  // 「当前任务」分钟数：今天老师排的第一条没学完的任务；没有就沿用学习计划的当前任务。
  const currentPlanTask = planTaskRows(planDays[0]).find((task) => !task.done)
  model.overview = learningOverview(dashboard.summary && dashboard.summary.completed || 0, learningStreakDays(checkin), currentPlanTask ? currentPlanTask.minutes : dashboard.currentTask && dashboard.currentTask.duration || 0)
  return { model, dashboard, access: 'ready' }
}
function learningOverview(completed, streakDays, taskMinutes) {
  return overview([{ value: completed, unit: '项', label: '已完成' }, { value: streakDays, unit: '天', label: '连续学习' }, { value: taskMinutes, unit: '分钟', label: '当前任务' }])
}
// 学习页第一次读到真实数据前的骨架：日期条用真实日期，标签与真实模型一致，
// 任务、课程、数字一律留空（页面据 loaded 画灰块），不带任何演示数据。
function getLearningSkeletonModel(selectedDayIndex = 0) {
  const model = clone(getLearningModel(new Date(), 0, 0))
  model.notifications.count = 0
  model.studyTaskCalendar = calendar([], selectedDayIndex)
  model.studyTasks = []
  model.todoItems = []
  model.myCourses = []
  model.studyTaskEmptyText = ''
  model.overview = learningOverview(0, 0, 0)
  return model
}
// 家长已绑定学生：「常用入口」的「测评中心」换成「学生看板」（2026-09-25 用户规则）。
// 测评中心读的是当前账号自己的测评，对家长没有意义；学生看板看的是孩子的学情。
const STUDENT_DASHBOARD_ACTION = Object.freeze({ label: '学生看板', icon: '../../assets/me/quick-student-dashboard.svg' })

function withGuardianQuickActions(actions, showStudentDashboard) {
  if (!showStudentDashboard) return actions
  return actions.map((item) => item.label === '测评中心' ? { ...STUDENT_DASHBOARD_ACTION } : item)
}

// 只看有效关系；家庭关系读取失败时沿用上次的结果，不把入口换回去
async function guardianHasChildren() {
  try {
    const family = await loadCurrentFamilyRelations()
    const now = Date.now()
    const active = (family.students || []).filter((relation) => (!relation.status || relation.status === 'active') && (!relation.expires_at || Date.parse(relation.expires_at) > now))
    rememberGuardianHasChildren(active.length > 0)
    return active.length > 0
  } catch (error) {
    return readGuardianHasChildren()
  }
}

function baseMeModel() {
  const model = clone(getMeModel())
  model.membershipCard = model.membershipCard || {
    title: '知鹿会员',
    subtitle: '解锁更多专属学习权益',
    crownIcon: '../../assets/me/membership-crown-matte.png'
  }
  // 演示数据里的未读角标不是真实消息数，去掉，免得「消息中心」永远挂着假红点。
  model.quickActions = (model.quickActions || []).map(({ unreadCount, ...item }) => item)
  return model
}

// 游客的「我的」（2026-09-27 起未登录也能浏览）：常用入口、服务菜单照常显示（点了先去登录），
// 资料位由页面换成「登录 / 注册」，积分、金币没有账户可读，显示「—」。
function guestMeModel() {
  const model = baseMeModel()
  model.access = 'guest'
  model.profile = { name: '', id: '', initial: '', avatarUrl: '', avatarSrc: '', gradeLabel: '' }
  model.accountSummary = (model.accountSummary || []).map((item) => ({ ...item, value: '—', meta: '' }))
  return model
}

async function getLiveMeModel() {
  if (isGuest()) return guestMeModel()
  // 积分 / 金币图标沿用模型里的包内路径作素材名，由模板经 ui_asset 取后端地址（不再读推广素材表）。
  // 上次记下是家长就先并行查家庭关系；身份以本次读到的档案为准
  const childrenLookup = isGuardianAccount() ? guardianHasChildren() : null
  let dashboard, growth
  try {
    [dashboard, growth] = await Promise.all([
      loadMeDashboard(),
      loadCurrentGrowthCenter().catch(() => null)
    ])
  } catch (error) {
    // 登录已失效（凭证已作废）：按游客显示，不把整页当成读取失败
    if (accessOf(error) === 'guest') return guestMeModel()
    throw error
  }
  const model = baseMeModel()
  // 还没完善学习资料：账号资料照常显示，页面提示去完善；积分、金币账户要有学习档案才有，显示「—」
  model.access = dashboard.profile.completed === false ? 'profile' : 'ready'
  model.profile.name = dashboard.profile.displayName
  model.profile.id = String(dashboard.profile.publicId || '')
  model.profile.avatarUrl = dashboard.profile.avatarUrl || ''
  model.profile.avatarSrc = model.profile.avatarUrl
  model.profile.initial = dashboard.profile.initial
  model.profile.gradeLabel = dashboard.profile.gradeLabel
  model.accountSummary[0].value = String(dashboard.balances && dashboard.balances.coursePoints || 0)
  model.accountSummary[0].meta = `冻结 ${dashboard.balances && dashboard.balances.frozenPoints || 0}`
  model.accountSummary[1].value = String(growth && growth.coinAccount && growth.coinAccount.available || 0)
  if (model.access === 'profile') model.accountSummary = model.accountSummary.map((item) => ({ ...item, value: '—', meta: '' }))
  const isGuardian = dashboard.profile.accountType === 'guardian'
  const hasChildren = isGuardian ? await (childrenLookup || guardianHasChildren()) : false
  model.quickActions = withGuardianQuickActions(model.quickActions, hasChildren)
  if (isGuardian) model.serviceGroups = withGuardianReportItem(model.serviceGroups)
  return model
}

// 家长的「知鹿服务」第一项加「学习报告」（2026-10-07 用户规则）：老师给孩子出的学习成长报告在这里同步看到。
const GUARDIAN_REPORT_ITEM = Object.freeze({ title: '学习报告', description: '老师给孩子出的学习成长报告' })

function withGuardianReportItem(groups) {
  return (groups || []).map((group, index) => index === 0 && !(group.items || []).some((item) => item.title === GUARDIAN_REPORT_ITEM.title)
    // 知识图谱是学生的（家长底栏原本也没有图谱）
    ? { ...group, items: [{ ...GUARDIAN_REPORT_ITEM }].concat((group.items || []).filter((item) => item.title !== '知识图谱')) }
    : group)
}
module.exports = { getLiveHomeModel, getLiveLearningModel, getLearningSkeletonModel, getLiveMeModel, getMyCourseLibrary, withGuardianQuickActions, withGuardianReportItem }
