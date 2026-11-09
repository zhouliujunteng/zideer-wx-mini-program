const { submitCurrentGuardianIdentityVerification, loadCurrentServiceContacts } = require('../../services/identity')
const { loadPartnerApplication, submitPartnerApplication } = require('../../services/settlement-service')
const view = require('../../services/partner-apply-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')

// 申请成为推广伙伴（2026-09-29 用户规则；10-13 起整个推广伙伴流程不刷脸）：结算中心「提现需开通推广伙伴」、奖励结算「申请成为推广伙伴」进入。
// 1. 基础核验：填身份证姓名、身份证号，走「提交当前家长实名认证」——没实名的就此完成实名；已实名的直接算完成。
// 2. 提交申请：填联系手机号（和可选的申请说明），后台「佣金管理 → 开通申请」审核，通过即开通推广伙伴。
// 首次读到状态前只画骨架；读失败显示错误与重试（不显示表单）。

const NOTE_MAX = 200

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    state: '',
    step: 1,
    steps: view.buildSteps(1),
    basicHint: view.basicHint(),
    basicDoneHint: '',
    rejectNotice: null,
    applicationRows: [],
    name: '',
    idCard: '',
    basicError: '',
    checking: false,
    phone: '',
    note: '',
    noteMax: NOTE_MAX,
    submitting: false,
    canSubmit: false,
    serviceContact: null,
    serviceOpening: false
  },

  onLoad() {
    attachUiAssets(this)
    let windowInfo = {}
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch (error) {}
    const statusBarHeight = windowInfo.statusBarHeight == null ? 20 : windowInfo.statusBarHeight
    let menu = { top: statusBarHeight + 6, height: 32 }
    try { const actual = wx.getMenuButtonBoundingClientRect(); if (actual && actual.height > 0) menu = actual } catch (error) {}
    const navigationBarHeight = menu.height + Math.max(0, menu.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() {
    return this.loadPage()
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      // 企微客服入口读失败只降级（改去真人服务页），不影响申请状态
      const [data, service] = await Promise.all([
        loadPartnerApplication(),
        loadCurrentServiceContacts().catch(() => ({ contacts: [] }))
      ])
      if (requestId !== this._loadRequestId) return
      this.overview = data
      this.applyOverview({ serviceContact: (service && service.contacts || [])[0] || null })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '申请状态刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  applyOverview(extra = {}) {
    const data = this.overview || {}
    const state = view.applyState(data)
    const step = view.currentStep(data)
    this.setData({
      ...extra,
      loadState: 'ready',
      state,
      step,
      steps: view.buildSteps(step),
      basicDoneHint: view.basicDoneHint(data.verification),
      rejectNotice: view.rejectNotice(data.application),
      applicationRows: view.applicationRows(data.application)
    }, () => this.updateSubmitState())
  },

  updateSubmitState() {
    const canSubmit = this.data.step === 2 && !this.data.submitting && view.PHONE_PATTERN.test(view.normalizePhone(this.data.phone))
    if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit })
  },

  handleNameInput(event) { this.setData({ name: event.detail.value, basicError: '' }) },
  handleIdInput(event) { this.setData({ idCard: view.normalizeIdCard(event.detail.value), basicError: '' }) },
  handlePhoneInput(event) { this.setData({ phone: event.detail.value }, () => this.updateSubmitState()) },
  handleNoteInput(event) { this.setData({ note: String(event.detail.value || '').slice(0, NOTE_MAX) }) },

  // 第 1 步：基础核验（实名认证流程）
  async handleBasicCheck() {
    if (this.data.checking || this.data.step !== 1) return
    const name = String(this.data.name || '').trim()
    const idCardNumber = view.normalizeIdCard(this.data.idCard)
    if (!name) return this.setData({ basicError: '请输入身份证上的姓名' })
    if (!view.ID_CARD_PATTERN.test(idCardNumber)) return this.setData({ basicError: '请输入正确的 18 位身份证号' })
    this.setData({ checking: true, basicError: '' })
    try {
      await submitCurrentGuardianIdentityVerification({ name, idCardNumber })
      this.setData({ checking: false, name: '', idCard: '' })
      wx.showToast({ title: '基础核验通过', icon: 'success' })
      await this.loadPage()
    } catch (error) {
      this.setData({ checking: false, basicError: error && error.message || '核验没有通过，请核对姓名和身份证号' })
    }
  },

  // 第 2 步：提交申请
  async handleSubmit() {
    if (this.data.submitting) return
    const phone = view.normalizePhone(this.data.phone)
    if (this.data.step !== 2) return
    if (!view.PHONE_PATTERN.test(phone)) {
      wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' })
      return
    }
    this.setData({ submitting: true }, () => this.updateSubmitState())
    try {
      await submitPartnerApplication({ contactPhone: phone, note: this.data.note })
      wx.showToast({ title: '申请已提交', icon: 'success' })
      this.setData({ phone: '', note: '' })
    } catch (error) {
      wx.showToast({ title: error && error.message || '申请提交失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
      await this.loadPage()
    }
  },

  handleGoSettlement() {
    const pages = getCurrentPages()
    const previous = pages.length > 1 ? pages[pages.length - 2] : null
    if (previous && previous.route === 'agent/settlement/index') return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/agent/settlement/index' })
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/agent/settlement/index' })
  },

  // 企微客服：拿到有效入口就直接拉起会话，没有就去真人服务页（那里会说明原因）。
  async handleService() {
    if (this.data.serviceOpening) return
    const contact = this.data.serviceContact
    if (!contact) {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    this.setData({ serviceOpening: true })
    try {
      await openCustomerServiceChat(contact)
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ serviceOpening: false })
    }
  }
})
