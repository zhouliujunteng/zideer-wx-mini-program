const { loadCurrentUser, saveCurrentLearningProfile, isAuthenticationRequired } = require('../../services/identity')
const { postProfileUrl } = require('../../utils/referral-context')
const { todayDate, validBirthday, normalizeSemester, ageDisplay, gradeForBirthday } = require('../../utils/profile-form')

const gradeOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const semesterOptions = ['上学期', '下学期']
const textbookOptions = ['人教版', '北师大版', '苏教版', '沪教版', '鲁教版', '其他版本', '统编版', '浙教版']
const textbookCards = [['统编版', 'unified'], ['人教版', 'pep'], ['北师大版', 'beishi'], ['苏教版', 'sujiao'], ['浙教版', 'zhejiang'], ['其他版本', 'other']].map(([value, prefix]) => ({
  value, label: value, covers: ['language', 'math', 'english'].map((subject, index) => ({
    role: ['fan-card-back', 'fan-card-middle', 'fan-card-front'][index],
    src: `../../assets/profile-setup/textbook-covers/${prefix}-${subject}.jpg`
  }))
}))
const steps = [
  { id: 'identity', title: '以什么身份开始？', subtitle: '选择你的身份，开启接下来的学习旅程。', actionLabel: '下一步' },
  { id: 'basic', title: '先认识一下你', subtitle: '告诉我们怎么称呼你，以及你所在的地区。', actionLabel: '下一步' },
  { id: 'school', title: '了解学习环境', subtitle: '我们会据此匹配合适的学习内容。', actionLabel: '下一步' },
  { id: 'textbook', title: '选择教材版本', subtitle: '后续课程会按照你的教材来安排。', actionLabel: '完成档案' }
]

// 设计师新版身份选择：角色对画底图 + 左右人物卡（side 对应样式后缀）
const rolePairSources = {
  none: '../../assets/profile-setup/role-pair/role-pair.svg',
  student: '../../assets/profile-setup/role-pair/role-pair-student-active.svg',
  parent: '../../assets/profile-setup/role-pair/role-pair-parent-active.svg'
}
const roleCards = [
  { value: 'student', side: 'student', label: '我是学生', image: '../../assets/profile-setup/roles/student.png' },
  { value: 'guardian', side: 'parent', label: '我是家长', image: '../../assets/profile-setup/roles/parent.png' }
]

// 选「都不是」（grade=0）时没有教材概念：向导收为三步，学校步直接完成建档
function activeStepsFor(grade) {
  if (grade === 0) return [steps[0], steps[1], { ...steps[2], actionLabel: '完成档案' }]
  return steps
}

function navigationMetrics() {
  let info = {}
  try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch (error) {}
  const statusBarHeight = info.statusBarHeight == null ? 20 : info.statusBarHeight
  let menu = { height: 32, top: statusBarHeight + 6 }
  try { const actual = wx.getMenuButtonBoundingClientRect(); if (actual.height > 0) menu = actual } catch (error) {}
  const navigationBarHeight = menu.height + Math.max(0, menu.top - statusBarHeight) * 2
  return { statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 }
}

function schoolStageForGrade(grade) {
  if (grade === 0) return ''
  if (grade <= 6) return '小学'
  if (grade <= 9) return '初中'
  return '高中'
}

function gradeLabel(grade) {
  if (grade === 0) return '都不是'
  const stage = schoolStageForGrade(grade)
  const ordinal = stage === '小学' ? grade : stage === '初中' ? grade - 6 : grade - 9
  return `${stage}${ordinal}年级`
}

function currentSemesterIndex() {
  return new Date().getMonth() >= 7 ? 0 : 1
}

