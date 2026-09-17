const { getProfileModel } = require('../../services/mock-service')
const { loadCurrentUser, saveCurrentLearningProfile, isAuthenticationRequired } = require('../../services/identity')

const STORAGE_KEY = 'zhilu-mock-profile-setup'

function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

function getSavedValues() {
  try {
    const values = wx.getStorageSync(STORAGE_KEY)
    return values && typeof values === 'object' ? values : {}
  } catch (error) {
    return {}
  }
}

Page({
  data: {
    model: {},
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    regionPickerValue: [],
    birthdayPickerValue: '2012-01-01',
    textSheetVisible: false,
    textSheetClosing: false,
    textSheetFocus: false,
    textSheetField: '',
    textSheetTitle: '',
    textSheetPlaceholder: '',
    textSheetValue: '',
    textSheetOpening: false,
    keyboardHeight: 0,
    gradeSheetVisible: false,
    gradeSheetClosing: false,
    textbookSheetVisible: false,
    textbookSheetClosing: false,
    textbookPendingValue: ''
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : {
          left: windowWidth - 92,
          top: (windowInfo.statusBarHeight || 20) + 6,
          width: 87,
          height: 32
        }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    const model = getProfileModel(getSavedValues())
    model.avatarSrc = this.pendingAvatarPath || ''
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      model,
      regionPickerValue: model.regionPickerValue || [],
      birthdayPickerValue: model.birthdayPickerValue || '2012-01-01'
    })
    this.keyboardHeightHandler = (result) => {
      const keyboardHeight = Number(result && result.height) || 0
      // 输入弹窗完成入场前，忽略键盘回调，避免入场动画和键盘动画同时改写 bottom。
      if (this.data.textSheetOpening) {
        if (keyboardHeight === 0 && this.data.keyboardHeight !== 0) {
          this.setData({ keyboardHeight: 0 })
        }
        return
      }
      this.setData({ keyboardHeight })
    }
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this.keyboardHeightHandler)
  },

  async onShow() {
    const model = getProfileModel(getSavedValues())
    // 头像只以后端为准；本地只保留尚未保存的新头像预览
    model.avatarSrc = this.pendingAvatarPath || ''
    this.setData({
      model,
      regionPickerValue: model.regionPickerValue || [],
      birthdayPickerValue: model.birthdayPickerValue || '2012-01-01'
    })
    await this.loadBackendProfile()
  },

  async loadBackendProfile() {
    try {
      const user = await loadCurrentUser()
      const profile = user && user.profile || {}
      this.originalBirthday = profile.birthday || ''
      this.birthdayChangeUsed = profile.birthday_change_used === true
      const grade = Number(profile.current_grade) || 7
      const semester = profile.semester || '上学期'
      const model = clone(this.data.model)
      model.name = profile.nickname || model.name
      model.avatarSrc = this.pendingAvatarPath || profile.avatar_url || ''
      model.gradeValue = `${grade}年级`
      model.semesterValue = semester
      const values = { region: profile.region_detail || '未设置', school: profile.school_name || '未设置', grade: `${grade}年级${semester}`, birthday: profile.birthday || '未设置', textbook: profile.textbook_version || '未设置' }
      model.rows = model.rows.map((row) => values[row.id] !== undefined ? { ...row, value: values[row.id] } : row)
      this.setData({ model })
    } catch (error) {
      if (isAuthenticationRequired(error)) wx.reLaunch({ url: '/pages/login/login' })
    }
  },

  onUnload() {
    if (this.textSheetFocusTimer) {
      clearTimeout(this.textSheetFocusTimer)
      this.textSheetFocusTimer = null
    }
    if (this.keyboardHeightHandler && wx.offKeyboardHeightChange) {
      wx.offKeyboardHeightChange(this.keyboardHeightHandler)
    }
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  editName() {
    this.openTextSheet('name')
  },

  handleChooseAvatar(e) {
    const tempFilePath = e.detail && e.detail.avatarUrl
    if (!tempFilePath) return
    // 选择的头像需点「保存」上传到后端，否则「我的」页读取不到
    this.pendingAvatarPath = tempFilePath
    this.setData({ 'model.avatarSrc': tempFilePath })
    wx.showToast({ title: '点击保存后生效', icon: 'none' })
  },

  stopTap() {},

  getRowValue(id) {
    const row = (this.data.model.rows || []).find((item) => item.id === id)
    return row ? row.value : '未设置'
  },

  openTextSheet(field) {
    const isName = field === 'name'
    const schoolValue = this.getRowValue('school')
    if (this.textSheetFocusTimer) clearTimeout(this.textSheetFocusTimer)
    this.setData({
      textSheetVisible: true,
      textSheetClosing: false,
      textSheetFocus: false,
      textSheetOpening: true,
      textSheetField: field,
      textSheetTitle: isName ? '更改姓名' : '更改学校名称',
      textSheetPlaceholder: isName ? '请输入姓名或昵称' : '请输入学校名称',
      textSheetValue: isName ? (this.data.model.name || '') : (schoolValue === '未设置' ? '' : schoolValue)
    })
    this.textSheetFocusTimer = setTimeout(() => {
      this.textSheetFocusTimer = null
      if (this.data.textSheetVisible && !this.data.textSheetClosing) {
        this.setData({ textSheetOpening: false, textSheetFocus: true })
      }
    }, 340)
  },

  handleTextSheetInput(e) {
    this.setData({ textSheetValue: e.detail.value })
  },

  confirmTextSheet() {
    const value = String(this.data.textSheetValue || '').trim()
    if (!value) {
      wx.showToast({ title: this.data.textSheetField === 'name' ? '名称不能为空' : '学校名称不能为空', icon: 'none' })
      return
    }
    const model = clone(this.data.model)
    if (this.data.textSheetField === 'name') {
      model.name = value
    } else {
      model.rows = model.rows.map((row) => row.id === 'school' ? { ...row, value } : row)
    }
    this.setData({ model })
    this.closeTextSheet()
  },

  closeTextSheet() {
    if (!this.data.textSheetVisible || this.data.textSheetClosing) return
    if (this.textSheetFocusTimer) {
      clearTimeout(this.textSheetFocusTimer)
      this.textSheetFocusTimer = null
    }
    this.setData({ textSheetFocus: false, textSheetOpening: false, textSheetClosing: true })
    setTimeout(() => {
      this.setData({ textSheetVisible: false, textSheetClosing: false, keyboardHeight: 0 })
    }, 280)
  },

  handleRegionChange(e) {
    const values = e.detail.value || []
    const selectedValues = values.filter(Boolean)
    const region = selectedValues.length > 1 && selectedValues[0] === selectedValues[1]
      ? selectedValues[0]
      : selectedValues.join(' ')
    this.updateRowValue('region', region || '未设置')
    this.setData({ regionPickerValue: values })
  },

  handleBirthdayChange(e) {
    const value = e.detail.value || ''
    if (!value) return
    // 生日首次设置后仅允许修改一次：修改前必须确认，机会用完后不可再改
    if (this.originalBirthday && value !== this.originalBirthday) {
      if (this.birthdayChangeUsed) {
        wx.showToast({ title: '生日仅能修改一次，修改机会已用完', icon: 'none' })
        return
      }
      wx.showModal({
        title: '生日仅能修改一次',
        content: `生日将从 ${this.originalBirthday} 改为 ${value}，确认后将无法再次修改。`,
        confirmText: '确认修改',
        cancelText: '再想想',
        success: result => {
          if (!result.confirm) return
          this.updateRowValue('birthday', value)
          this.setData({ birthdayPickerValue: value })
        }
      })
      return
    }
    this.updateRowValue('birthday', value)
    this.setData({ birthdayPickerValue: value })
  },

  updateRowValue(id, value) {
    const model = clone(this.data.model)
    model.rows = model.rows.map((row) => row.id === id ? { ...row, value } : row)
    this.setData({ model })
  },

  openGradeSheet() {
    this.setData({ gradeSheetVisible: true, gradeSheetClosing: false })
  },

  closeGradeSheet() {
    if (!this.data.gradeSheetVisible || this.data.gradeSheetClosing) return
    this.setData({ gradeSheetClosing: true })
    setTimeout(() => {
      this.setData({ gradeSheetVisible: false, gradeSheetClosing: false })
    }, 280)
  },

  handleGradePick(e) {
    const grade = e.currentTarget.dataset.grade || ''
    const semester = e.currentTarget.dataset.semester || ''
    const model = clone(this.data.model)
    model.gradeValue = grade
    model.semesterValue = semester
    model.gradeRows = (model.gradeRows || []).map((row) => ({
      ...row,
      options: row.options.map((option) => ({
        ...option,
        isSelected: row.grade === grade && option.semester === semester
      }))
    }))
    model.rows = model.rows.map((row) => row.id === 'grade' ? { ...row, value: `${grade}${semester}` } : row)
    this.setData({ model })
    this.closeGradeSheet()
  },

  openTextbookSheet() {
    const currentValue = this.getRowValue('textbook')
    this.setData({
      textbookSheetVisible: true,
      textbookSheetClosing: false,
      textbookPendingValue: currentValue === '未设置' ? '' : currentValue
    })
  },

  closeTextbookSheet() {
    if (!this.data.textbookSheetVisible || this.data.textbookSheetClosing) return
    this.setData({ textbookSheetClosing: true })
    setTimeout(() => {
      this.setData({ textbookSheetVisible: false, textbookSheetClosing: false })
    }, 280)
  },

  handleTextbookPick(e) {
    const value = e.currentTarget.dataset.value || ''
    this.setData({ textbookPendingValue: value })
  },

  confirmTextbookPick() {
    const value = this.data.textbookPendingValue || ''
    if (!value) {
      wx.showToast({ title: '请选择教材版本', icon: 'none' })
      return
    }
    const model = clone(this.data.model)
    model.textbookCards = (model.textbookCards || []).map((card) => ({ ...card, isSelected: card.value === value }))
    model.rows = model.rows.map((row) => row.id === 'textbook' ? { ...row, value } : row)
    this.setData({ model })
    this.closeTextbookSheet()
  },

  async handleSave() {
    const model = this.data.model || {}
    const storedValue = (id) => {
      const value = this.getRowValue(id)
      return value === '未设置' ? '' : value
    }
    const { avatarSrc, ...previousValues } = getSavedValues()
    const savedValues = {
      ...previousValues,
      name: model.name || '',
      region: storedValue('region'),
      school: storedValue('school'),
      grade: model.gradeValue || '',
      semester: model.semesterValue || '',
      birthday: storedValue('birthday'),
      textbook: storedValue('textbook'),
      regionPickerValue: this.data.regionPickerValue || []
    }
    wx.setStorageSync(STORAGE_KEY, savedValues)
    if (this.saving) return
    this.saving = true
    const avatarPath = this.pendingAvatarPath || ''
    if (avatarPath) wx.showLoading({ title: '正在保存', mask: true })
    try {
      const user = await saveCurrentLearningProfile({
        accountType: 'student', nickname: model.name || '', birthday: savedValues.birthday || '',
        grade: Number.parseInt(model.gradeValue, 10) || 7, semester: model.semesterValue || '上学期',
        schoolName: savedValues.school || '', textbookVersion: savedValues.textbook || '', regionDetail: savedValues.region || '', avatarPath
      })
      if (this.pendingAvatarPath === avatarPath) this.pendingAvatarPath = ''
      const avatarUrl = user && user.profile && user.profile.avatar_url
      if (avatarUrl && !this.pendingAvatarPath) this.setData({ 'model.avatarSrc': avatarUrl })
      if (avatarPath) wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'none' })
    } catch (error) {
      if (avatarPath) wx.hideLoading()
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' })
    } finally {
      this.saving = false
    }
  },

  handleRow(e) {
    const action = e.currentTarget.dataset.action
    if (action === 'name') return this.openTextSheet('name')
    if (action === 'school') return this.openTextSheet('school')
    if (action === 'grade' || action === 'semester') return this.openGradeSheet()
    if (action === 'textbook') return this.openTextbookSheet()
  }
})
