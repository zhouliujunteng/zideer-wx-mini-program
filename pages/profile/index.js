const { getProfileModel } = require('../../services/mock-service')
const {
  loadCurrentUser, saveCurrentLearningProfile, isAuthenticationRequired,
  loadCurrentReferrer, bindCurrentPromotionCode
} = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { clearPendingReferral } = require('../../utils/referral-context')

const STORAGE_KEY = 'zhilu-mock-profile-setup'

function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

const GENDER_LABELS = { male: '男', female: '女' }
// 实名认证后按身份证锁定的行（2026-09-26 用户规则）：行 id → 资料里的锁定标记
const LOCKED_ROWS = { gender: 'gender_locked', birthday: 'birthday_locked', household: 'household_region_locked' }

// 地区选择器（只选到城市）的结果：直辖市省、市同名只留一个
function regionText(values) {
  const selected = (values || []).filter(Boolean)
  return selected.length > 1 && selected[0] === selected[1] ? selected[0] : selected.join(' ')
}

function getSavedValues() {
  try {
    const values = wx.getStorageSync(STORAGE_KEY)
    return values && typeof values === 'object' ? values : {}
  } catch (error) {
    return {}
  }
}

// 第一次读到后端资料前的模型：只保留固定结构（行标题、年级与教材选项），姓名和各行取值留空，由页面画骨架。
// 不再用演示数据或本机旧副本填值，避免先闪别人的名字、默认年级再换成真实资料。
function blankProfileModel() {
  const model = getProfileModel({})
  model.name = ''
  model.avatarSrc = ''
  model.rows = model.rows.map((row) => ({ ...row, value: '' }))
  return model
}