Page({
  data: {
    steps,
    activeSteps: activeStepsFor(7),
    textbookCards,
    rolePairSources,
    roleCards,
    errors: {},
    stepIndex: 0,
    gradeSheetVisible: false,
    gradeSheetClosing: false,
    successSheetVisible: false,
    regionPickerValue: [],
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    loading: true,
    loadFailed: false,
    saving: false,
    editing: false,
    birthdayChangeUsed: false,
    maxBirthday: todayDate(),
    gradeOptions,
    gradeLabels: gradeOptions.map(gradeLabel),
    semesterOptions,
    semesterLabels: ['上学期（上册）', '下学期（下册）'],
    textbookOptions,
    ageLabel: '',
    gradeAutoFilled: false,
    gradeDisplay: '',
    form: {
      accountType: '',
      gender: '',
      nickname: '',
      birthday: '',
      avatarUrl: '',
      avatarPath: '',
      grade: 7,
      gradeIndex: 6,
      gradeLabel: gradeLabel(7),
      schoolStage: '初中',
      semester: semesterOptions[currentSemesterIndex()],
      semesterIndex: currentSemesterIndex(),
      schoolName: '',
      textbookVersion: textbookOptions[0],
      textbookIndex: 0,
      regionDetail: ''
    }
  },

  async onLoad(options = {}) {
    this.disposed = false
    this.isEditing = String(options.edit || '') === '1'
    this.setData({ editing: this.isEditing, maxBirthday: todayDate(), ...navigationMetrics() })
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: this.isEditing ? '个人资料' : '完善学习档案' })
    await this.loadProfile()
  },

  onUnload() { this.disposed = true; clearTimeout(this.redirectTimer); clearTimeout(this.gradeSheetTimer) },
  onResize() { this.setData(navigationMetrics()) },

  handleBack() {
    if (this.data.saving || this.data.successSheetVisible) return
    if (this.data.gradeSheetVisible) { this.closeGradeSheet(); return }
    if (this.data.stepIndex > 0) { this.setData({ stepIndex: this.data.stepIndex - 1 }); return }
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: this.isEditing ? '/pages/me/index' : '/pages/home/index' })
  },

  handleRegionChange(event) {
    if (this.data.saving) return
    const values = event.detail.value || []
    const region = values.filter((value, index) => value && value !== values[index - 1]).join(' ')
    this.setData({ regionPickerValue: values, 'form.regionDetail': region, 'errors.region': '' })
  },

  openGradeSheet() {
    if (this.data.saving) return
    this.setData({ gradeSheetVisible: true, gradeSheetClosing: false })
  },
  closeGradeSheet() {
    if (!this.data.gradeSheetVisible || this.data.gradeSheetClosing) return
    this.setData({ gradeSheetClosing: true })
    this.gradeSheetTimer = setTimeout(() => {
      if (!this.disposed) this.setData({ gradeSheetVisible: false, gradeSheetClosing: false })
    }, 280)
  },
  stopTap() {},
  handleGradePick(event) {
    if (this.data.saving) return
    const grade = Number(event.currentTarget.dataset.grade)
    const semester = event.currentTarget.dataset.semester
    // 「都不是」：不在常规年级中，学段与学期留空，向导跳过教材步骤
    if (grade === 0) {
      this.gradeManuallyPicked = true
      this.setData({
        'form.grade': 0,
        'form.gradeIndex': -1,
        'form.gradeLabel': '都不是',
        'form.schoolStage': '',
        'form.semester': '',
        'form.semesterIndex': -1,
        'form.textbookVersion': '',
        'form.textbookIndex': -1,
        gradeDisplay: '都不是',
        gradeAutoFilled: false,
        'errors.grade': '',
        'errors.textbook': '',
        activeSteps: activeStepsFor(0)
      })
      this.closeGradeSheet()
      return
    }
    if (!gradeOptions.includes(grade) || !semesterOptions.includes(semester)) return
    this.setData({ activeSteps: activeStepsFor(grade) })
    this.chooseGrade({ detail: { value: grade - 1 } })
    this.chooseSemester({ detail: { value: semesterOptions.indexOf(semester) } })
    this.setData({ 'errors.grade': '' })
    this.closeGradeSheet()
  },
  handleTextbookPick(event) {
    const index = textbookOptions.indexOf(event.currentTarget.dataset.value)
    if (index < 0 || this.data.saving) return
    this.chooseTextbook({ detail: { value: index } })
    this.setData({ 'errors.textbook': '' })
  },
  handleAccountTypePick(event) {
    const value = event.currentTarget.dataset.value
    if (this.data.saving || !['student', 'guardian'].includes(value)) return
    this.setData({ 'form.accountType': value, 'errors.accountType': '' })
  },
  handleGenderPick(event) {
    const value = event.currentTarget.dataset.value
    if (this.data.saving || !['male', 'female'].includes(value)) return
    this.setData({ 'form.gender': value, 'errors.gender': '' })
  },
  async handleNext() {
    if (this.data.saving || this.data.loading || this.data.loadFailed || this.data.successSheetVisible) return
    const form = this.data.form
    const errors = {}
    if (this.data.stepIndex === 0) {
      if (!['student', 'guardian'].includes(form.accountType)) errors.accountType = '请选择学生或家长身份'
    } else if (this.data.stepIndex === 1) {
      if (!form.nickname.trim()) errors.name = '请填写昵称或姓名'
      if (!['male', 'female'].includes(form.gender)) errors.gender = '请选择性别'
      if (!form.regionDetail.trim()) errors.region = '请选择所在地区'
      if (!form.birthday) errors.birthday = '请选择出生日期'
      else if (!validBirthday(form.birthday)) errors.birthday = '请选择有效的出生日期'
    } else if (this.data.stepIndex === 2) {
      if (!form.schoolName.trim()) errors.school = '请填写学校名称'
      if (!(form.grade === 0 || gradeOptions.includes(form.grade)) || (form.grade !== 0 && !semesterOptions.includes(form.semester))) errors.grade = '请选择年级和学期'
    } else if (!form.textbookVersion) errors.textbook = '请选择教材版本'
    this.setData({ errors })
    const first = Object.values(errors)[0]
    if (first) { wx.showToast({ title: first, icon: 'none' }); return }
    if (this.data.stepIndex < this.data.activeSteps.length - 1) this.setData({ stepIndex: this.data.stepIndex + 1 })
    else await this.saveProfile()
  },
  handleSuccessContinue() {
    if (!this.data.successSheetVisible) return
    wx.reLaunch({ url: this.isEditing ? '/pages/me/index' : postProfileUrl() })
  },

  async loadProfile() {
    if (this.data.saving) return
    const requestId = this.loadRequestId = (this.loadRequestId || 0) + 1
    this.setData({ loading: true, loadFailed: false })
    try {
      const user = await loadCurrentUser()
      if (this.disposed || requestId !== this.loadRequestId) return
      if (user.profileCompleted && !this.isEditing) {
        getApp().globalData.user = user
        wx.reLaunch({ url: postProfileUrl() })
        return
      }

      const profile = user.profile || {}
      this.originalBirthday = profile.birthday || ''
      const rawGrade = Number(profile.current_grade)
      const grade = Number.isInteger(rawGrade) && rawGrade >= 0 && rawGrade <= 12 ? rawGrade : 7
      const semester = normalizeSemester(profile.semester) || (profile.id ? '' : semesterOptions[currentSemesterIndex()])
      const semesterIndex = semesterOptions.indexOf(semester)
      // 「都不是」（grade=0）没有教材：不回填默认教材版本
      const textbookIndex = grade === 0 ? -1 : Math.max(0, textbookOptions.indexOf(profile.textbook_version))
      // 服务器已有年级视为用户已手动确定，后续改生日不再自动覆盖
      this.gradeManuallyPicked = Boolean(profile.current_grade)
      this.setData({
        birthdayChangeUsed: profile.birthday_change_used === true,
        originalBirthday: profile.birthday || '',
        ageLabel: ageDisplay(profile.birthday || ''),
        gradeAutoFilled: false,
        gradeDisplay: grade === 0 ? '都不是' : (semester ? `${gradeLabel(grade)} · ${semester}` : ''),
        activeSteps: activeStepsFor(grade),
        form: {
          accountType: ['student', 'guardian'].includes(profile.account_type) ? profile.account_type : '',
          gender: ['male', 'female'].includes(profile.gender) ? profile.gender : '',
          profileId: profile.id || null,
          nickname: profile.nickname || '',
          birthday: profile.birthday || '',
          avatarUrl: profile.avatar_url || '',
          avatarPath: '',
          grade,
          gradeIndex: grade - 1,
          gradeLabel: gradeLabel(grade),
          schoolStage: schoolStageForGrade(grade),
          semester,
          semesterIndex,
          schoolName: profile.school_name || '',
          textbookVersion: textbookIndex >= 0 ? textbookOptions[textbookIndex] : '',
          textbookIndex,
          regionDetail: profile.region_detail || ''
        }
      })
    } catch (error) {
      if (this.disposed || requestId !== this.loadRequestId) return
      if (isAuthenticationRequired(error)) {
        wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' })
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '学习档案暂时无法读取，请稍后重试', icon: 'none' })
    } finally {
      if (!this.disposed && requestId === this.loadRequestId) this.setData({ loading: false })
    }
  },

  updateTextField(event) {
    if (this.data.saving) return
    const key = event.currentTarget.dataset.key
    if (!['nickname', 'schoolName', 'regionDetail'].includes(key)) return
    const errorKey = { nickname: 'name', schoolName: 'school', regionDetail: 'region' }[key]
    this.setData({ [`form.${key}`]: event.detail.value, [`errors.${errorKey}`]: '' })
  },

  chooseAvatar(event) {
    if (this.data.saving || this.data.loading || this.data.loadFailed) return
    const path = event.detail && event.detail.avatarUrl
    if (path) this.setData({ 'form.avatarPath': path })
  },

  chooseBirthday(event) {
    if (this.data.saving) return
    const value = event.detail.value
    if (!value) return
    // 生日首次设置后仅允许修改一次：修改前必须确认，机会用完后不可再改
    if (this.originalBirthday && value !== this.originalBirthday) {
      if (this.data.birthdayChangeUsed) {
        wx.showToast({ title: '生日仅能修改一次，修改机会已用完', icon: 'none' })
        return
      }
      const pending = value
      wx.showModal({
        title: '生日仅能修改一次',
        content: `生日将从 ${this.originalBirthday} 改为 ${pending}，确认后将无法再次修改。`,
        confirmText: '确认修改',
        cancelText: '再想想',
        success: result => { if (result.confirm && !this.data.saving) this.applyBirthday(pending) }
      })
      return
    }
    this.applyBirthday(value)
  },

  // 生日确定后：更新年龄展示，并在用户未手动选择年级时按学制自动预估年级与学期。
  applyBirthday(value) {
    const patch = { 'form.birthday': value, 'errors.birthday': '', ageLabel: ageDisplay(value) }
    if (!this.gradeManuallyPicked) {
      const grade = gradeForBirthday(value)
      if (grade) {
        const semesterIndex = currentSemesterIndex()
        Object.assign(patch, {
          'form.grade': grade,
          'form.gradeIndex': grade - 1,
          'form.gradeLabel': gradeLabel(grade),
          'form.schoolStage': schoolStageForGrade(grade),
          'form.semester': semesterOptions[semesterIndex],
          'form.semesterIndex': semesterIndex,
          gradeDisplay: `${gradeLabel(grade)} · ${semesterOptions[semesterIndex]}`,
          gradeAutoFilled: true,
          'errors.grade': '',
          activeSteps: activeStepsFor(grade)
        })
      }
    }
    this.setData(patch)
  },

  updateGradeDisplay() {
    const form = this.data.form
    this.setData({ gradeDisplay: form.grade === 0 ? '都不是' : (form.semester ? `${form.gradeLabel} · ${form.semester}` : '') })
  },

  chooseGrade(event) {
    if (this.data.saving) return
    const gradeIndex = Number(event.detail.value)
    const grade = gradeOptions[gradeIndex]
    if (!grade) return
    this.gradeManuallyPicked = true
    this.setData({
      'form.grade': grade,
      'form.gradeIndex': gradeIndex,
      'form.gradeLabel': gradeLabel(grade),
      'form.schoolStage': schoolStageForGrade(grade),
      gradeAutoFilled: false
    })
    this.updateGradeDisplay()
  },

  chooseSemester(event) {
    if (this.data.saving) return
    const semesterIndex = Number(event.detail.value)
    if (!semesterOptions[semesterIndex]) return
    this.gradeManuallyPicked = true
    this.setData({
      'form.semesterIndex': semesterIndex,
      'form.semester': semesterOptions[semesterIndex],
      gradeAutoFilled: false
    })
    this.updateGradeDisplay()
  },

  chooseTextbook(event) {
    if (this.data.saving) return
    const textbookIndex = Number(event.detail.value)
    if (!textbookOptions[textbookIndex]) return
    this.setData({
      'form.textbookIndex': textbookIndex,
      'form.textbookVersion': textbookOptions[textbookIndex]
    })
  },

  validateForm() {
    const form = this.data.form
    if (!['student', 'guardian'].includes(form.accountType)) return '请选择学生或家长身份'
    if (!form.nickname.trim()) return '请填写昵称或姓名'
    if (!['male', 'female'].includes(form.gender)) return '请选择性别'
    if (!form.birthday || !validBirthday(form.birthday)) return '请选择有效的出生日期，不能晚于今天'
    if (!Number.isInteger(form.grade) || form.grade < 0 || form.grade > 12) return '请选择年级'
    if (form.grade !== 0 && !semesterOptions.includes(form.semester)) return '请选择上学期或下学期'
    if (!form.regionDetail.trim()) return '请填写所在地区'
    if (!form.schoolName.trim()) return '请填写学校名称'
    if (form.grade !== 0 && !form.textbookVersion) return '请选择教材版本'
    return ''
  },

  async saveProfile() {
    if (this.data.saving || this.data.loading || this.disposed || this.data.successSheetVisible) return
    if (this.data.loadFailed) {
      await this.loadProfile()
      return
    }
    const validationMessage = this.validateForm()
    if (validationMessage) {
      wx.showToast({ title: validationMessage, icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      const user = await saveCurrentLearningProfile(this.data.form)
      getApp().globalData.user = user
      if (this.disposed) return
      this.setData({ saving: false, successSheetVisible: true })
    } catch (error) {
      if (this.disposed) return
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none', duration: 2600 })
      this.setData({ saving: false })
    }
  }
})
