const { loadCurrentUser, saveCurrentLearningProfile, isAuthenticationRequired } = require('../../services/identity')
const { postProfileUrl } = require('../../utils/referral-context')

const gradeOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const semesterOptions = ['上学期', '下学期']
const textbookOptions = ['人教版', '北师大版', '苏教版', '沪教版', '鲁教版', '其他版本']

function schoolStageForGrade(grade) {
  if (grade <= 6) return '小学'
  if (grade <= 9) return '初中'
  return '高中'
}

function gradeLabel(grade) {
  const stage = schoolStageForGrade(grade)
  const ordinal = stage === '小学' ? grade : stage === '初中' ? grade - 6 : grade - 9
  return `${stage}${ordinal}年级`
}

function currentSemesterIndex() {
  return new Date().getMonth() >= 7 ? 0 : 1
}

Page({
  data: {
    loading: true,
    loadFailed: false,
    saving: false,
    gradeOptions,
    semesterOptions,
    textbookOptions,
    form: {
      nickname: '',
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

  async onLoad() {
    await this.loadProfile()
  },

  async loadProfile() {
    if (this.data.saving) return
    this.setData({ loading: true, loadFailed: false })
    try {
      const user = await loadCurrentUser()
      if (user.profileCompleted) {
        getApp().globalData.user = user
        wx.reLaunch({ url: postProfileUrl() })
        return
      }

      const profile = user.profile || {}
      const grade = Number(profile.current_grade) || 7
      const semesterIndex = Math.max(0, semesterOptions.indexOf(profile.semester))
      const textbookIndex = Math.max(0, textbookOptions.indexOf(profile.textbook_version))
      this.setData({
        form: {
          nickname: profile.nickname || '',
          grade,
          gradeIndex: grade - 1,
          gradeLabel: gradeLabel(grade),
          schoolStage: schoolStageForGrade(grade),
          semester: semesterOptions[semesterIndex],
          semesterIndex,
          schoolName: profile.school_name || '',
          textbookVersion: textbookOptions[textbookIndex],
          textbookIndex,
          regionDetail: profile.region_detail || ''
        }
      })
    } catch (error) {
      if (isAuthenticationRequired(error)) {
        wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' })
        wx.reLaunch({ url: '/pages/login/login' })
        return
      }
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '学习档案暂时无法读取，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  updateTextField(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: event.detail.value })
  },

  chooseGrade(event) {
    const gradeIndex = Number(event.detail.value)
    const grade = gradeOptions[gradeIndex]
    this.setData({
      'form.grade': grade,
      'form.gradeIndex': gradeIndex,
      'form.gradeLabel': gradeLabel(grade),
      'form.schoolStage': schoolStageForGrade(grade)
    })
  },

  chooseSemester(event) {
    const semesterIndex = Number(event.detail.value)
    this.setData({
      'form.semesterIndex': semesterIndex,
      'form.semester': semesterOptions[semesterIndex]
    })
  },

  chooseTextbook(event) {
    const textbookIndex = Number(event.detail.value)
    this.setData({
      'form.textbookIndex': textbookIndex,
      'form.textbookVersion': textbookOptions[textbookIndex]
    })
  },

  validateForm() {
    const form = this.data.form
    if (!form.nickname.trim()) return '请填写昵称或姓名'
    if (!Number.isInteger(form.grade) || form.grade < 1 || form.grade > 12) return '请选择年级'
    if (!form.regionDetail.trim()) return '请填写所在地区'
    if (!form.schoolName.trim()) return '请填写学校名称'
    if (!form.textbookVersion) return '请选择教材版本'
    return ''
  },

  async saveProfile() {
    if (this.data.saving) return
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
      wx.showToast({ title: '学习档案已保存', icon: 'success' })
      setTimeout(() => wx.reLaunch({ url: postProfileUrl() }), 450)
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none', duration: 2600 })
    } finally {
      this.setData({ saving: false })
    }
  }
})
