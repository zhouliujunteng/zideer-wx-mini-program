const { loadCurrentLoginIdentities, loadMeDashboard, submitCurrentGuardianIdentityVerification } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')

// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 d9627f0 的 M63 身份与登录页（2026-09-19 同步）。
// 实名认证弹层同步自设计仓库，提交走现有身份证核验动作流：后端目前只能核验 18 位居民身份证，
// 所以证件类型只提供「身份证」（设计稿另有永久居留证、港澳 / 台湾通行证，待后端支持后再加）。
// 未移植：邮箱验证码绑定（无后端接口）、「认领原账号 / 账号合并 / 解除旧微信」三个仅演示的管理入口，
// 以及设计稿右上角切换实名状态的演示菜单。

const channelLabels = {
  wechat_miniprogram: '微信小程序',
  wechat_miniapp: '微信小程序',
  wechat: '微信',
  phone: '手机号',
  web: '网页登录'
}

const roleLabels = {
  USER: '学习用户',
  GUARDIAN: '家长',
  PROMOTER: '推广伙伴',
  TEACHER: '教师'
}

// tone 对应设计稿 .real-name-status 的 success / pending / failed / muted；actionLabel 为空时不显示按钮。
const verificationStates = {
  verified: { label: '已完成认证', tone: 'success', actionLabel: '' },
  pending: { label: '认证中', tone: 'pending', actionLabel: '' },
  rejected: { label: '认证失败', tone: 'failed', actionLabel: '重新提交' },
  expired: { label: '认证已过期', tone: 'failed', actionLabel: '重新提交' },
  not_started: { label: '未认证', tone: 'muted', actionLabel: '去认证' }
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
    contacts: [contact('phone', '手机号', principal.contacts), contact('email', '邮箱', principal.contacts)],
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
      label: roleLabels[item.role_code] || item.role_code || '业务角色'
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

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32, width: 87, left: windowWidth - 92 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() { return this.loadPage() },

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
      // 头像只是装饰：「我的」资料读取失败时退回文字头像，不影响账号信息。
      const [principal, me] = await Promise.all([
        loadCurrentLoginIdentities(),
        loadMeDashboard().catch(() => null)
      ])
      if (requestId !== this._loadRequestId) return
      const profile = me && me.profile || {}
      this.setData({
        account: buildPageData(principal),
        avatarSrc: profile.avatarUrl || '',
        avatarText: profile.initial || '知',
        failed: false
      })
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
  },

  openRealNameVerification() {
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
      const result = await submitCurrentGuardianIdentityVerification({ name, idCardNumber })
      this.setData({ realNameSubmitting: false })
      this.closeRealNameVerification()
      wx.showToast({ title: result.message || '实名认证成功', icon: 'none', duration: 1800 })
      await this.loadPage({ silent: true })
    } catch (error) {
      this.setData({ realNameSubmitting: false, realNameError: error.message || '实名认证未通过，请核对信息后重试。' })
    }
  }
})
