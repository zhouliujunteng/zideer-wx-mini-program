const { loadCurrentLoginIdentities, loadCurrentUser, saveCurrentLearningProfile, submitCurrentGuardianIdentityVerification } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { roleLabel } = require('../../utils/business-labels')
const { basicInfoComplete, studentInfoComplete, studentInfoSummary } = require('../../utils/account-switch')

// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 d9627f0 的 M63 身份与登录页（2026-09-19 同步）。
// 实名认证弹层同步自设计仓库，提交走现有身份证核验动作流：后端目前只能核验 18 位居民身份证，
// 所以证件类型只提供「身份证」（设计稿另有永久居留证、港澳 / 台湾通行证，待后端支持后再加）。
// 本页不做邮箱功能（2026-09-27 用户要求去掉）：联系方式只有手机号，设计稿的邮箱行与邮箱验证码绑定都不要加回来。
// 未移植：「认领原账号 / 账号合并 / 解除旧微信」三个仅演示的管理入口，以及设计稿右上角切换实名状态的演示菜单。

const channelLabels = {
  wechat_miniprogram: '微信小程序',
  wechat_miniapp: '微信小程序',
  wechat: '微信',
  phone: '手机号',
  web: '网页登录'
}

// tone 对应设计稿 .real-name-status 的 success / pending / failed / muted；actionLabel 为空时不显示按钮。
const verificationStates = {
  verified: { label: '已完成认证', tone: 'success', actionLabel: '' },
  pending: { label: '认证中', tone: 'pending', actionLabel: '' },
  // 2026-09-26～09-29 两步实名时没录人脸视频的记录：普通实名已不再刷脸，重新提交一次姓名和身份证号即完成（后端不重复收费）
  pending_liveness: { label: '未完成认证', tone: 'pending', actionLabel: '继续认证' },
  rejected: { label: '认证失败', tone: 'failed', actionLabel: '重新提交' },
  expired: { label: '认证已过期', tone: 'failed', actionLabel: '重新提交' },
  not_started: { label: '未认证', tone: 'muted', actionLabel: '去认证' }
}

// 账号身份（学生 / 家长）可以互换（2026-09-24 用户规则）。2026-09-25 起：
// - 学生改家长要先完成实名认证，且实名信息满 22 周岁（后端保存档案时同样把关）；学校、年级、教材保留不清空。
// - 家长改学生：保留过学生资料的直接沿用，确认后保存；没有的（注册就选家长）去建档向导补学校、年级、教材。
const accountRoleViews = {
  student: { label: '学生', detail: '按你的年级和教材安排学习内容', actionLabel: '切换为家长' },
  guardian: { label: '家长', detail: '绑定学生后可查看孩子的学习情况', actionLabel: '切换为学生' }
}

function buildAccountRole(user) {
  const profile = user && user.profile
  if (!user || !user.profileCompleted || !profile) return { type: '', label: '未选择', detail: '完善学习档案时选择学生或家长身份', actionLabel: '去完善' }
  // 早期建档的账号没有记身份，按学生处理（与个人资料页一致）
  const type = profile.account_type === 'guardian' ? 'guardian' : 'student'
  return { type, ...accountRoleViews[type] }
}

// 弹层收起动画时长，与 index.wxss 中 .real-name-verify-layer.is-closing 的 .28s 一致。
const SHEET_CLOSE_MS = 280
const ID_CARD_PATTERN = /^\d{17}[\dX]$/

