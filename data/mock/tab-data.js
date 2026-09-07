const student = {
  name: '林知夏',
  nickname: '核蛋拌面',
  grade: '五年级',
  subject: '数学',
  avatarText: '知'
}

const overviewIconSources = [
  '../../assets/home/overview-today.svg',
  '../../assets/home/overview-streak.svg',
  '../../assets/home/overview-tasks.svg'
]

// 以下 0–6 项分别对应“今天起的第 0–6 天”，首页与学习页共用；日期文案由 mock service 按设备当前日期生成。
const homeStudyDayProfiles = [
  {
    hasTask: false,
    overview: [
      { value: '40', unit: '分钟', label: '学习时长' },
      { value: '7', unit: '天', label: '连续学习' },
      { value: '0', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [],
    todoItems: [
      { title: '课后复盘记录', meta: '分数应用题 · 已完成', status: 'completed' },
      { title: '真人陪跑答疑', meta: '数学老师 · 待开始', status: 'in-progress' },
      { title: '用自己的话讲一遍', meta: '费曼验收 · 小数乘法进阶', status: 'pending' },
      { title: '整理错题卡片', meta: '错题本 · 本周复盘', status: 'pending' },
      { title: '查看老师反馈', meta: '上一节课 · 学习建议', status: 'completed' }
    ]
  },
  {
    hasTask: true,
    overview: [
      { value: '55', unit: '分钟', label: '学习时长' },
      { value: '8', unit: '天', label: '连续学习' },
      { value: '4', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [
      { title: '小数乘法进阶', meta: '课堂 03 · 预计 20 分钟', progress: 52 },
      { title: '面积单位换算', meta: '课堂 01 · 预计 16 分钟', progress: 36 },
      { title: '分数应用题', meta: '课堂 04 · 预计 24 分钟', progress: 18 },
      { title: '方程思维训练', meta: '课堂 02 · 预计 15 分钟', progress: 64 }
    ],
    todoItems: [
      { title: '预习面积单位换算', meta: '明日课程 · 预计 8 分钟', status: 'pending' },
      { title: '真人陪跑答疑', meta: '数学老师 · 已预约', status: 'in-progress' },
      { title: '领取课堂资料', meta: '小数乘法进阶 · 已完成', status: 'completed' },
      { title: '标记重点例题', meta: '方程思维训练 · 课前准备', status: 'pending' },
      { title: '完成课前小测', meta: '面积单位换算 · 已完成', status: 'completed' }
    ]
  },
  {
    hasTask: true,
    overview: [
      { value: '30', unit: '分钟', label: '学习时长' },
      { value: '9', unit: '天', label: '连续学习' },
      { value: '3', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [
      { title: '分数应用题', meta: '课堂 04 · 预计 24 分钟', progress: 18 },
      { title: '方程思维训练', meta: '课堂 02 · 预计 15 分钟', progress: 64 },
      { title: '图形面积专项', meta: '课堂 01 · 待继续学习', progress: 40 }
    ],
    todoItems: [
      { title: '整理错题卡片', meta: '分数应用题 · 待处理', status: 'pending' },
      { title: '用自己的话讲一遍', meta: '方程思维训练 · 待验收', status: 'in-progress' },
      { title: '查看老师反馈', meta: '图形面积专项 · 已完成', status: 'completed' },
      { title: '补充一条解题思路', meta: '分数应用题 · 待处理', status: 'pending' },
      { title: '上传课堂笔记', meta: '方程思维训练 · 待处理', status: 'pending' }
    ]
  },
  {
    hasTask: false,
    overview: [
      { value: '65', unit: '分钟', label: '学习时长' },
      { value: '10', unit: '天', label: '连续学习' },
      { value: '0', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [],
    todoItems: [
      { title: '查看下周学习安排', meta: '学习计划 · 待处理', status: 'pending' },
      { title: '更新可用学习时间', meta: '学习档案 · 已完成', status: 'completed' },
      { title: '确认周末学习时段', meta: '学习计划 · 待处理', status: 'pending' },
      { title: '阅读学习提醒', meta: '消息中心 · 已完成', status: 'completed' }
    ]
  },
  {
    hasTask: true,
    overview: [
      { value: '45', unit: '分钟', label: '学习时长' },
      { value: '11', unit: '天', label: '连续学习' },
      { value: '5', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [
      { title: '统计与可能性', meta: '课堂 03 · 预计 18 分钟', progress: 48 },
      { title: '几何图形复习', meta: '课堂 02 · 预计 14 分钟', progress: 34 },
      { title: '计算能力提升', meta: '课堂 01 · 待继续学习', progress: 82 },
      { title: '小数除法巩固', meta: '课堂 04 · 预计 16 分钟', progress: 27 },
      { title: '综合应用题', meta: '课堂 05 · 预计 22 分钟', progress: 12 }
    ],
    todoItems: [
      { title: '完成课前小测', meta: '统计与可能性 · 待处理', status: 'pending' },
      { title: '真人陪跑答疑', meta: '数学老师 · 进行中', status: 'in-progress' },
      { title: '复盘课堂笔记', meta: '几何图形复习 · 已完成', status: 'completed' },
      { title: '整理公式卡片', meta: '几何图形复习 · 待处理', status: 'pending' },
      { title: '记录错题原因', meta: '计算能力提升 · 已完成', status: 'completed' }
    ]
  },
  {
    hasTask: false,
    overview: [
      { value: '20', unit: '分钟', label: '学习时长' },
      { value: '12', unit: '天', label: '连续学习' },
      { value: '0', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [],
    todoItems: [
      { title: '整理本周错题', meta: '错题本 · 待处理', status: 'pending' },
      { title: '上传复述录音', meta: '费曼验收 · 已完成', status: 'completed' },
      { title: '清理收藏课程', meta: '课程资料 · 待处理', status: 'pending' },
      { title: '查看本周报告', meta: '学习报告 · 已完成', status: 'completed' },
      { title: '补看错过的讲解', meta: '课程回放 · 待处理', status: 'pending' }
    ]
  },
  {
    hasTask: false,
    overview: [
      { value: '70', unit: '分钟', label: '学习时长' },
      { value: '13', unit: '天', label: '连续学习' },
      { value: '0', unit: '个', label: '剩余任务' }
    ],
    studyTasks: [],
    todoItems: [
      { title: '制定下周目标', meta: '学习计划 · 待处理', status: 'pending' },
      { title: '查看学习报告', meta: '本周总结 · 已完成', status: 'completed' },
      { title: '预约老师答疑', meta: '真人陪跑 · 待开始', status: 'in-progress' },
      { title: '挑选下周课程', meta: '课程安排 · 待处理', status: 'pending' },
      { title: '更新学习目标', meta: '学习档案 · 已完成', status: 'completed' }
    ]
  }
]

const homeModels = {
  guest: {
    mode: 'guest',
    notifications: { count: 0 },
    hero: {
      searchPlaceholder: '搜索课程'
    },
    promotionalBanners: [
      { id: 'guest-banner-1', backgroundColor: '#EFB5A7' },
      { id: 'guest-banner-2', backgroundColor: '#AFCFC0' },
      { id: 'guest-banner-3', backgroundColor: '#BCC5E8' },
      { id: 'guest-banner-4', backgroundColor: '#E8D4A8' },
      { id: 'guest-banner-5', backgroundColor: '#D5BDD9' }
    ],
    courseCategories: [
      { id: 'all', label: '全部' },
      { id: 'math', label: '数学思维' },
      { id: 'chinese', label: '语文阅读' },
      { id: 'english', label: '英语启蒙' }
    ],
    courseCatalog: [
      { id: 'course-math-1', categoryId: 'math', title: '小数乘法进阶', subtitle: '五年级数学 · 12 讲', priceLabel: '¥199' },
      { id: 'course-math-2', categoryId: 'math', title: '图形面积专项', subtitle: '五年级数学 · 8 讲', priceLabel: '¥159' },
      { id: 'course-math-3', categoryId: 'math', title: '分数应用题', subtitle: '五年级数学 · 10 讲', priceLabel: '¥179' },
      { id: 'course-chinese-1', categoryId: 'chinese', title: '阅读理解方法课', subtitle: '五年级语文 · 10 讲', priceLabel: '¥169' },
      { id: 'course-chinese-2', categoryId: 'chinese', title: '写作表达启蒙', subtitle: '四至六年级 · 8 讲', priceLabel: '¥149' },
      { id: 'course-chinese-3', categoryId: 'chinese', title: '小古文轻松读', subtitle: '五年级语文 · 6 讲', priceLabel: '¥129' },
      { id: 'course-english-1', categoryId: 'english', title: '自然拼读入门', subtitle: '英语基础 · 12 讲', priceLabel: '¥189' },
      { id: 'course-english-2', categoryId: 'english', title: '核心词汇训练', subtitle: '英语基础 · 9 讲', priceLabel: '¥159' },
      { id: 'course-english-3', categoryId: 'english', title: '英语分级阅读', subtitle: '四至六年级 · 8 讲', priceLabel: '¥159' }
    ]
  },
  member: {
    mode: 'member',
    student,
    brand: '知鹿私课',
    notifications: { count: 3 },
    hero: {
      title: '今天继续学一点'
    },
    learningCards: [
      { title: '分数与方程', className: '分数与方程 · 课堂 02', progress: 62 },
      { title: '同分母加减', className: '同分母加减 · 课堂 01', progress: 84 },
      { title: '几何图形与面积', className: '几何图形与面积 · 课堂 03', progress: 35 },
      { title: '小数除法', className: '小数除法 · 课堂 04', progress: 48 },
      { title: '统计与可能性', className: '统计与可能性 · 课堂 05', progress: 26 }
    ],
    plan: {
      name: '秋季数学提升计划',
      phase: '第 2 阶段 · 夯实基础',
      progress: 68,
      next: '今天完成 2 个知识点'
    },
    activityBanners: [
      { id: 'activity-1', backgroundColor: '#EFB5A7' },
      { id: 'activity-2', backgroundColor: '#AFCFC0' },
      { id: 'activity-3', backgroundColor: '#BCC5E8' }
    ],
    moreCourses: [
      { title: '小数乘法进阶', subtitle: '五年级数学 · 12 讲', price: '199' },
      { title: '图形面积专项', subtitle: '五年级数学 · 8 讲', price: '159' },
      { title: '分数应用题', subtitle: '五年级数学 · 10 讲', price: '179' },
      { title: '方程思维训练', subtitle: '五年级数学 · 9 讲', price: '169' },
      { title: '小数除法巩固', subtitle: '五年级数学 · 6 讲', price: '129' },
      { title: '统计与可能性', subtitle: '五年级数学 · 7 讲', price: '139' },
      { title: '几何图形复习', subtitle: '五年级数学 · 8 讲', price: '149' },
      { title: '计算能力提升', subtitle: '五年级数学 · 10 讲', price: '189' }
    ]
  }
}

const learningModel = {
  student,
  notifications: { count: 3 }
}

// 图谱 mock 与 Zion 表拆分保持一致：坐标属于“图谱布局”，连接属于“知识依赖”，
// 状态由学习进度及学生掌握记录派生。页面不直接拼装数据库式记录。
const DEFAULT_KNOWLEDGE_MAP_COURSE_ID = 'stress-200'
const KNOWLEDGE_MAP_STRESS_COURSE_ID = 'stress-200'
const GRAPH_VERSION_ID = 1
const DEMO_ACCOUNT_ID = 10001
const DEMO_STUDENT_PROFILE_ID = 20001
const MASTERY_PRESETS = {
  unknown: { 掌握状态: 'unknown', 掌握分数: 0, 置信度: 0, 证据数量: 0, 学习状态: 'not_started' },
  reinforce: { 掌握状态: 'reinforce', 掌握分数: 42, 置信度: 0.66, 证据数量: 3, 学习状态: 'in_progress' },
  learning: { 掌握状态: 'learning', 掌握分数: 63, 置信度: 0.74, 证据数量: 5, 学习状态: 'in_progress' },
  mastered: { 掌握状态: 'mastered', 掌握分数: 90, 置信度: 0.92, 证据数量: 8, 学习状态: 'completed' }
}
const SUBJECT_IDS = { 数学: 11, 语文: 12 }

function createGraphCourse({ id, title, meta, progress, subjectName, domainName, recordBase, topics, dependencies, isStressFixture = false }) {
  const subjectId = SUBJECT_IDS[subjectName] || recordBase + 1
  const domainId = recordBase + 10
  const topicIdByKey = {}
  topics.forEach((topic, index) => { topicIdByKey[topic.id] = recordBase + 100 + index })
  const masteryIdByKey = {}
  topics.forEach((topic, index) => { masteryIdByKey[topic.id] = recordBase + 4000 + index })

  return {
    id,
    title,
    meta,
    progress,
    isStressFixture,
    records: {
      知识图谱版本: [{ id: GRAPH_VERSION_ID, 版本标识: 'primary-knowledge-v1', 来源名称: '本地展示数据', 发布状态: 'published', 说明: '仅用于小程序图谱视觉开发' }],
      知识学科: [{ id: subjectId, 学科标识: `${subjectName === '语文' ? 'chinese' : 'math'}-primary`, 学科名称: subjectName, 显示颜色: subjectName === '语文' ? '#D67A5F' : '#FD7C02', 显示顺序: 1, 所属图谱版本_id: GRAPH_VERSION_ID }],
      知识领域: [{ id: domainId, 领域标识: `${id}-domain`, 领域名称: domainName, 显示顺序: 1, 所属学科_id: subjectId }],
      知识点: topics.map((topic) => ({
        id: topicIdByKey[topic.id],
        知识点标识: topic.id,
        知识点名称: topic.name,
        知识说明: topic.description,
        知识类型: topic.type || 'concept',
        节点类型: topic.nodeType,
        学段: '小学',
        起始年级: 5,
        结束年级: 5,
        核心度: topic.coreScore,
        内容状态: 'published',
        所属图谱版本_id: GRAPH_VERSION_ID,
        所属学科_id: subjectId,
        所属领域_id: domainId
      })),
      图谱布局: topics.map((topic, index) => ({
        id: recordBase + 1000 + index,
        布局标识: `course-map-${topic.id}`,
        视图标识: 'course-map',
        横坐标: topic.x,
        纵坐标: topic.y,
        层级: topic.level,
        布局状态: 'generated',
        所属知识点_id: topicIdByKey[topic.id]
      })),
      知识依赖: dependencies.map((dependency, index) => ({
        id: recordBase + 2000 + index,
        关系标识: `${id}-dependency-${index + 1}`,
        前置强度: dependency.strength,
        关系说明: dependency.note,
        审核状态: 'approved',
        前置知识点_id: topicIdByKey[dependency.from],
        目标知识点_id: topicIdByKey[dependency.to]
      })),
      知识点学习进度: topics.map((topic, index) => ({
        id: recordBase + 3000 + index,
        账户ID: DEMO_ACCOUNT_ID,
        知识点ID: topicIdByKey[topic.id],
        学习状态: MASTERY_PRESETS[topic.status].学习状态
      })),
      学生知识点掌握: topics.map((topic) => ({
        id: masteryIdByKey[topic.id],
        ...MASTERY_PRESETS[topic.status],
        算法版本: 'mastery_v1',
        最后证据时间: topic.status === 'unknown' ? null : '2026-09-05T10:00:00+08:00',
        重算时间: '2026-09-05T12:00:00+08:00',
        所属学生档案_id: DEMO_STUDENT_PROFILE_ID,
        所属知识点_id: topicIdByKey[topic.id]
      })),
      // 证据表不直接上屏；mastered 的 teacher_review 表示本地示例已老师核验。
      知识掌握证据: topics.filter((topic) => topic.status !== 'unknown').map((topic, index) => ({
        id: recordBase + 5000 + index,
        证据类型: topic.status === 'mastered' ? 'teacher_review' : 'lesson_practice',
        证据数值: MASTERY_PRESETS[topic.status].掌握分数,
        证据载荷: { source: 'local-demo', graphCourseId: id },
        置信度: MASTERY_PRESETS[topic.status].置信度,
        来源系统: 'zion',
        来源引用: `local-${topic.id}-evidence`,
        发生时间: '2026-09-05T10:00:00+08:00',
        幂等键: `local-demo-${topic.id}-v1`,
        所属知识点掌握_id: masteryIdByKey[topic.id]
      }))
    }
  }
}

function createStressTopics() {
  const statuses = ['unknown', 'reinforce', 'learning', 'mastered']
  const topicNames = ['数感理解', '运算推理', '图形观察', '规律探索', '问题解决', '表达与验证']
  return Array.from({ length: 200 }, (_, index) => {
    if (index === 0) {
      return { id: 'stress-topic-001', name: '五年级综合知识图谱', status: 'learning', x: 100, y: 838, level: 0, nodeType: 'domain_root', coreScore: 1, description: '200 节点与 800 条依赖的极限性能测试根节点。' }
    }
    const order = index - 1
    const level = Math.floor(order / 17) + 1
    const row = order % 17
    // Deterministic offsets keep the fixture reproducible without looking grid-perfect.
    const xJitter = (index * 37) % 61 - 30
    const yJitter = (index * 29) % 21 - 10
    let name = `${topicNames[index % topicNames.length]} ${String(index + 1).padStart(3, '0')}`
    if (index % 11 === 0) name = `跨情境迁移与多步骤综合问题 ${String(index + 1).padStart(3, '0')}`
    else if (index % 7 === 0) name = `知识关联验证 ${String(index + 1).padStart(3, '0')}`
    return {
      id: `stress-topic-${String(index + 1).padStart(3, '0')}`,
      name,
      status: statuses[index % statuses.length],
      x: 120 + level * 250 + xJitter,
      y: 70 + row * 100 + yJitter,
      level,
      nodeType: level <= 2 ? 'branch' : 'leaf',
      coreScore: Math.round((0.45 + (index % 10) * 0.055) * 100) / 100,
      description: `用于验证大规模圆角卡片、文字和连线性能的第 ${index + 1} 个知识点。`
    }
  })
}

function normalizeStressEdgeCount(requestedEdgeCount, topicCount) {
  const numericCount = Number(requestedEdgeCount)
  const fallbackCount = 800
  const integerCount = Number.isFinite(numericCount) ? Math.floor(numericCount) : fallbackCount
  return Math.max(topicCount - 1, Math.min(integerCount, topicCount * (topicCount - 1) / 2))
}

function createStressDependencies(topics, requestedEdgeCount) {
  const targetCount = normalizeStressEdgeCount(requestedEdgeCount, topics.length)
  const dependencies = []
  const pairs = new Set()
  const addDependency = (fromIndex, toIndex, strength, note) => {
    const key = `${fromIndex}:${toIndex}`
    if (fromIndex === toIndex || pairs.has(key)) return
    pairs.add(key)
    dependencies.push({ from: topics[fromIndex].id, to: topics[toIndex].id, strength, note })
  }
  for (let index = 1; index < topics.length; index += 1) {
    addDependency(index <= 17 ? 0 : index - 17, index, 'hard', '连通骨架依赖')
  }
  for (let offset = 1; dependencies.length < targetCount && offset < topics.length; offset += 1) {
    for (let fromIndex = 0; fromIndex + offset < topics.length && dependencies.length < targetCount; fromIndex += 1) {
      addDependency(fromIndex, fromIndex + offset, (dependencies.length + fromIndex) % 4 === 0 ? 'soft' : 'hard', '确定性压力关联')
    }
  }
  return dependencies
}

let defaultStressCourse
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.keys(value).forEach((key) => deepFreeze(value[key]))
  return Object.freeze(value)
}
function createKnowledgeMapStressCourse(edgeCount = 800) {
  const topics = createStressTopics()
  const normalizedEdgeCount = normalizeStressEdgeCount(edgeCount, topics.length)
  return createGraphCourse({
    id: KNOWLEDGE_MAP_STRESS_COURSE_ID,
    title: '200 节点压测',
    meta: `极限模式 · ${normalizedEdgeCount} 条连线`,
    progress: null,
    subjectName: '数学',
    domainName: '综合压力图谱',
    recordBase: 100000,
    topics,
    dependencies: createStressDependencies(topics, normalizedEdgeCount),
    isStressFixture: true
  })
}
function getDefaultKnowledgeMapStressCourseSource() {
  if (!defaultStressCourse) defaultStressCourse = deepFreeze(createKnowledgeMapStressCourse(800))
  return defaultStressCourse
}
function getDefaultKnowledgeMapStressCourse() {
  return JSON.parse(JSON.stringify(getDefaultKnowledgeMapStressCourseSource()))
}

const knowledgeMapModel = {
  student,
  notifications: { count: 3 },
  legend: [
    { key: 'unknown', label: '待了解' },
    { key: 'reinforce', label: '需巩固' },
    { key: 'learning', label: '学习中' },
    { key: 'mastered', label: '已掌握' }
  ],
  courses: [
    createGraphCourse({
      id: 'decimal', title: '小数运算', meta: '五年级数学 · 进行中', progress: 58, subjectName: '数学', domainName: '数与运算', recordBase: 10000,
      topics: [
        { id: 'decimal-root', name: '小数运算', status: 'learning', x: 375, y: 340, level: 0, nodeType: 'domain_root', coreScore: 1, description: '小数运算课程的中心知识点。' },
        { id: 'decimal-meaning', name: '小数的意义', status: 'mastered', x: 245, y: 252, level: 1, nodeType: 'branch', coreScore: 0.9, description: '理解小数各数位所表示的意义。' },
        { id: 'decimal-compare', name: '小数比较', status: 'mastered', x: 142, y: 164, level: 2, nodeType: 'leaf', coreScore: 0.68, description: '比较小数大小并进行排序。' },
        { id: 'decimal-add', name: '小数加减法', status: 'mastered', x: 146, y: 374, level: 2, nodeType: 'leaf', coreScore: 0.76, description: '按相同数位对齐计算小数加减。' },
        { id: 'decimal-multiply', name: '小数乘法', status: 'reinforce', x: 510, y: 238, level: 1, nodeType: 'branch', coreScore: 0.92, description: '掌握积的小数位数确定方法。' },
        { id: 'decimal-cycle', name: '循环小数', status: 'unknown', x: 614, y: 152, level: 2, nodeType: 'leaf', coreScore: 0.48, description: '认识循环小数及其表示方式。' },
        { id: 'decimal-divide', name: '小数除法', status: 'learning', x: 512, y: 426, level: 1, nodeType: 'branch', coreScore: 0.92, description: '理解商的小数点定位和除法步骤。' },
        { id: 'decimal-application', name: '实际问题', status: 'unknown', x: 612, y: 512, level: 2, nodeType: 'leaf', coreScore: 0.58, description: '在实际情境中选择合适的小数运算。' }
      ],
      dependencies: [
        { from: 'decimal-root', to: 'decimal-meaning', strength: 'hard', note: '课程中心分支' },
        { from: 'decimal-meaning', to: 'decimal-compare', strength: 'hard', note: '概念理解支持比较' },
        { from: 'decimal-meaning', to: 'decimal-add', strength: 'hard', note: '概念理解支持计算' },
        { from: 'decimal-root', to: 'decimal-multiply', strength: 'hard', note: '课程中心分支' },
        { from: 'decimal-compare', to: 'decimal-multiply', strength: 'soft', note: '大小估算辅助乘法检验' },
        { from: 'decimal-multiply', to: 'decimal-cycle', strength: 'soft', note: '延伸认识' },
        { from: 'decimal-root', to: 'decimal-divide', strength: 'hard', note: '课程中心分支' },
        { from: 'decimal-divide', to: 'decimal-application', strength: 'hard', note: '运算迁移到实际问题' }
      ]
    }),
    createGraphCourse({
      id: 'geometry', title: '平面图形', meta: '五年级数学 · 待巩固', progress: 36, subjectName: '数学', domainName: '图形与几何', recordBase: 20000,
      topics: [
        { id: 'geometry-root', name: '平面图形', status: 'learning', x: 375, y: 340, level: 0, nodeType: 'domain_root', coreScore: 1, description: '平面图形课程的中心知识点。' },
        { id: 'geometry-line', name: '垂线与平行线', status: 'mastered', x: 240, y: 245, level: 1, nodeType: 'branch', coreScore: 0.84, description: '识别并运用垂直、平行关系。' },
        { id: 'geometry-triangle', name: '三角形面积', status: 'learning', x: 138, y: 156, level: 2, nodeType: 'leaf', coreScore: 0.78, description: '通过割补推导三角形面积公式。' },
        { id: 'geometry-parallelogram', name: '平行四边形面积', status: 'reinforce', x: 136, y: 390, level: 2, nodeType: 'leaf', coreScore: 0.91, description: '巩固底和高的对应关系。' },
        { id: 'geometry-trapezoid', name: '梯形面积', status: 'unknown', x: 514, y: 240, level: 1, nodeType: 'branch', coreScore: 0.8, description: '理解梯形面积公式的推导。' },
        { id: 'geometry-unit', name: '面积单位', status: 'mastered', x: 615, y: 152, level: 2, nodeType: 'leaf', coreScore: 0.64, description: '掌握常见面积单位之间的进率。' },
        { id: 'geometry-composite', name: '组合图形', status: 'unknown', x: 520, y: 466, level: 1, nodeType: 'branch', coreScore: 0.88, description: '拆分组合图形并计算面积。' }
      ],
      dependencies: [
        { from: 'geometry-root', to: 'geometry-line', strength: 'hard', note: '课程中心分支' },
        { from: 'geometry-line', to: 'geometry-triangle', strength: 'hard', note: '高的概念基础' },
        { from: 'geometry-line', to: 'geometry-parallelogram', strength: 'hard', note: '高的概念基础' },
        { from: 'geometry-root', to: 'geometry-trapezoid', strength: 'hard', note: '课程中心分支' },
        { from: 'geometry-trapezoid', to: 'geometry-unit', strength: 'soft', note: '单位换算辅助' },
        { from: 'geometry-root', to: 'geometry-composite', strength: 'hard', note: '课程中心分支' },
        { from: 'geometry-parallelogram', to: 'geometry-composite', strength: 'hard', note: '面积拆分基础' }
      ]
    }),
    createGraphCourse({
      id: 'reading', title: '阅读理解', meta: '五年级语文 · 新课程', progress: 17, subjectName: '语文', domainName: '阅读与鉴赏', recordBase: 30000,
      topics: [
        { id: 'reading-root', name: '阅读理解', status: 'learning', x: 375, y: 340, level: 0, nodeType: 'domain_root', coreScore: 1, description: '阅读理解课程的中心知识点。' },
        { id: 'reading-word', name: '词句理解', status: 'mastered', x: 242, y: 244, level: 1, nodeType: 'branch', coreScore: 0.86, description: '联系上下文理解重点词句。' },
        { id: 'reading-paragraph', name: '概括段意', status: 'learning', x: 138, y: 154, level: 2, nodeType: 'leaf', coreScore: 0.9, description: '抓住中心句概括段落大意。' },
        { id: 'reading-info', name: '信息梳理', status: 'reinforce', x: 142, y: 390, level: 2, nodeType: 'leaf', coreScore: 0.82, description: '提取并组织关键信息。' },
        { id: 'reading-main', name: '中心思想', status: 'unknown', x: 510, y: 238, level: 1, nodeType: 'branch', coreScore: 0.93, description: '综合内容、情感与写作背景理解主旨。' },
        { id: 'reading-expression', name: '表达方法', status: 'unknown', x: 614, y: 150, level: 2, nodeType: 'leaf', coreScore: 0.7, description: '辨析常见表达方法及作用。' },
        { id: 'reading-character', name: '人物形象', status: 'unknown', x: 518, y: 468, level: 1, nodeType: 'branch', coreScore: 0.8, description: '通过描写和事件概括人物形象。' }
      ],
      dependencies: [
        { from: 'reading-root', to: 'reading-word', strength: 'hard', note: '课程中心分支' },
        { from: 'reading-word', to: 'reading-paragraph', strength: 'hard', note: '词句理解支持段意概括' },
        { from: 'reading-word', to: 'reading-info', strength: 'soft', note: '辅助信息提取' },
        { from: 'reading-root', to: 'reading-main', strength: 'hard', note: '课程中心分支' },
        { from: 'reading-main', to: 'reading-expression', strength: 'soft', note: '表达方法辅助主旨理解' },
        { from: 'reading-root', to: 'reading-character', strength: 'hard', note: '课程中心分支' },
        { from: 'reading-info', to: 'reading-character', strength: 'hard', note: '信息梳理支持形象概括' }
      ]
    })
  ],
  tip: '实线为强前置依赖，虚线为弱关联；卡片状态来自本地掌握记录。'
}

const meModel = {
  profile: {
    name: '核蛋拌面',
    id: 'ZL20260906001'
  },
  accountSummary: [
    { value: '286', label: '课程积分', icon: '../../assets/me/course-points.svg', meta: '冻结 18', actionLabel: '充值' },
    { value: '120', label: '我的金币', icon: '../../assets/me/coins.svg', actionLabel: '兑换' }
  ],
  quickActions: [
    { label: '我的订单', icon: '../../assets/me/quick-orders.svg' },
    { label: '消息中心', icon: '../../assets/me/quick-messages.svg', unreadCount: 3 },
    { label: '账户安全', icon: '../../assets/me/quick-security.svg' },
    { label: '家庭关系', icon: '../../assets/me/quick-family.svg' }
  ],
  serviceGroups: [
    {
      title: '知鹿服务',
      enterpriseService: {
        title: '企微服务',
        description: '联系课程顾问和真人服务',
        hours: '9:00-18:00',
        avatar: '../../assets/me/service-advisor.png'
      },
      items: [
        { title: '推广伙伴', description: '分享工具与奖励记录' },
        { title: '身份与登录', description: '实名、微信和手机号身份' },
        { title: '兑换码', description: '兑换课程积分、金币或体验权益' }
      ]
    }
  ]
}

module.exports = {
  homeModels,
  homeStudyDayProfiles,
  overviewIconSources,
  learningModel,
  knowledgeMapModel,
  meModel,
  DEFAULT_KNOWLEDGE_MAP_COURSE_ID,
  KNOWLEDGE_MAP_STRESS_COURSE_ID,
  createKnowledgeMapStressCourse,
  getDefaultKnowledgeMapStressCourse,
  getDefaultKnowledgeMapStressCourseSource
}
