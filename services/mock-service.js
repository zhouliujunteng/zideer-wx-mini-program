const {
  homeModels,
  homeStudyDayProfiles,
  overviewIconSources,
  learningModel,
  knowledgeMapModel,
  meModel,
  DEFAULT_KNOWLEDGE_MAP_COURSE_ID,
  KNOWLEDGE_MAP_STRESS_COURSE_ID,
  getDefaultKnowledgeMapStressCourseSource,
  agentChatModel
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
      label: dayIndex === 0 ? '今天' : weekdays[date.getDay()],
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

// The voice page owns the recorder and conversation lifecycle. This model only
// supplies copy and state labels so that the page can render without importing
// the UI reference repository's mock data bundle.
function getAiVoiceConversationModel(conversationId, state, prompt) {
  const states = {
    idle: { id: 'idle', label: '准备好了', description: '点击麦克风开始本地声音可视化', previewLabel: '空闲' },
    'requesting-permission': { id: 'requesting-permission', label: '正在请求麦克风权限…', description: '授权后声音仅在设备本地用于动画', previewLabel: '请求权限' },
    recording: { id: 'recording', label: '正在听…', description: '声音只用于本地动画，不会转写或上传', neutralDescription: '当前环境未提供实时音量，正在显示中性呼吸动画', previewLabel: '聆听' },
    transcribing: { id: 'transcribing', label: '语音处理中…', description: '当前服务暂未连接语音转写', previewLabel: '处理中' },
    thinking: { id: 'thinking', label: 'AI 正在思考…', description: '当前服务暂未连接实时对话', previewLabel: '思考' },
    speaking: { id: 'speaking', label: 'AI 正在回复…', description: '当前服务暂未连接语音播放', previewLabel: '回复' },
    interrupted: { id: 'interrupted', label: '对话已中断', description: '点击麦克风后可重新开始本地采集', previewLabel: '中断' },
    paused: { id: 'paused', label: '麦克风已关闭', description: '点击麦克风可继续本地声音可视化', previewLabel: '暂停' },
    failed: { id: 'failed', label: '暂时无法启动麦克风', description: '请检查系统状态后点击麦克风重试', previewLabel: '失败' },
    'permission-denied': { id: 'permission-denied', label: '麦克风权限未开启', description: '点击麦克风，根据提示前往设置开启', previewLabel: '权限关闭' }
  }
  const activeState = Object.prototype.hasOwnProperty.call(states, state) ? state : 'idle'
  const initialPrompt = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim().slice(0, 500)
    : '你好呀，我想聊聊今天的学习。'
  const conversation = {
    id: conversationId || 'welcome',
    title: 'AI 语音对话',
    messages: [
      { id: 'welcome-user', role: 'user', text: initialPrompt },
      { id: 'welcome-ai', role: 'assistant', text: '当然可以。麦克风开启后，我会在本地显示声音状态。' }
    ]
  }
  return {
    conversation,
    voiceState: activeState,
    currentState: states[activeState],
    states,
    statePreviews: Object.keys(states).map((id) => ({ ...states[id], isSelected: id === activeState })),
    header: { subtitleOnLabel: '关闭字幕', subtitleOffLabel: '开启字幕', moreLabel: '打开调试面板' },
    transcript: { userLabel: '你', assistantLabel: 'AI', expandLabel: '展开字幕', collapseLabel: '收起字幕' },
    controls: [{ id: 'microphone', onLabel: '关闭麦克风', offLabel: '开启麦克风', retryLabel: '重新尝试开启麦克风' }, { id: 'end', label: '结束对话' }],
    waveform: { accessibleLabel: '本地麦克风音量指示器', levelModes: { waiting: '等待实时音量', live: '实时音量可用', neutral: '当前无实时音量' } },
    debugPanel: { title: '调试面板', noticeTitle: '本地声音状态', notice: '录音只用于当前页面的本地可视化，不会上传录音。', closeLabel: '关闭调试面板', presetTitle: '预设对话', presetHint: '选择一段本地字幕预览。', stateTitle: '状态预览', stateHint: '仅用于检查页面状态。', demoBadge: '本地预览' },
    privacy: { shortLabel: '本地处理', temporaryFileNote: '录音停止后立即清理临时文件' },
    presets: [{ id: 'welcome', label: '学习问候', userText: conversation.messages[0].text }],
    errors: { settingsUnavailable: '无法打开系统设置', startFailed: '麦克风启动失败', unsupportedRecorder: '当前环境不支持录音' },
    permissionDialog: { title: '需要麦克风权限', content: '开启后才能显示本地声音状态。' }
  }
}

function getProfileModel(savedValues = {}) {
  const grade = savedValues.grade || '五年级'
  const semester = savedValues.semester || '上学期'
  const textbookCards = ['统编版', '人教版', '北师大版', '苏教版', '浙教版', '其他版本'].map((value) => ({
    value,
    label: value,
    covers: ['language', 'math', 'english'].map((subject, index) => ({
      role: ['fan-card-back', 'fan-card-middle', 'fan-card-front'][index],
      src: `../../assets/profile-setup/textbook-covers/${value === '人教版' ? 'pep' : value === '北师大版' ? 'beishi' : value === '苏教版' ? 'sujiao' : value === '浙教版' ? 'zhejiang' : value === '其他版本' ? 'other' : 'unified'}-${subject}.jpg`
    }))
  }))
  return {
    title: '个人资料',
    name: savedValues.name || '周流君腾',
    avatarSrc: savedValues.avatarSrc || '',
    rows: [
      { id: 'region', label: '所在地区', value: savedValues.region || '未设置', action: 'region' },
      { id: 'school', label: '所在学校', value: savedValues.school || '未设置', action: 'school' },
      { id: 'grade', label: '年级与学期', value: `${grade}${semester}`, action: 'grade' },
      { id: 'birthday', label: '生日', value: savedValues.birthday || '未设置', action: 'birthday' },
      { id: 'textbook', label: '教材版本', value: savedValues.textbook || '未设置', action: 'textbook' }
    ],
    footerNote: '资料仅用于匹配学习内容，你可以随时修改。',
    gradeRows: Array.from({ length: 12 }, (_, index) => ({ grade: `${index + 1}年级`, options: [{ semester: '上学期', label: '上学期' }, { semester: '下学期', label: '下学期' }] })),
    textbookCards
  }
}



function getAgentChatModel(conversationId, state) {
  const model = clone(agentChatModel)
  const activeStateId = Object.prototype.hasOwnProperty.call(model.states, state)
    ? state
    : (model.messages.length ? 'completed' : 'ready')
  model.conversationId = conversationId || 'local-demo'
  model.currentState = model.states[activeStateId]
  model.messages = Array.isArray(model.messages)
    ? model.messages.map((message) => ({ ...message }))
    : []
  return model
}

module.exports = {
  getAgentChatModel, getHomeModel, getLearningModel, getKnowledgeMapModel, getMeModel, getProfileModel, getAiVoiceConversationModel }
