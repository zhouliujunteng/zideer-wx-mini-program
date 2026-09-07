const {
  homeModels,
  homeStudyDayProfiles,
  overviewIconSources,
  learningModel,
  knowledgeMapModel,
  meModel,
  DEFAULT_KNOWLEDGE_MAP_COURSE_ID,
  KNOWLEDGE_MAP_STRESS_COURSE_ID,
  getDefaultKnowledgeMapStressCourseSource
} = require('../data/mock/tab-data')

const STUDY_TASK_PILL_COLORS = [
  '#CFEDE3',
  '#F7DCCF',
  '#DCD8F3',
  '#F1E5B5',
  '#CEE7F3',
  '#EFD5E2',
  '#D9EBC7',
  '#F6E0C0',
  '#D6E1F3',
  '#E4DCCB'
]

function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

function getStartOfDay(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date()
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getRelativeDateLabel(dayIndex, date) {
  if (dayIndex === 0) return '今天'
  if (dayIndex === 1) return '明天'
  if (dayIndex === 2) return '后天'
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
}

function getStudyDayIndex(value) {
  const number = Number(value)
  if (!Number.isInteger(number)) return 0
  return Math.max(0, Math.min(homeStudyDayProfiles.length - 1, number))
}

function buildStudyTaskCalendar(now, selectedDayIndex) {
  const start = getStartOfDay(now)
  return homeStudyDayProfiles.map((profile, dayIndex) => {
    const date = new Date(start)
    date.setDate(start.getDate() + dayIndex)
    return {
      id: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      label: getRelativeDateLabel(dayIndex, date),
      isSelected: dayIndex === selectedDayIndex,
      hasTask: profile.hasTask
    }
  })
}

function buildLearningTaskCalendar(now, selectedDayIndex) {
  const start = getStartOfDay(now)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return homeStudyDayProfiles.map((profile, dayIndex) => {
    const date = new Date(start)
    date.setDate(start.getDate() + dayIndex)
    return {
      id: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      date: date.getDate(),
      weekday: weekdays[date.getDay()],
      isToday: dayIndex === 0,
      isSelected: dayIndex === selectedDayIndex,
      hasTask: profile.hasTask
    }
  })
}

function buildRollingDigits(previousValue, currentValue, rollDirection) {
  const previous = String(previousValue)
  const current = String(currentValue)
  const width = Math.max(previous.length, current.length)
  const previousChars = `${'\u00a0'.repeat(width - previous.length)}${previous}`.split('')
  const currentChars = `${'\u00a0'.repeat(width - current.length)}${current}`.split('')
  return currentChars.map((value, index) => rollDirection === 'down'
    ? { first: value, second: previousChars[index] }
    : { first: previousChars[index], second: value }
  )
}

function buildOverview(summary, previousSummary) {
  return summary.map((item, index) => {
    const previousValue = previousSummary[index].value
    const rollDirection = Number(item.value) < Number(previousValue) ? 'down' : 'up'
    return {
      ...item,
      icon: overviewIconSources[index],
      rollDirection,
      rollDigits: buildRollingDigits(previousValue, item.value, rollDirection)
    }
  })
}

function addStudyTaskPillColors(tasks, dayIndex) {
    return clone(tasks).map((task, index) => ({
      ...task,
      sidePillColor: STUDY_TASK_PILL_COLORS[(index * 3 + dayIndex * 4) % STUDY_TASK_PILL_COLORS.length]
  }))
}

const TODO_STATUS_ORDER = {
  completed: 0,
  'in-progress': 1,
  pending: 2
}

function sortTodoItems(items) {
  return clone(items).sort((left, right) => {
    const leftOrder = Object.prototype.hasOwnProperty.call(TODO_STATUS_ORDER, left.status)
      ? TODO_STATUS_ORDER[left.status]
      : TODO_STATUS_ORDER.pending
    const rightOrder = Object.prototype.hasOwnProperty.call(TODO_STATUS_ORDER, right.status)
      ? TODO_STATUS_ORDER[right.status]
      : TODO_STATUS_ORDER.pending
    return leftOrder - rightOrder
  })
}

function getHomeModel(mode, now, selectedDayIndex, previousDayIndex, selectedCourseCategory) {
  const model = clone(homeModels[mode] || homeModels.member)
  if (model.mode !== 'member') {
    const availableCategoryIds = model.courseCategories.map((category) => category.id)
    const activeCategoryId = availableCategoryIds.includes(selectedCourseCategory)
      ? selectedCourseCategory
      : 'all'
    model.courseCategories = model.courseCategories.map((category) => ({
      ...category,
      isSelected: category.id === activeCategoryId
    }))
    model.featuredCourses = activeCategoryId === 'all'
      ? model.courseCatalog
      : model.courseCatalog.filter((course) => course.categoryId === activeCategoryId)
    delete model.courseCatalog
    return model
  }

  const activeDayIndex = getStudyDayIndex(selectedDayIndex)
  const previousActiveDayIndex = getStudyDayIndex(
    typeof previousDayIndex === 'undefined' ? activeDayIndex : previousDayIndex
  )
  const profile = homeStudyDayProfiles[activeDayIndex]
  const previousProfile = homeStudyDayProfiles[previousActiveDayIndex]
  const studyTaskCalendar = buildStudyTaskCalendar(now, activeDayIndex)
  model.studyTaskCalendar = studyTaskCalendar
  model.overview = buildOverview(profile.overview, previousProfile.overview)
  model.studyTasks = addStudyTaskPillColors(profile.studyTasks, activeDayIndex)
  model.studyTaskEmptyText = activeDayIndex === 0
    ? '今天没有学习任务'
    : `${studyTaskCalendar[activeDayIndex].label}没有学习任务`
  return model
}

function getLearningModel(now, selectedDayIndex, previousDayIndex) {
  const model = clone(learningModel)
  const activeDayIndex = getStudyDayIndex(selectedDayIndex)
  const previousActiveDayIndex = getStudyDayIndex(
    typeof previousDayIndex === 'undefined' ? activeDayIndex : previousDayIndex
  )
  const start = getStartOfDay(now)
  const calendar = buildLearningTaskCalendar(start, activeDayIndex)
  const profile = homeStudyDayProfiles[activeDayIndex]
  const previousProfile = homeStudyDayProfiles[previousActiveDayIndex]

  model.calendarTitle = `${start.getFullYear()}年${start.getMonth() + 1}月`
  model.calendarShortcutLabel = activeDayIndex === 0 ? '今日' : (activeDayIndex === 1 ? '明日' : '')
  model.canReturnToToday = activeDayIndex !== 0
  model.studyTaskCalendar = calendar
  // 与首页一致：按所选演示日期展示汇总，并提供逐字符数值翻滚所需字段。
  model.overview = buildOverview(profile.overview, previousProfile.overview)
  model.studyTasks = addStudyTaskPillColors(profile.studyTasks, activeDayIndex)
  // 待办事项与选中的日期 profile 同步变化。
  model.todoItems = sortTodoItems(profile.todoItems || [])
  model.studyTaskEmptyText = activeDayIndex === 0
    ? '今天没有学习任务'
    : `${calendar[activeDayIndex].weekday}没有学习任务`
  return model
}

function getKnowledgeMapLearningSummary(nodes) {
  const topicsByStatus = nodes.reduce((result, node) => {
    result[node.status].push(node)
    return result
  }, { mastered: [], reinforce: [], learning: [], unknown: [] })
  const masteredNames = topicsByStatus.mastered.map((topic) => topic.label)
  const reinforceTopic = topicsByStatus.reinforce.find((topic) => topic.nodeType !== 'domain_root') || topicsByStatus.reinforce[0]
  const learningTopic = topicsByStatus.learning.find((topic) => topic.nodeType !== 'domain_root') || topicsByStatus.learning[0]
  const clauses = []

  if (masteredNames.length > 2) {
    clauses.push(`目前已掌握${masteredNames.slice(0, 2).join('、')}等${masteredNames.length}个知识点`)
  } else if (masteredNames.length) {
    clauses.push(`目前已掌握${masteredNames.join('、')}`)
  } else {
    clauses.push('目前还没有已掌握的知识点')
  }
  if (reinforceTopic) clauses.push(`${reinforceTopic.label}还需巩固`)
  if (learningTopic) clauses.push(`${learningTopic.label}正在学习`)
  if (topicsByStatus.unknown.length) clauses.push(`另有${topicsByStatus.unknown.length}个知识点尚待了解`)

  return `${clauses.join('；')}。`
}

function indexRecords(records, key) {
  const result = Object.create(null)
  records.forEach((record) => { result[record[key]] = record })
  return result
}

function getCourseSummary(course) {
  return {
    id: course.id,
    title: course.title,
    meta: course.meta,
    progress: course.progress,
    progressLabel: course.progress === null ? '极限' : `${course.progress}%`,
    hasProgress: course.progress !== null,
    isStressFixture: Boolean(course.isStressFixture)
  }
}

function getKnowledgeMapModel(selectedCourseId) {
  const stressCourse = getDefaultKnowledgeMapStressCourseSource()
  const courses = [stressCourse, ...knowledgeMapModel.courses]
  const defaultCourse = courses.find((course) => course.id === DEFAULT_KNOWLEDGE_MAP_COURSE_ID) || stressCourse
  const requestedCourseId = selectedCourseId || defaultCourse.id
  const activeCourse = courses.find((course) => course.id === requestedCourseId) || defaultCourse
  const records = activeCourse.records
  const layoutByTopicId = indexRecords(records.图谱布局, '所属知识点_id')
  const masteryByTopicId = indexRecords(records.学生知识点掌握, '所属知识点_id')
  const progressByTopicId = indexRecords(records.知识点学习进度, '知识点ID')

  // 适配层连接数据库式记录；Canvas 数据留在逻辑层，不进入 setData/WXML。
  const nodes = records.知识点.map((topic) => {
    const layout = layoutByTopicId[topic.id]
    const mastery = masteryByTopicId[topic.id]
    const learningProgress = progressByTopicId[topic.id]
    return {
      id: topic.id,
      key: topic.知识点标识,
      label: topic.知识点名称,
      status: mastery ? mastery.掌握状态 : 'unknown',
      nodeType: topic.节点类型,
      coreScore: topic.核心度,
      description: topic.知识说明,
      layout: {
        x: layout.横坐标,
        y: layout.纵坐标,
        level: layout.层级,
        viewKey: layout.视图标识,
        layoutStatus: layout.布局状态
      },
      mastery: mastery && {
        score: mastery.掌握分数,
        confidence: mastery.置信度,
        evidenceCount: mastery.证据数量,
        algorithmVersion: mastery.算法版本
      },
      learningStatus: learningProgress && learningProgress.学习状态
    }
  })
  const edges = records.知识依赖.map((dependency) => ({
    id: dependency.id,
    from: dependency.前置知识点_id,
    to: dependency.目标知识点_id,
    strength: dependency.前置强度,
    type: dependency.前置强度 === 'hard' ? 'solid' : 'dashed',
    description: dependency.关系说明
  }))
  const activeCourseSummary = getCourseSummary(activeCourse)
  const viewModel = {
    student: clone(knowledgeMapModel.student),
    notifications: clone(knowledgeMapModel.notifications),
    legend: clone(knowledgeMapModel.legend),
    courses: courses.map(getCourseSummary),
    activeCourseId: activeCourse.id,
    activeCourse: activeCourseSummary,
    learningSummary: getKnowledgeMapLearningSummary(nodes),
    tip: knowledgeMapModel.tip,
    isStressFixture: Boolean(activeCourse.isStressFixture),
    stressLabel: activeCourse.isStressFixture ? `${nodes.length} 个节点 · ${edges.length} 条连线` : ''
  }
  return { viewModel, graphModel: { nodes, edges } }
}

function getMeModel() {
  return clone(meModel)
}

module.exports = { getHomeModel, getLearningModel, getKnowledgeMapModel, getMeModel }
