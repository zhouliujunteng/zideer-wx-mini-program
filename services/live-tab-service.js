const { getHomeModel, getLearningModel, getMeModel } = require('./mock-service')
const { loadHomeDashboard, loadLearningDashboard, loadMeDashboard, loadCurrentGrowthCenter } = require('./identity')

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
function taskRows(tasks) { return tasks.map((item, index) => ({ title: item.title, meta: item.meta || item.subject || '学习任务', progress: item.status === 'done' ? 100 : 0, sidePillColor: ['#CFEDE3','#F7DCCF','#DCD8F3'][index % 3] })) }

async function getLiveHomeModel(selectedDayIndex = 0) {
  const dashboard = await loadHomeDashboard(); const model = clone(getHomeModel('member', new Date(), 0, 0))
  const tasks = dashboard.today && dashboard.today.currentTask ? [{ title: dashboard.today.currentTask, meta: dashboard.today.currentTaskMeta, status: 'active' }] : []
  model.student.nickname = dashboard.students[0] && dashboard.students[0].name || '同学'
  model.notifications.count = dashboard.message ? 1 : 0
  model.learningCards = taskRows(tasks)
  model.studyTaskCalendar = calendar(tasks, selectedDayIndex)
  model.studyTasks = taskRows(tasks)
  model.studyTaskEmptyText = selectedDayIndex === 0 ? '今天还没有可开始的学习任务' : '当天暂无学习任务'
  model.overview = overview([{ value: dashboard.today && dashboard.today.progress || 0, unit: '%', label: '计划进度' }, { value: dashboard.assessment && dashboard.assessment.weakCount || 0, unit: '个', label: '待巩固知识点' }, { value: dashboard.balances && dashboard.balances.coursePoints || 0, unit: '积分', label: '可用课程积分' }])
  return { model, dashboard }
}

async function getLiveLearningModel(selectedDayIndex = 0) {
  const dashboard = await loadLearningDashboard(); const model = clone(getLearningModel(new Date(), 0, 0)); const tasks = taskRows(dashboard.tasks || [])
  model.notifications.count = 0; model.studyTaskCalendar = calendar(tasks, selectedDayIndex); model.studyTasks = selectedDayIndex === 0 ? tasks : []
  model.studyTaskEmptyText = selectedDayIndex === 0 ? '今天还没有可开始的学习任务' : '当天暂无学习任务'
  model.todoItems = (dashboard.tasks || []).map((item) => ({ title: item.title, meta: item.meta, status: item.status === 'done' ? 'completed' : item.status === 'active' ? 'in-progress' : 'pending' }))
  model.overview = overview([{ value: dashboard.summary && dashboard.summary.completed || 0, unit: '项', label: '已完成' }, { value: dashboard.summary && dashboard.summary.total || 0, unit: '项', label: '计划任务' }, { value: dashboard.currentTask && dashboard.currentTask.duration || 0, unit: '分钟', label: '当前任务' }])
  return { model, dashboard }
}
async function getLiveMeModel() {
  const [dashboard, growth] = await Promise.all([loadMeDashboard(), loadCurrentGrowthCenter().catch(() => null)])
  const model = clone(getMeModel())
  model.profile.name = dashboard.profile.displayName
  model.profile.id = String(dashboard.profile.id)
  model.accountSummary[0].value = String(dashboard.balances && dashboard.balances.coursePoints || 0)
  model.accountSummary[0].meta = `冻结 ${dashboard.balances && dashboard.balances.frozenPoints || 0}`
  model.accountSummary[1].value = String(growth && growth.coinAccount && growth.coinAccount.available || 0)
  return model
}
module.exports = { getLiveHomeModel, getLiveLearningModel, getLiveMeModel }