Page({
  data: {
    model: {},
    // 资料第一次读到前姓名、各行取值、头像显示骨架；之后回到页面保留旧资料，后台静默刷新
    profileLoaded: false,
    profileFailed: false,
    // 推荐人：进页面后单独拉，读失败只降级显示，不影响资料本身（我的邀请码在推广伙伴 › 我的邀请码）
    promotion: { loading: true, loaded: false, referrerCode: '' },
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    regionPickerValue: [],
    householdPickerValue: [],
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
    attachUiAssets(this)
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
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      model: blankProfileModel()
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
    // 已读到过资料就保留在屏上静默刷新；头像只以后端为准，本地只保留尚未保存的新头像预览
    if (!this.data.model || !this.data.model.rows) this.setData({ model: blankProfileModel() })
    await this.loadBackendProfile()
    void this.loadPromotionSection()
  },

  // 谁把我带进来的。读失败只降级成「暂无推荐人」，不影响资料本身。
  async loadPromotionSection() {
    if (this._promotionLoading) return
    this._promotionLoading = true
    this.setData({ 'promotion.loading': true })
    const referrer = await loadCurrentReferrer().catch(() => null)
    this._promotionLoading = false
    if (this.disposed) return
    this.setData({
      promotion: {
        loading: false,
        loaded: true,
        referrerCode: referrer && referrer.referrer && referrer.referrer.promotionCode || ''
      }
    })
  },

  // 没有推荐人时可以补填一次；绑定成功或已有推荐人都重新拉一次展示。
  bindReferrerCode() {
    wx.showModal({
      title: '填写邀请码',
      editable: true,
      placeholderText: '输入邀请人的邀请码',
      confirmText: '绑定',
      success: async (result) => {
        if (!result.confirm) return
        const code = String(result.content || '').trim()
        if (!code) return
        try {
          const bound = await bindCurrentPromotionCode(code)
          // 手填成功后，扫码留下的待绑定线索就没用了，清掉免得首页再试一次
          clearPendingReferral()
          wx.showToast({
            title: bound.alreadyBound ? '你已有推荐人'
              : bound.rewardCredits > 0 ? `绑定成功，获得 ${bound.rewardCredits} 积分`
              : '已绑定推荐人',
            icon: bound.alreadyBound ? 'none' : 'success',
            duration: bound.rewardCredits > 0 ? 2600 : 1500
          })
          void this.loadPromotionSection()
        } catch (error) {
          if (error && error.terminalReferral) clearPendingReferral()
          wx.showToast({ title: error.message || '绑定失败', icon: 'none', duration: 2600 })
        }
      }
    })
  },

  async loadBackendProfile() {
    try {
      const user = await loadCurrentUser()
      const profile = user && user.profile || {}
      this.originalBirthday = profile.birthday || ''
      this.birthdayChangeUsed = profile.birthday_change_used === true
      this.genderValue = GENDER_LABELS[profile.gender] ? profile.gender : ''
      // 年级 0 是「都不是」，家长档案也记 0：不能按 falsy 退回 7 年级
      const noGrade = profile.current_grade === 0
      this.accountType = ['student', 'guardian'].includes(profile.account_type) ? profile.account_type : 'student'
      const grade = noGrade ? 0 : Number(profile.current_grade) || 7
      const semester = noGrade ? '' : profile.semester || '上学期'
      const model = clone(this.data.model.rows ? this.data.model : blankProfileModel())
      model.name = profile.nickname || ''
      model.avatarSrc = this.pendingAvatarPath || profile.avatar_url || ''
      model.gradeValue = noGrade ? '都不是' : `${grade}年级`
      model.semesterValue = semester
      const values = { gender: GENDER_LABELS[profile.gender] || '未设置', region: profile.region_detail || '未设置', household: profile.household_region || '未设置', school: profile.school_name || '未设置', grade: noGrade ? '都不是' : `${grade}年级${semester}`, birthday: profile.birthday || '未设置', textbook: profile.textbook_version || '未设置' }
      // 家长档案没有学校、年级、教材（2026-09-24）：这三行不显示
      const guardianHidden = profile.account_type === 'guardian' ? ['school', 'grade', 'textbook'] : []
      model.rows = blankProfileModel().rows.filter((row) => !guardianHidden.includes(row.id))
        .map((row) => values[row.id] !== undefined ? { ...row, value: values[row.id], locked: profile[LOCKED_ROWS[row.id]] === true } : row)
      // 家长还没实名：提示实名后会按身份证自动填写
      model.footerNote = profile.account_type === 'guardian' && !profile.birthday_locked
        ? '完成实名认证后，生日、性别和户籍地会按身份证自动填写，之后不能修改。'
        : blankProfileModel().footerNote
      this.setData({ model, profileLoaded: true, profileFailed: false })
    } catch (error) {
      if (isAuthenticationRequired(error)) return wx.reLaunch({ url: '/pages/login/login' })
      // 首次失败给重试；已有资料时保留旧资料
      if (!this.data.profileLoaded) this.setData({ profileFailed: true })
      wx.showToast({ title: error.message || '资料读取失败', icon: 'none' })
    }
  },

  retryLoadProfile() {
    this.setData({ profileFailed: false })
    return this.loadBackendProfile()
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
    // 选完立即上传保存：用户常以为授权即生效，不点「保存」就返回，「我的」页便读不到头像
    this.pendingAvatarPath = tempFilePath
    this.setData({ 'model.avatarSrc': tempFilePath })
    return this.saveAvatar(tempFilePath)
  },

  // 只保存头像：其余字段取后端当前值，不连带提交页面上尚未保存的修改；生日、身份、性别不传，保持原样
  async saveAvatar(avatarPath) {
    if (this.saving) return
    this.saving = true
    wx.showLoading({ title: '正在保存头像', mask: true })
    try {
      const current = await loadCurrentUser()
      const profile = current && current.profile
      if (!profile || !profile.id) throw new Error('请先完善学习档案。')
      const user = await saveCurrentLearningProfile({
        profileId: profile.id, nickname: profile.nickname || '', grade: profile.current_grade === 0 ? 0 : Number(profile.current_grade) || 7,
        schoolStage: profile.school_stage || '', semester: profile.current_grade === 0 ? '' : profile.semester || '上学期', schoolName: profile.school_name || '',
        textbookVersion: profile.textbook_version || '', regionDetail: profile.region_detail || '', avatarPath
      })
      if (this.pendingAvatarPath === avatarPath) this.pendingAvatarPath = ''
      const avatarUrl = user && user.profile && user.profile.avatar_url
      if (avatarUrl && !this.pendingAvatarPath) this.setData({ 'model.avatarSrc': avatarUrl })
      wx.hideLoading()
      wx.showToast({ title: '头像已更新', icon: 'none' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: error.message || '头像保存失败，请重试', icon: 'none' })
    } finally {
      this.saving = false
    }
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
    this.updateRowValue('region', regionText(values) || '未设置')
    this.setData({ regionPickerValue: values })
  },

  handleHouseholdChange(e) {
    const values = e.detail.value || []
    this.updateRowValue('household', regionText(values) || '未设置')
    this.setData({ householdPickerValue: values })
  },

  openGenderSheet() {
    wx.showActionSheet({
      itemList: ['男', '女'],
      success: ({ tapIndex }) => {
        const gender = ['male', 'female'][tapIndex]
        if (!gender) return
        this.genderValue = gender
        this.updateRowValue('gender', GENDER_LABELS[gender])
      }
    })
  },

  handleLockedRow(e) {
    wx.showToast({ title: `${e.currentTarget.dataset.label || '这一项'}已按实名认证信息填写，不能修改`, icon: 'none' })
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
    // 资料还没读到时不能保存，否则会用空值覆盖后端资料
    if (!this.data.profileLoaded) return wx.showToast({ title: '资料还在读取，请稍后再保存', icon: 'none' })
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
      // 身份沿用已存的（不能写死学生，否则家长一保存就变成学生）；家长与「都不是」年级记 0、没有学期
      const accountType = this.accountType || 'student'
      const guardian = accountType === 'guardian'
      const noGrade = guardian || model.gradeValue === '都不是'
      const user = await saveCurrentLearningProfile({
        accountType, nickname: model.name || '', birthday: savedValues.birthday || '', gender: this.genderValue || '', householdRegion: storedValue('household'),
        grade: noGrade ? 0 : Number.parseInt(model.gradeValue, 10) || 7, semester: noGrade ? '' : model.semesterValue || '上学期',
        schoolName: guardian ? '' : savedValues.school || '', textbookVersion: guardian ? '' : savedValues.textbook || '', regionDetail: savedValues.region || '', avatarPath
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
    if (action === 'gender') return this.openGenderSheet()
    if (action === 'school') return this.openTextSheet('school')
    if (action === 'grade' || action === 'semester') return this.openGradeSheet()
    if (action === 'textbook') return this.openTextbookSheet()
  }
})
