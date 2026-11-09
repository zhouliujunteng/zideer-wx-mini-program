const {
  loadTeacherStudentProfile,
  cancelTeacherAgentInvite,
  uploadTeacherInviteVoice,
  saveTeacherInviteVoice,
  saveTeacherInviteDetails,
  createTeacherAgentInvite,
  loadTeacherStudentAgentCourses,
  loadTeacherStudentAssessments,
  loadTeacherLearningPreference,
  loadTeacherDailyLearning,
  createTeacherDailyNote
} = require('../../services/identity')
const { buildInviteShareTitle, inviteCoverOptions } = require('../../services/agent-invite-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { prepareShareCover, shareWithCover } = require('../../services/share-cover')
const { courseLearningState, courseFilterTabs, filterCourses } = require('../../utils/study-plan-view')

// 老师端学习目标一段话：课程服务给好的「方向 · 具体目标 · 完成时间（还剩几天）」几行
function goalTeacherText(goal) {
  return (Array.isArray(goal && goal.lines) ? goal.lines : []).map((line) => String((line && line.text) || '')).filter(Boolean).join(' · ')
}
const { decorateDaily } = require('../../utils/daily-learning-view')

// 老师工作台 → 我的学生详情（2026-09-24 设计稿 E06，ui-ref/package-student-service/pages/student-detail）。
// 三个标签：学生档案（老师只读，学生本人维护）/ 预约会议（真实创建预约、课前语音、分享、看直播间、取消）/
// 学习情况（设计稿留空，放学习课程与验收核验、测评记录）。
// 后端「教师学生服务」与「创建教师智能体邀请」都按当前登录账号判定老师身份和绑定关系，
// 页面传入的 studentProfileId 只是目标，不是凭据；停用的老师或已解绑的学生一律被后端拒绝。

const TABS = [
  { id: 'profile', label: '学生档案', icon: '/assets/student-service/folder.svg' },
  { id: 'appointment', label: '预约会议', icon: '/assets/student-service/calendar.svg' },
  { id: 'learning', label: '学习情况', icon: '/assets/student-service/study-file.svg' }
]
const GRADE_NAMES = ['小学一年级', '小学二年级', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '初一', '初二', '初三', '高一', '高二', '高三']
const SUBJECT_OPTIONS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学']
const DURATION_UNITS = ['分钟', '小时']
const PROFILE_LABELS = ['学生称呼', '学段', '年级', '教材版本', '学校', '所在地区']
const VOICE_MICROPHONE_GUIDE = {
  scope: 'scope.record',
  title: '需要麦克风权限',
  content: '录课前语音要用麦克风，请在设置里打开「麦克风」后再录。'
}

// 权限引导只在录课前语音时用到，用到时再加载
function permissionGuide() {
  return require('../../utils/permission-guide')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function gradeName(grade) {
  const value = Number(grade)
  return Number.isInteger(value) && value >= 1 && value <= 12 ? GRADE_NAMES[value - 1] : ''
}

function profileRows(profile) {
  const grade = [gradeName(profile.grade), profile.semester].filter(Boolean).join(' · ')
  const values = [profile.displayName, profile.schoolStage, grade, profile.textbookVersion, profile.schoolName, profile.regionDetail]
  return PROFILE_LABELS.map((label, index) => ({ label, value: values[index] || '未填写' }))
}

// picker 的日期与时间在设备本地时区，转成后端需要的 ISO 串。
function toIso(date, time) {
  const [year, month, day] = String(date || '').split('-').map(Number)
  const [hour, minute] = String(time || '').split(':').map(Number)
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return ''
  const value = new Date(year, month - 1, day, hour, minute, 0, 0)
  return Number.isNaN(value.getTime()) ? '' : value.toISOString()
}

// 今天 / 明天 / 后天，其余显示月日（不带年份）。
function relativeDay(value, now = new Date()) {
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(time.getFullYear(), time.getMonth(), time.getDate())
  const offset = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (offset === 0) return '今天'
  if (offset === 1) return '明天'
  if (offset === 2) return '后天'
  return `${time.getMonth() + 1}月${time.getDate()}日`
}

function clockText(value) {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '时间待确认' : `${pad(time.getHours())}:${pad(time.getMinutes())}`
}

function minutesText(minutes) {
  const value = Number(minutes || 0)
  if (!value) return ''
  if (value < 60) return `${value}分钟`
  return value % 60 ? `${Math.floor(value / 60)}小时${value % 60}分钟` : `${value / 60}小时`
}

function voiceLengthText(ms) {
  const seconds = Math.round(Number(ms || 0) / 1000)
  if (!seconds) return ''
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

// 一个学生同时只有最后发起的那条预约生效；更早的即使没到时间也打不开，取消最新那条则全部失效。
function inviteStateText(invite, now = Date.now()) {
  if (invite.status === 'canceled') return '已取消'
  if (invite.status === 'closed') return '已结束'
  if (!invite.isLatest) return '已被新的预约取代'
  if (invite.status === 'active') return '进行中'
  const startAt = new Date(invite.scheduledOnlineAt).getTime()
  if (Number.isFinite(startAt) && startAt > now && startAt - now <= 60 * 60 * 1000) return '即将开始'
  return '生效中 · 待上线'
}

function decorateInvite(invite, now = Date.now()) {
  const ended = invite.status === 'canceled' || invite.status === 'closed'
  // 分享前必须先录好课前语音：学生进入对话时 AI 客服要先把它播给学生。
  const canShare = Boolean(invite.effective && invite.hasVoice)
  return {
    ...invite,
    title: invite.meetingNote ? `${invite.meetingNote} · ${invite.subject}` : `${invite.subject}专属诊断会议`,
    dateLabel: relativeDay(invite.scheduledOnlineAt, new Date(now)),
    timeLabel: clockText(invite.scheduledOnlineAt),
    subtitle: [minutesText(invite.meetingMinutes), inviteStateText(invite, now)].filter(Boolean).join(' · '),
    canShare,
    shareHint: canShare ? '' : invite.effective ? '录好课前语音后可分享' : '不可分享',
    canWatchLive: invite.status !== 'canceled',
    canCancel: !ended,
    // 课前语音叠层卡：只挂在还能用的最新预约，或已经录过语音的预约上。
    showVoice: !ended && (invite.isLatest || invite.hasVoice),
    voiceText: invite.hasVoice ? `课前语音 ${voiceLengthText(invite.voiceDurationMs)}` : '还没录课前语音'
  }
}

// 测评记录：每一轮一条（多轮摸底诊断会有多条），已交卷的显示本轮得分。
function formatDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function decorateAssessment(item) {
  const submitted = item.status === 'submitted'
  const round = item.roundCount > 1 ? `第 ${item.round}/${item.roundCount} 轮` : ''
  const result = submitted ? `答对 ${item.correctCount}/${item.answeredCount} 题 · ${item.earnedMarks}/${item.possibleMarks} 分` : ''
  return {
    attemptId: item.attemptId,
    name: item.name,
    meta: [round, result, formatDay(item.submittedAt || item.startedAt)].filter(Boolean).join(' · '),
    statusText: submitted ? (item.band || '已完成') : item.status === 'draft' ? '作答中' : '处理中',
    tone: submitted ? (item.band === '扎实' || item.band === '基本掌握' ? 'passed' : 'warn') : 'muted'
  }
}

// 学习课程：学生的智能体课程（课程服务 /api/teacher/agent-courses），AI 验收通过的等老师核验。
// 按学习情况分「未学 / 学习中 / 已学完」，口径与学习端「本课已学完」一致（utils/study-plan-view.js）。
function decorateCourse(course) {
  const acceptance = course.acceptance || {}
  const learning = acceptance.learning
  const learningState = courseLearningState(course)
  const progressText = {
    generating: '课程生成中',
    unavailable: '课程未生成完成',
    unknown: '学习进度暂未读到',
    not_started: learning ? `还没开始学 · 共 ${learning.total} 部分` : '还没开始学',
    completed: learning ? `已学完 ${learning.total} 部分` : '已学完'
  }[learningState] || (learning ? `已学 ${learning.completed} / ${learning.total} 部分` : '学习中')
  const labels = {
    in_progress: ['学生验收中', 'muted'],
    ai_retry: ['AI 验收未通过', 'warn'],
    pending_teacher: ['待你核验', 'action'],
    teacher_passed: ['已通过', 'passed'],
    teacher_rejected: ['已要求重学', 'warn']
  }
  // 还没进入验收：状态胶囊跟学习情况走，与上面的筛选同一口径。
  const learningLabels = {
    generating: ['生成中', 'muted'],
    unavailable: ['未生成完成', 'muted'],
    unknown: ['进度未读到', 'muted'],
    not_started: ['未学', 'muted'],
    in_progress: ['学习中', 'muted'],
    completed: ['已学完，待学生验收', 'muted']
  }
  const label = labels[acceptance.status] || learningLabels[learningState] || learningLabels.unknown
  return {
    stageId: course.stageId,
    title: course.title || '定制课程',
    learningState,
    progressText,
    statusText: label[0],
    statusTone: label[1],
    needsReview: acceptance.status === 'pending_teacher'
  }
}

function defaultForm() {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  return {
    subjectIndex: 1,
    date: dateValue(next),
    time: `${pad(next.getHours())}:00`,
    durationValue: '45',
    durationUnitIndex: 0,
    note: ''
  }
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'profile',
    tabMotion: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    loadState: 'loading',
    loadError: '',
    publicId: '',
    profile: {},
    profileRows: [],
    skeletonLabels: PROFILE_LABELS,
    headerMeta: '',
    avatarInitial: '',
    invites: [],
    creating: false,
    canceling: false,
    recordingInviteId: '',
    recordingSeconds: 0,
    uploadingVoice: false,
    sheetVisible: false,
    sheetClosing: false,
    form: defaultForm(),
    formError: '',
    today: dateValue(new Date()),
    subjectOptions: SUBJECT_OPTIONS,
    durationUnits: DURATION_UNITS,
    courseState: 'loading',
    courseError: '',
    courses: [],
    courseFilter: 'all',
    courseFilters: courseFilterTabs([], 'all'),
    visibleCourses: [],
    pendingCourseCount: 0,
    assessmentState: 'loading',
    assessmentError: '',
    assessments: [],
    // 今日学习：学生今天学了什么、老师今天发给学生的话
    dailyState: 'loading',
    dailyError: '',
    daily: {},
    dailyWriting: false,
    // 学生的学习偏好（只读）：loading 骨架 / ready / failed
    preferenceState: 'loading',
    preferenceError: '',
    preferenceSet: false,
    preferenceLines: [],
    preferenceNote: '',
    goalSet: false,
    goalText: '',
    // 从服务号「课程学习完成通知」点进来：直接打开学习情况，并提醒老师到服务群里跟学生互动（2026-10-04 用户要求）
    meetingDoneHint: false,
    refreshing: false
  },

  onLoad(options) {
    attachUiAssets(this)
    this.studentProfileId = String((options && options.studentProfileId) || '')
    const tab = String((options && options.tab) || '')
    if (TABS.some((item) => item.id === tab)) this.setData({ activeTab: tab })
    if (options && options.from === 'meeting_done') this.setData({ activeTab: 'learning', meetingDoneHint: true })
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      publicId: String((options && options.publicId) || ''),
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      // 从工作台带过来的名字先放在头部，档案读到后以后端为准。
      'profile.displayName': options && options.name ? decodeURIComponent(String(options.name)).slice(0, 20) : ''
    })
    this.setData({ avatarInitial: Array.from(this.data.profile.displayName || '')[0] || '' })
  },

  onShow() {
    // 课程与测评每次回来都刷新：从核验页返回后要看到最新状态。
    this.loadCourses()
    this.loadAssessments()
    this.loadDaily()
    this.loadPreference()
    if (this._loadedOnce) return
    return this.loadPage()
  },

  onUnload() {
    this._voiceUnloaded = true
    if (this._voiceTimer) clearInterval(this._voiceTimer)
    if (this._recorder && this.data.recordingInviteId) this.stopVoiceRecording()
    if (this._tabMotionTimer) clearTimeout(this._tabMotionTimer)
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/teacher/workspace/index' })
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await Promise.all([this.loadPage(), this.loadCourses(), this.loadAssessments(), this.loadPreference(), this.loadDaily()])
    this.setData({ refreshing: false })
  },

  dismissMeetingDoneHint() {
    this.setData({ meetingDoneHint: false })
  },

  handleTabChange(event) {
    const nextTab = event.currentTarget.dataset.id
    const currentIndex = TABS.findIndex((tab) => tab.id === this.data.activeTab)
    const nextIndex = TABS.findIndex((tab) => tab.id === nextTab)
    if (nextTab === this.data.activeTab || nextIndex < 0) return
    if (this._tabMotionTimer) clearTimeout(this._tabMotionTimer)
    const tabMotion = nextIndex > currentIndex ? 'tab-content-enter-from-right' : 'tab-content-enter-from-left'
    this.setData({ activeTab: nextTab, tabMotion: '' }, () => {
      this.setData({ tabMotion })
      this._tabMotionTimer = setTimeout(() => {
        this._tabMotionTimer = null
        this.setData({ tabMotion: '' })
      }, 240)
    })
  },

  async loadPage() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    if (this.data.loadState === 'failed') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const result = await loadTeacherStudentProfile(this.studentProfileId)
      if (requestId !== this._requestId) return
      this._loadedOnce = true
      this.applyResult(result)
      this.setData({ loadState: 'ready' })
    } catch (error) {
      if (requestId !== this._requestId) return
      // 读到过一次后刷新失败：保留页面上的档案，只提示一下，不换成错误页。
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error && error.message ? error.message : '刷新失败，请稍后重试', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error && error.message ? error.message : '请稍后重试。' })
    }
  },

  applyResult(result) {
    const profile = result.profile || {}
    const now = Date.now()
    const invites = (result.invites || []).map((invite) => decorateInvite(invite, now))
    const latestSubject = invites.length ? invites[0].subject : ''
    this.setData({
      profile,
      avatarInitial: Array.from(profile.displayName || '')[0] || '',
      profileRows: profileRows(profile),
      invites,
      headerMeta: [gradeName(profile.grade) || '年级未填', this.data.publicId ? `ID ${this.data.publicId}` : '', latestSubject ? `最近陪跑 ${latestSubject}` : ''].filter(Boolean).join(' · ')
    })
    // 能分享的预约先把卡片封面画好，老师点「分享给学生」时直接带上
    invites.filter((invite) => invite.canShare).forEach((invite) => prepareShareCover(this, this.inviteCover(invite)))
  },

  // 分享卡片封面：学生名字 + 专属诊断会议 + 年级学科与开始时间（services/agent-invite-view.js）
  inviteCover(invite) {
    return inviteCoverOptions({
      studentName: this.data.profile.displayName,
      grade: this.data.profile.grade,
      subject: invite.subject,
      scheduledOnlineAt: invite.scheduledOnlineAt
    })
  },

  // 学习目标与偏好由学生本人在「学习宇宙」里维护，老师只看；读到过就静默刷新。
  async loadPreference() {
    const requestId = (this._preferenceRequestId || 0) + 1
    this._preferenceRequestId = requestId
    if (this.data.preferenceState === 'failed') this.setData({ preferenceState: 'loading', preferenceError: '' })
    try {
      const view = await loadTeacherLearningPreference(this.studentProfileId)
      if (requestId !== this._preferenceRequestId) return
      const lines = (Array.isArray(view && view.lines) ? view.lines : [])
        .map((line) => ({ title: String(line.title || ''), labels: (line.labels || []).map(String) }))
        .filter((line) => line.title && line.labels.length)
      const goal = (view && view.goal) || {}
      this.setData({
        preferenceState: 'ready',
        preferenceSet: Boolean(view && view.status === 'set'),
        preferenceLines: lines,
        preferenceNote: String((view && view.note) || ''),
        goalSet: goal.status === 'set' && Boolean(goalTeacherText(goal)),
        goalText: goalTeacherText(goal)
      })
    } catch (error) {
      if (requestId !== this._preferenceRequestId || this.data.preferenceState === 'ready') return
      this.setData({ preferenceState: 'failed', preferenceError: error && error.message ? error.message : '请稍后重试。' })
    }
  },

  async loadCourses() {
    const requestId = (this._courseRequestId || 0) + 1
    this._courseRequestId = requestId
    if (this.data.courseState === 'failed') this.setData({ courseState: 'loading', courseError: '' })
    try {
      const result = await loadTeacherStudentAgentCourses(this.studentProfileId)
      if (requestId !== this._courseRequestId) return
      const courses = (result.courses || []).map(decorateCourse)
      // 待核验的排最前
      courses.sort((a, b) => Number(b.needsReview) - Number(a.needsReview))
      this.setData({ courseState: 'ready', courses, pendingCourseCount: courses.filter((item) => item.needsReview).length })
      this.applyCourseFilter(this.data.courseFilter)
    } catch (error) {
      if (requestId !== this._courseRequestId || this.data.courseState === 'ready') return
      this.setData({ courseState: 'failed', courseError: error && error.message ? error.message : '请稍后重试。' })
    }
  },

  // 学习课程快速筛选：全部 / 未学 / 学习中 / 已学完
  applyCourseFilter(courseFilter) {
    const courses = this.data.courses
    this.setData({ courseFilter, courseFilters: courseFilterTabs(courses, courseFilter), visibleCourses: filterCourses(courses, courseFilter) })
  },

  handleCourseFilter(event) {
    const filter = String(event.currentTarget.dataset.filter || '')
    if (!filter || filter === this.data.courseFilter || !this.data.courseFilters.some((item) => item.id === filter)) return
    this.applyCourseFilter(filter)
  },

  // 学习安排：选每天学习时长、自动把课程排进每天的学习任务、逐条调整
  openStudyPlan() {
    if (!/^[1-9][0-9]*$/.test(this.studentProfileId || '')) return
    const name = encodeURIComponent(this.data.profile.displayName || '')
    wx.navigateTo({ url: `/teacher/study-plan/index?studentProfileId=${encodeURIComponent(this.studentProfileId)}&name=${name}` })
  },

  // 目标导图（2026-10-10）：学生按目标测评测出的卡点，只读
  openGoalMap() {
    if (!/^[1-9][0-9]*$/.test(this.studentProfileId || '')) return
    wx.navigateTo({ url: `/learning/goal-diagnosis/index?studentProfileId=${encodeURIComponent(this.studentProfileId)}` })
  },

  openParentReport() {
    if (!/^[1-9][0-9]*$/.test(this.studentProfileId || '')) return
    const name = encodeURIComponent(this.data.profile.displayName || '')
    wx.navigateTo({ url: `/teacher/parent-report/index?studentProfileId=${encodeURIComponent(this.studentProfileId)}&name=${name}` })
  },

  // ---------- 今日学习：老师每天进来看学生今天学了没有、学了什么，再生成一段话单独发给学生 ----------
  async loadDaily() {
    const requestId = (this._dailyRequestId || 0) + 1
    this._dailyRequestId = requestId
    if (this.data.dailyState === 'failed') this.setData({ dailyState: 'loading', dailyError: '' })
    try {
      const result = await loadTeacherDailyLearning(this.studentProfileId)
      if (requestId !== this._dailyRequestId) return
      this.setData({ dailyState: 'ready', daily: decorateDaily(result) })
    } catch (error) {
      // 读到过一次后刷新失败：保留卡片上的内容
      if (requestId !== this._dailyRequestId || this.data.dailyState === 'ready') return
      this.setData({ dailyState: 'failed', dailyError: error && error.message ? error.message : '请稍后重试。' })
    }
  },

  async handleDailyNote() {
    if (this.data.dailyWriting || !this.data.daily.studied) return
    this.setData({ dailyWriting: true })
    try {
      const result = await createTeacherDailyNote(this.studentProfileId)
      // 生成期间又刷新过的读取作废，以这次生成的结果为准
      this._dailyRequestId = (this._dailyRequestId || 0) + 1
      this.setData({ dailyState: 'ready', daily: decorateDaily(result) })
      wx.showToast({ title: '已生成，点一下就能复制', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '这段话暂时没有生成，请稍后重试', icon: 'none' })
      if (error && error.code === 'DAILY_NOT_STUDIED') this.loadDaily()
    } finally {
      this.setData({ dailyWriting: false })
    }
  },

  copyDailyNote() {
    const text = this.data.daily.note && this.data.daily.note.text
    if (!text) return
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制，可以粘贴发给学生', icon: 'none' })
    })
  },

  async loadAssessments() {
    const requestId = (this._assessmentRequestId || 0) + 1
    this._assessmentRequestId = requestId
    if (this.data.assessmentState === 'failed') this.setData({ assessmentState: 'loading', assessmentError: '' })
    try {
      const attempts = await loadTeacherStudentAssessments(this.studentProfileId)
      if (requestId !== this._assessmentRequestId) return
      this.setData({ assessmentState: 'ready', assessments: attempts.map(decorateAssessment) })
    } catch (error) {
      if (requestId !== this._assessmentRequestId || this.data.assessmentState === 'ready') return
      this.setData({ assessmentState: 'failed', assessmentError: error && error.message ? error.message : '请稍后重试。' })
    }
  },

  openAssessment(event) {
    const attemptId = String(event.currentTarget.dataset.attemptId || '')
    if (!/^[1-9][0-9]*$/.test(attemptId)) return
    wx.navigateTo({ url: `/teacher/assessment-report/index?studentProfileId=${encodeURIComponent(this.studentProfileId)}&attemptId=${encodeURIComponent(attemptId)}` })
  },

  openCourseAcceptance(event) {
    const stageId = String(event.currentTarget.dataset.stageId || '')
    if (!/^stage-[A-Za-z0-9_-]{1,64}$/.test(stageId)) return
    wx.navigateTo({ url: `/teacher/course-acceptance/index?stageId=${encodeURIComponent(stageId)}` })
  },

  // ---------- 发起预约：底部弹出表单 ----------
  openSheet() {
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    this.setData({ sheetVisible: true, sheetClosing: false, formError: '' })
  },

  closeSheet() {
    if (!this.data.sheetVisible || this.data.sheetClosing || this.data.creating) return
    this.setData({ sheetClosing: true })
    this._sheetTimer = setTimeout(() => {
      this._sheetTimer = null
      this.setData({ sheetVisible: false, sheetClosing: false })
    }, 280)
  },

  stopTap() {},

  handleFormPicker(event) {
    const field = event.currentTarget.dataset.field
    const value = event.detail.value
    const updates = { formError: '' }
    if (field === 'subject') updates['form.subjectIndex'] = Number(value)
    else if (field === 'date') updates['form.date'] = value
    else if (field === 'time') updates['form.time'] = value
    else if (field === 'durationUnit') updates['form.durationUnitIndex'] = Number(value)
    this.setData(updates)
  },

  handleDurationInput(event) {
    this.setData({ 'form.durationValue': String(event.detail.value || '').replace(/[^0-9]/g, '').slice(0, 3), formError: '' })
  },

  handleNoteInput(event) {
    this.setData({ 'form.note': String(event.detail.value || '').slice(0, 60) })
  },

  async handleCreateInvite() {
    if (this.data.creating) return
    const form = this.data.form
    const scheduledOnlineAt = toIso(form.date, form.time)
    if (!scheduledOnlineAt) {
      this.setData({ formError: '请选择有效的日期与时间。' })
      return
    }
    if (new Date(scheduledOnlineAt).getTime() <= Date.now()) {
      this.setData({ formError: '上线时间需要晚于现在。' })
      return
    }
    const amount = Number(form.durationValue)
    const meetingMinutes = form.durationUnitIndex === 1 ? amount * 60 : amount
    if (!Number.isInteger(amount) || meetingMinutes < 5 || meetingMinutes > 480) {
      this.setData({ formError: '会议时长需在 5 分钟到 8 小时之间。' })
      return
    }
    this.setData({ creating: true, formError: '' })
    let created
    try {
      created = await createTeacherAgentInvite({
        studentProfileId: this.studentProfileId,
        subjectLabel: SUBJECT_OPTIONS[form.subjectIndex],
        scheduledOnlineAt
      })
    } catch (error) {
      this.setData({ creating: false, formError: error && error.message ? error.message : '发起预约失败，请稍后重试。' })
      return
    }
    // 预约已创建：再补写会议时长与说明。补写失败不影响预约本身，只提示一下。
    let detailsSaved = true
    try {
      this.applyResult(await saveTeacherInviteDetails(this.studentProfileId, created.inviteId, meetingMinutes, form.note))
    } catch (error) {
      detailsSaved = false
      this.loadPage()
    }
    this.setData({ creating: false, form: defaultForm() })
    this.closeSheet()
    wx.showModal({
      title: '预约已创建',
      content: `${created.subject} · ${relativeDay(created.scheduledOnlineAt)} ${clockText(created.scheduledOnlineAt)}。先在预约记录里录一段课前语音，录好后才能分享给${this.data.profile.displayName || '学生'}本人。${detailsSaved ? '' : '（会议时长和说明没有保存上，不影响预约本身。）'}`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // ---------- 课前语音：老师按一次开始、再按一次结束，停止后立即上传并挂到这条预约上 ----------
  async handleVoiceTap(event) {
    const inviteId = String(event.currentTarget.dataset.inviteId || '')
    if (!inviteId || this.data.uploadingVoice) return
    if (this.data.recordingInviteId === inviteId) {
      this.stopVoiceRecording()
      return
    }
    if (this.data.recordingInviteId) {
      wx.showToast({ title: '请先结束当前录音', icon: 'none' })
      return
    }
    if (this._voicePermissionPending) return
    // 先确认麦克风权限：拒过的弹窗引导去设置（拒过一次后 wx.authorize 不再弹框）
    this._voicePermissionPending = true
    let granted = false
    try {
      granted = await permissionGuide().ensureScope('scope.record', VOICE_MICROPHONE_GUIDE)
    } finally {
      this._voicePermissionPending = false
    }
    // 授权弹窗、设置页期间页面可能已经关掉，或已经在录 / 在传别的
    if (!granted || this._voiceUnloaded || this.data.recordingInviteId || this.data.uploadingVoice) return
    this.startVoiceRecording(inviteId)
  },

  startVoiceRecording(inviteId) {
    const manager = this.bindVoiceRecorder()
    this._voiceInviteId = inviteId
    this._voiceStartedAt = Date.now()
    this.setData({ recordingInviteId: inviteId, recordingSeconds: 0 })
    this._voiceTimer = setInterval(() => {
      this.setData({ recordingSeconds: Math.floor((Date.now() - this._voiceStartedAt) / 1000) })
    }, 1000)
    try {
      manager.start({ duration: 10 * 60 * 1000, format: 'mp3', sampleRate: 44100, numberOfChannels: 1, encodeBitRate: 96000 })
    } catch (error) {
      this.handleVoiceError(error)
    }
  },

  stopVoiceRecording() {
    this.clearVoiceTimer()
    // 停之前也重新绑定：录音中途若进过直播间，监听已被录音桥换掉，结束回调会落不到本页
    const manager = this._recorder ? this.bindVoiceRecorder() : null
    if (manager) manager.stop()
  },

  // RecorderManager 是全局单例，onStart / onStop / onError 都是覆盖式的单个监听；直播间（teacher/live-room）
  // 用的共享录音桥（utils/recorder-session-bridge）每次开始录音都会换成它自己的监听。所以每次开始、结束录音前
  // 都重新绑定本页的监听，否则从直播间回来再录，结束回调落进录音桥：页面一直「录音中」、不上传，临时文件还会被录音桥删掉。
  // 录音桥自己每次开始前也会重新绑定，直播间那边不受影响。
  bindVoiceRecorder() {
    const manager = wx.getRecorderManager()
    // onStart 也换掉：录音桥的 onStart 在它上次开始失败后会把「没有会话的录音」当成自己迟到的那次停掉
    if (manager.onStart) manager.onStart(() => { this._voiceStartedAt = Date.now() })
    manager.onStop((result) => this.handleVoiceStop(result))
    manager.onError((error) => this.handleVoiceError(error))
    this._recorder = manager
    return manager
  },

  clearVoiceTimer() {
    if (this._voiceTimer) {
      clearInterval(this._voiceTimer)
      this._voiceTimer = null
    }
  },

  handleVoiceStop(result) {
    this.clearVoiceTimer()
    const inviteId = this._voiceInviteId
    this._voiceInviteId = ''
    this.setData({ recordingInviteId: '', recordingSeconds: 0 })
    if (!inviteId || !result || !result.tempFilePath) return
    this.uploadVoice(inviteId, result.tempFilePath, Number(result.duration || 0))
  },

  handleVoiceError(error) {
    this.clearVoiceTimer()
    const active = Boolean(this._voiceInviteId || this.data.recordingInviteId)
    this._voiceInviteId = ''
    this.setData({ recordingInviteId: '', recordingSeconds: 0 })
    // 不是本页正在录的（迟到的回调）或页面已关掉：只复位，不弹提示
    if (!active || this._voiceUnloaded) return
    // 权限问题按原因引导（去设置 / 隐私指引 / 手机系统设置），其余只提示重录
    permissionGuide().guideOnFailure(error, VOICE_MICROPHONE_GUIDE).then((kind) => {
      if (kind === 'other') wx.showToast({ title: '录音失败，请重试', icon: 'none' })
    })
  },

  async uploadVoice(inviteId, filePath, durationMs) {
    this.setData({ uploadingVoice: true })
    try {
      const uploaded = await uploadTeacherInviteVoice(filePath, durationMs)
      const result = await saveTeacherInviteVoice(this.studentProfileId, inviteId, uploaded.fileId, uploaded.durationMs)
      this.applyResult(result)
      wx.showToast({ title: '课前语音已保存', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '语音保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ uploadingVoice: false })
    }
  },

  // 看这场会议的实时记录，并能以老师身份插话（学生那边显示成老师发的）
  handleOpenRoom(event) {
    const dataset = event.currentTarget.dataset || {}
    const inviteId = String(dataset.inviteId || '')
    if (!inviteId) return
    // 带上学生编号：直播间右上角能打开这个学生的目标导图（2026-10-10）
    wx.navigateTo({ url: `/teacher/live-room/index?inviteId=${encodeURIComponent(inviteId)}&subject=${encodeURIComponent(String(dataset.subject || ''))}&studentProfileId=${encodeURIComponent(this.studentProfileId || '')}` })
  },

  async handleCancelInvite(event) {
    const inviteId = String(event.currentTarget.dataset.inviteId || '')
    const isLatest = Boolean(event.currentTarget.dataset.latest)
    if (!inviteId || this.data.canceling) return
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '取消这条预约？',
        content: isLatest
          ? '这是当前生效的预约，取消后已经发出去的链接学生都打不开了。'
          : '这条预约已被新的预约取代，取消后不再显示为可用。',
        confirmText: '取消预约',
        cancelText: '再想想',
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    this.setData({ canceling: true })
    try {
      const result = await cancelTeacherAgentInvite(this.studentProfileId, inviteId)
      this.applyResult(result)
      wx.showToast({ title: '预约已取消', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error && error.message ? error.message : '取消失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ canceling: false })
    }
  },

  onShareAppMessage(event) {
    const dataset = (event && event.target && event.target.dataset) || {}
    const token = String(dataset.token || '')
    if (!token) {
      // 右上角菜单分享没有携带邀请，退回首页，不分享一个空会议页。
      return { title: '知鹿学习', path: '/pages/home/index' }
    }
    const invite = { subject: String(dataset.subject || ''), scheduledOnlineAt: String(dataset.scheduledAt || '') }
    const share = {
      title: buildInviteShareTitle({
        studentName: this.data.profile.displayName,
        grade: this.data.profile.grade,
        ...invite
      }),
      path: `/learning/agent-invite/index?token=${encodeURIComponent(token)}`
    }
    return shareWithCover(this, share, this.inviteCover(invite))
  }
})