function formatDate(value) {
  if (!value) return '暂未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂未记录'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function contact(key, label, contacts) {
  if (!contacts) return { key, label, value: '暂未读取', tone: 'muted' }
  const value = contacts[key]
  return value ? { key, label, value, tone: 'success' } : { key, label, value: '未绑定', tone: 'muted' }
}

function verificationDetail(status, verification) {
  if (status === 'verified') return verification && verification.verified_at ? `核验时间 ${formatDate(verification.verified_at)}` : '已通过实名核验'
  if (status === 'pending') return '资料审核中'
  if (status === 'pending_liveness') return '请重新提交一次姓名和身份证号完成认证'
  if (status === 'rejected' || status === 'expired') return '请重新提交认证资料'
  return '家长绑定和涉及现金结算的功能会在实名认证完成后开放。'
}

function buildPageData(principal) {
  if (!principal) return null
  const verification = principal.guardian_verification || null
  const rawStatus = verification && verification.verification_status || 'not_started'
  const status = verificationStates[rawStatus] ? rawStatus : 'not_started'
  return {
    principalNo: principal.principal_no || '业务账号待初始化',
    hasPrincipalNo: Boolean(principal.principal_no),
    contacts: [contact('phone', '手机号', principal.contacts)],
    identities: (principal.account_identities || []).map((item) => ({
      ...item,
      channelLabel: channelLabels[item.login_channel] || '已绑定登录方式',
      verificationLabel: item.verified_at ? `已验证 ${formatDate(item.verified_at)}` : '未记录验证时间',
      loginLabel: item.last_login_at ? `最近登录 ${formatDate(item.last_login_at)}` : '暂未记录登录时间',
      statusLabel: item.disabled_at ? '已停用' : (item.is_default ? '当前默认' : '可用'),
      statusTone: item.disabled_at ? 'muted' : 'success'
    })),
    roles: (principal.role_assignments || []).map((item) => ({
      ...item,
      label: roleLabel(item.role_code)
    })),
    verification: { status, ...verificationStates[status], detail: verificationDetail(status, verification) }
  }
}

Page({
  data: {
    loading: true,
    failed: false,
    refreshing: false,
    account: null,
    // 账号身份随学习档案读取：读失败只让这张卡显示重试，不影响其余账号信息；读到过就保留
    accountRole: null,
    switchingRole: false,
    avatarSrc: '',
    avatarText: '知',
    realNameSheetVisible: false,
    realNameSheetClosing: false,
    realNameSubmitting: false,
    realNameError: '',
    realNameKeyboardHeight: 0,
    realNameDocumentTypeLabels: ['身份证'],
    realNameDocumentTypeIndex: 0,
    realNameFormName: '',
    realNameFormDocument: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 76
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    // 从「绑定学生」等页面带 verify=1 进来：读到状态后直接弹出实名认证，认证通过后回原页面
    this.returnAfterVerify = String(options.verify || '') === '1'
    this.openVerifyOnLoad = this.returnAfterVerify
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32, width: 87, left: windowWidth - 92 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() {
    return this.loadPage()
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.loadPage({ silent: true })
    this.setData({ refreshing: false })
  },

  async loadPage(options = {}) {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (!options.silent) this.setData({ loading: !this.data.account, failed: false })
    try {
      // 学习档案读取失败时头像退回文字头像、账号身份卡显示重试，不影响账号信息。
      const [principal, user] = await Promise.all([
        loadCurrentLoginIdentities(),
        loadCurrentUser().catch(() => null)
      ])
      if (requestId !== this._loadRequestId) return
      const profile = user && user.profile || {}
      const account = buildPageData(principal)
      this.setData({
        account,
        ...(user ? {
          avatarSrc: profile.avatar_url || '',
          avatarText: String(profile.nickname || '知').slice(0, 1),
          accountRole: buildAccountRole(user)
        } : {}),
        failed: false
      })
      if (this.openVerifyOnLoad && account) {
        this.openVerifyOnLoad = false
        if (account.verification.actionLabel) this.openRealNameVerification()
      }
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (!this.data.account) this.setData({ failed: true })
      wx.showToast({ title: error.message || '账号信息加载失败', icon: 'none' })
    } finally {
      if (requestId === this._loadRequestId) this.setData({ loading: false })
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  copyAccountId() {
    const account = this.data.account
    if (!account || !account.hasPrincipalNo) {
      wx.showToast({ title: '暂无可复制的 ID', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: account.principalNo,
      success: () => wx.showToast({ title: 'ID 已复制', icon: 'none' })
    })
  },

  onUnload() {
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    if (this._returnTimer) clearTimeout(this._returnTimer)
  },

  switchAccountRole() {
    const role = this.data.accountRole
    if (!role || this.data.switchingRole) return
    if (!role.type) return wx.navigateTo({ url: '/pages/profile-setup/index' })
    if (role.type === 'guardian') return this.confirmSwitchToStudent()
    // 学生改家长：先实名认证（满 22 周岁才算家长），认证通过后接着切换
    const verification = this.data.account && this.data.account.verification
    if (!verification || verification.status !== 'verified') {
      if (verification && verification.status === 'pending') return wx.showToast({ title: '实名认证审核中，通过后再切换为家长', icon: 'none' })
      wx.showModal({
        title: '先完成实名认证',
        content: '切换为家长需要先完成实名认证，且年满 22 周岁。认证通过后会接着为你切换。',
        confirmText: '去认证',
        cancelText: '再想想',
        success: (result) => {
          if (!result.confirm) return
          this.openRealNameVerification()
          this.switchAfterVerify = true
        }
      })
      return
    }
    this.confirmSwitchToGuardian()
  },

  confirmSwitchToGuardian() {
    wx.showModal({
      title: '切换为家长',
      content: '切换后可以绑定孩子、查看孩子的学习情况，底部导航不再显示「图谱」。你的学校、年级和教材会保留，改回学生时直接沿用。',
      confirmText: '确认切换',
      cancelText: '再想想',
      success: (result) => { if (result.confirm) this.switchToGuardian() }
    })
  },

  // 家长改学生：以前当过学生、资料还在的直接沿用；注册就选家长的去向导补学校、年级、教材
  async confirmSwitchToStudent() {
    let user = null
    try { user = await loadCurrentUser() } catch (error) {}
    const profile = user && user.profile
    if (!profile || !studentInfoComplete(profile) || !basicInfoComplete(profile)) {
      return wx.navigateTo({ url: '/pages/profile-setup/index?switch=student' })
    }
    wx.showModal({
      title: '切换为学生',
      content: `将沿用之前的学习资料：${studentInfoSummary(profile)}。之后可以在「学习档案」里修改。`,
      confirmText: '确认切换',
      cancelText: '再想想',
      success: (result) => { if (result.confirm) this.saveRole('student', profile) }
    })
  },

  async switchToGuardian() {
    if (this.data.switchingRole) return
    let user = null
    try { user = await loadCurrentUser() } catch (error) {
      return wx.showToast({ title: error.message || '学习档案读取失败，请重试', icon: 'none' })
    }
    const profile = user && user.profile
    if (!user || !user.profileCompleted || !profile || !profile.id) return wx.showToast({ title: '请先完善学习档案。', icon: 'none' })
    // 基本信息不全（早期建档没填性别、生日）：去向导补齐后再切换
    if (!basicInfoComplete(profile)) return wx.navigateTo({ url: '/pages/profile-setup/index?switch=guardian' })
    await this.saveRole('guardian', profile)
  },

  // 只改身份：学校、年级、教材按已存的原样提交，不清空（2026-09-25 用户规则）
  async saveRole(accountType, profile) {
    if (this.data.switchingRole) return
    this.setData({ switchingRole: true })
    wx.showLoading({ title: '正在切换', mask: true })
    try {
      await saveCurrentLearningProfile({
        profileId: profile.id, accountType, nickname: profile.nickname, gender: profile.gender, birthday: profile.birthday,
        grade: Number(profile.current_grade) || 0, schoolStage: profile.school_stage || '', semester: profile.semester || '',
        schoolName: profile.school_name || '', textbookVersion: profile.textbook_version || '', regionDetail: profile.region_detail
      })
      wx.hideLoading()
      wx.showToast({ title: accountType === 'guardian' ? '已切换为家长' : '已切换为学生', icon: 'none' })
      await this.loadPage({ silent: true })
    } catch (error) {
      wx.hideLoading()
      this.handleSwitchError(error)
    } finally {
      this.setData({ switchingRole: false })
    }
  },

  handleSwitchError(error) {
    const code = error && error.code
    if (code === 'GUARDIAN_UNDERAGE') {
      wx.showModal({ title: '暂不能切换为家长', content: '实名认证显示你未满 22 周岁，年满 22 周岁才能切换为家长。', showCancel: false, confirmText: '知道了' })
      return
    }
    if (code === 'GUARDIAN_VERIFICATION_REQUIRED' || code === 'GUARDIAN_AGE_UNKNOWN') {
      wx.showModal({
        title: '先完成实名认证',
        content: error.message,
        confirmText: '去认证',
        cancelText: '再想想',
        success: (result) => {
          if (!result.confirm) return
          this.openRealNameVerification()
          this.switchAfterVerify = true
        }
      })
      return
    }
    wx.showToast({ title: error && error.message || '切换失败，请重试', icon: 'none' })
  },

  openRealNameVerification() {
    // 直接点「去认证」的不接着切换；为切换家长打开的由调用方在打开后置位
    this.switchAfterVerify = false
    if (this._sheetTimer) {
      clearTimeout(this._sheetTimer)
      this._sheetTimer = null
    }
    this.setData({
      realNameSheetVisible: true,
      realNameSheetClosing: false,
      realNameError: '',
      realNameKeyboardHeight: 0,
      realNameDocumentTypeIndex: 0,
      realNameFormName: '',
      realNameFormDocument: ''
    })
  },

  closeRealNameVerification() {
    const { realNameSheetVisible, realNameSheetClosing, realNameSubmitting } = this.data
    if (!realNameSheetVisible || realNameSheetClosing || realNameSubmitting) return
    this.setData({ realNameSheetClosing: true, realNameKeyboardHeight: 0 })
    this._sheetTimer = setTimeout(() => {
      this._sheetTimer = null
      this.setData({ realNameSheetVisible: false, realNameSheetClosing: false })
    }, SHEET_CLOSE_MS)
  },

  stopRealNameVerificationTap() {},

  handleRealNameDocumentTypeChange(e) {
    this.setData({ realNameDocumentTypeIndex: Number(e.detail.value) || 0 })
  },

  handleRealNameNameInput(e) {
    this.setData({ realNameFormName: e.detail.value, realNameError: '' })
  },

  handleRealNameIdInput(e) {
    this.setData({ realNameFormDocument: String(e.detail.value || '').toUpperCase(), realNameError: '' })
  },

  // 输入框设了 adjust-position=false，由弹层自己抬到键盘上方，避免小屏上身份证号被键盘挡住。
  handleRealNameKeyboard(e) {
    const height = Math.max(0, Number(e.detail && e.detail.height) || 0)
    if (height !== this.data.realNameKeyboardHeight) this.setData({ realNameKeyboardHeight: height })
  },

  async submitRealNameVerification() {
    if (this.data.realNameSubmitting) return
    const name = String(this.data.realNameFormName || '').trim()
    const idCardNumber = String(this.data.realNameFormDocument || '').replace(/\s/g, '').toUpperCase()
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!ID_CARD_PATTERN.test(idCardNumber)) {
      wx.showToast({ title: '请输入正确的身份证号', icon: 'none' })
      return
    }
    this.setData({ realNameSubmitting: true, realNameError: '' })
    try {
      // 姓名与身份证号核对一致即完成实名（2026-09-29 起普通实名不刷脸；10-13 起推广伙伴流程也不刷脸）
      const result = await submitCurrentGuardianIdentityVerification({ name, idCardNumber })
      this.setData({ realNameSubmitting: false })
      this.closeRealNameVerification()
      wx.showToast({ title: result.message || '实名认证成功', icon: 'none', duration: 1800 })
      await this.afterVerified()
    } catch (error) {
      this.setData({ realNameSubmitting: false, realNameError: error.message || '实名认证未通过，请核对信息后重试。' })
    }
  },

  async afterVerified() {
    try {
      await this.loadPage({ silent: true })
      // 为切换家长来认证的：认证通过后接着切换（未满 22 周岁由后端拒绝，弹窗说明）
      if (this.switchAfterVerify && this.data.account && this.data.account.verification.status === 'verified') {
        this.switchAfterVerify = false
        await this.switchToGuardian()
        return
      }
      // 为绑定学生来认证的，认证通过后回到原页面继续绑定
      if (this.returnAfterVerify && this.data.account && this.data.account.verification.status === 'verified' && getCurrentPages().length > 1) {
        this.returnAfterVerify = false
        this._returnTimer = setTimeout(() => { this._returnTimer = null; wx.navigateBack({ delta: 1 }) }, 1200)
      }
    } catch (error) {
      wx.showToast({ title: error && error.message || '账号信息刷新失败', icon: 'none' })
    }
  }
})
