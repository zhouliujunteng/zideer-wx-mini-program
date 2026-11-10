const { submitCurrentGuardianIdentityVerification, loadCurrentServiceContacts, loadAgentApplication, submitAgentApplication } = require('../../services/identity')
const { AGENT_ROLE_INFO } = require('../../utils/agent-roles')
const { loadPartnerApplication, submitPartnerApplication } = require('../../services/settlement-service')
const view = require('../../services/partner-apply-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')

// 申请成为推广伙伴（2026-09-29 用户规则；10-13 起整个推广伙伴流程不刷脸）：结算中心「提现需开通推广伙伴」、奖励结算「申请成为推广伙伴」进入。
// 1. 基础核验：填身份证姓名、身份证号，走「提交当前家长实名认证」——没实名的就此完成实名；已实名的直接算完成。
// 2. 提交申请：填联系手机号（和可选的申请说明），后台「佣金管理 → 开通申请」审核，通过即开通推广伙伴。
// 首次读到状态前只画骨架；读失败显示错误与重试（不显示表单）。
// 2026-11-10 用户规则：第 2 步同时勾选要申请的代理身份（爱心妈妈 / 导师妈妈 / 爱心妈妈团团长，可多选），
// 身份申请交课程服务（/api/learn/agent-application），推广伙伴（提现账户）申请照旧交 AF49；后台联系签合同后一起审核。
// 已是推广伙伴的只交身份申请；还没开通推广伙伴的可以不勾身份、只开提现账户。

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
    serviceOpening: false,
    // 代理身份（课程服务）：可选的身份卡片、已开通的身份、待审核 / 被驳回的身份申请
    roleOptions: [],
    heldRoleText: '',
    rolePending: null,
    roleRejectNotice: null,
    pickedCount: 0,
    promoterActive: false
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
      const [data, roles, service] = await Promise.all([
        loadPartnerApplication(),
        loadAgentApplication(),
        loadCurrentServiceContacts().catch(() => ({ contacts: [] }))
      ])
      if (requestId !== this._loadRequestId) return
      this.overview = data
      this.roleOverview = roles || {}
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
    const roles = this.roleOverview || {}
    const held = (roles.roles || []).map((item) => item.key)
    const picked = new Set((this.data.roleOptions || []).filter((item) => item.picked).map((item) => item.key))
    const roleOptions = AGENT_ROLE_INFO.filter((item) => !held.includes(item.key)).map((item) => ({ ...item, picked: picked.has(item.key) }))
    const application = roles.application || null
    const rolePending = application && application.status === 'submitted'
      ? { roleText: application.roles.map((item) => item.label).join('、'), time: view.formatTime(application.submittedAt), proposed: application.proposed }
      : null
    const roleRejectNotice = application && application.status === 'rejected'
      ? { title: '代理身份申请未通过', copy: application.reviewNote || '请联系客服了解原因。', time: view.formatTime(application.reviewedAt) }
      : null
    const zionState = view.applyState(data)
    // 身份申请在审核中优先显示；已是推广伙伴、身份都开通了才显示「已开通」；已是推广伙伴但还有身份可申请就显示表单
    let state = zionState
    if (rolePending) state = 'role-pending'
    else if (zionState === 'active') state = roleOptions.length ? 'form' : 'active'
    const step = view.currentStep(data)
    extra = { ...extra, roleOptions, heldRoleText: (roles.roles || []).map((item) => item.label).join('、'), rolePending, roleRejectNotice, pickedCount: picked.size, promoterActive: zionState === 'active' }
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
    // 已是推广伙伴的必须勾至少一个身份；还没开通的可以只申请推广伙伴（提现账户）
    const rolesOk = this.data.promoterActive ? this.data.pickedCount > 0 : true
    const canSubmit = this.data.step === 2 && !this.data.submitting && rolesOk && view.PHONE_PATTERN.test(view.normalizePhone(this.data.phone))
    if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit })
  },

  handleNameInput(event) { this.setData({ name: event.detail.value, basicError: '' }) },
  handleIdInput(event) { this.setData({ idCard: view.normalizeIdCard(event.detail.value), basicError: '' }) },
  handlePhoneInput(event) { this.setData({ phone: event.detail.value }, () => this.updateSubmitState()) },
  toggleRole(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const roleOptions = this.data.roleOptions.map((item) => item.key === key ? { ...item, picked: !item.picked } : item)
    this.setData({ roleOptions, pickedCount: roleOptions.filter((item) => item.picked).length }, () => this.updateSubmitState())
  },
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
    const roles = this.data.roleOptions.filter((item) => item.picked).map((item) => item.key)
    if (this.data.promoterActive && !roles.length) return wx.showToast({ title: '请至少选择一个身份', icon: 'none' })
    this.setData({ submitting: true }, () => this.updateSubmitState())
    let rolesSent = false
    try {
      if (roles.length) {
        await submitAgentApplication({ roles, contactPhone: phone, note: this.data.note })
        rolesSent = true
      }
      // 还没开通推广伙伴（提现账户）的一起申请；已开通、或已在审核中的跳过
      if (this.data.state === 'form' && !this.data.promoterActive) await submitPartnerApplication({ contactPhone: phone, note: this.data.note })
      wx.showToast({ title: '申请已提交', icon: 'success' })
      this.setData({ phone: '', note: '', roleOptions: [], pickedCount: 0 })
    } catch (error) {
      const message = error && error.message || '申请提交失败，请稍后重试'
      wx.showToast({ title: rolesSent ? '身份申请已提交，提现账户申请没成功，请稍后在本页重试' : message, icon: 'none', duration: 3000 })
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
