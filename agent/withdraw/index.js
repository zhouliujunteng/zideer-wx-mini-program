const { loadCurrentServiceContacts } = require('../../services/identity')
const {
  loadSettlementCenter, submitSettlementWithdrawal, exchangeSettlementCredits, uploadSettlementInvoice, createSettlementKey
} = require('../../services/settlement-service')
const view = require('../../services/settlement-apply-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')
const { guideOnFailure } = require('../../utils/permission-guide')

// 奖励结算（结算中心「整笔转现金」进入，2026-09-26 用户要求，界面照结算中心）：
// - 提现到银行卡：已开通推广伙伴、后台录好结算资料（签约主体、收款银行卡）并上传劳务协议后可用。
//   页面展示收款信息（卡号只露后四位）、个税预估、发票上传（图片或 PDF）、《劳务费代扣代发协议》阅读与同意，
//   提交后整笔奖励转为提现中，后台核定佣金、扣税、打款并上传支付凭证，进度在「我的结算记录」看。
// - 兑换课程积分：没开通推广伙伴也能用，按后台「推广奖励兑换积分」活动的比例整笔兑换，积分记进自己的学习档案。
// 金额、税额、比例都由服务端（AF49 推广结算中心）算，这里不接受也不提交任何金额。

const TABS = [
  { id: 'cash', label: '提现到银行卡' },
  { id: 'credits', label: '兑换课程积分' }
]
const MAX_INVOICES = 9
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp']
// 选发票失败时的权限引导：拍照要小程序的摄像头权限；从相册选图不需要小程序授权，报权限错误只会是手机系统没允许微信；
// 从聊天记录选文件没有对应权限，只区分取消和隐私指引
const INVOICE_SOURCE_GUIDES = {
  album: { name: '相册' },
  camera: { scope: 'scope.camera', title: '需要摄像头权限', content: '拍发票要用摄像头，请在设置里打开「摄像头」后再拍。' },
  file: {}
}

function extensionOf(value) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(value || '').split('?')[0])
  return match ? match[1].toLowerCase() : ''
}

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    isScrolled: false,
    topbarProgress: 0,
    topbarWhiteOpacity: 1,
    title: '奖励结算',
    hero: {},
    tabs: TABS.map((tab) => ({ ...tab, isSelected: false })),
    activeTab: '',
    cash: {},
    credits: {},
    invoices: [],
    uploading: false,
    agreed: false,
    submitting: false,
    exchanging: false,
    canSubmit: false,
    submitHint: '',
    serviceContact: null,
    serviceMeta: '',
    serviceOpening: false,
    openingAgreement: false
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this._preferredTab = TABS.some((tab) => tab.id === options.tab) ? options.tab : ''
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      // 只取标题文案；金额位在读到数据前由骨架占住
      hero: view.buildHero(null)
    })
  },

  onShow() {
    return this.loadPage()
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      // 企微客服入口读失败只降级（改去真人服务页），不影响结算数据。
      const [overview, service] = await Promise.all([
        loadSettlementCenter(),
        loadCurrentServiceContacts().catch(() => ({ status: 'failed', contacts: [] }))
      ])
      if (requestId !== this._loadRequestId) return
      const contact = (service && service.contacts || [])[0] || null
      const activeTab = this.data.activeTab || this._preferredTab || view.defaultTab(overview)
      this.setData({
        loadState: 'ready',
        hero: view.buildHero(overview),
        cash: view.buildCashView(overview),
        credits: view.buildCreditsView(overview),
        activeTab,
        tabs: TABS.map((tab) => ({ ...tab, isSelected: tab.id === activeTab })),
        serviceContact: contact,
        serviceMeta: contact ? `企业微信 · ${contact.title}` : '暂无可用入口，可去真人服务页查看'
      }, () => this.updateSubmitState())
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '奖励结算刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 提交按钮能不能点、不能点时差什么（一次只说最先要做的那件事）。
  updateSubmitState() {
    const { cash, invoices, uploading, agreed, submitting } = this.data
    const doneInvoices = invoices.filter((item) => item.status === 'done').length
    let submitHint = ''
    if (!cash.ready) submitHint = ''
    else if (!(cash.amount > 0)) submitHint = '暂无可提现的奖励，锁定期满后再来提现'
    else if (uploading) submitHint = '发票上传中，请稍候'
    else if (cash.invoiceRequired && !doneInvoices) submitHint = '请先上传发票'
    else if (!agreed) submitHint = '请先阅读并勾选同意《劳务费代扣代发协议》'
    const canSubmit = Boolean(cash.ready && cash.amount > 0 && !uploading && agreed && !submitting &&
      (!cash.invoiceRequired || doneInvoices > 0))
    if (canSubmit !== this.data.canSubmit || submitHint !== this.data.submitHint) this.setData({ canSubmit, submitHint })
  },

  handleTab(event) {
    const tabId = String(event.currentTarget.dataset.id || '')
    if (!tabId || tabId === this.data.activeTab) return
    this.setData({ activeTab: tabId, tabs: TABS.map((tab) => ({ ...tab, isSelected: tab.id === tabId })) })
  },

  handleSwitchToCredits() {
    this.setData({ activeTab: 'credits', tabs: TABS.map((tab) => ({ ...tab, isSelected: tab.id === 'credits' })) })
  },

  // 顶栏白字随金额卡滚出视口渐变为深色（与结算中心一致）。
  handleScroll() {
    if (this._topbarQueryPending) return
    this._topbarQueryPending = true
    wx.createSelectorQuery()
      .select('.withdraw-hero')
      .boundingClientRect((rect) => {
        this._topbarQueryPending = false
        if (!rect || !rect.height) return
        const topbarBottom = this.data.statusBarHeight + this.data.navigationBarHeight
        const progress = Math.min(1, Math.max(0, (topbarBottom - rect.top) / rect.height))
        const topbarProgress = Number(progress.toFixed(2))
        const topbarWhiteOpacity = Number((1 - progress).toFixed(2))
        const isScrolled = progress >= 1
        if (topbarProgress !== this.data.topbarProgress || isScrolled !== this.data.isScrolled) {
          this.setData({ isScrolled, topbarProgress, topbarWhiteOpacity })
        }
      })
      .exec()
  },

  // ---- 发票 ----
  handleAddInvoice() {
    if (this.data.uploading) return
    const remaining = MAX_INVOICES - this.data.invoices.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_INVOICES} 个发票文件`, icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ['从聊天记录选择（PDF 或图片）', '从相册选择图片', '拍照'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          wx.chooseMessageFile({
            count: remaining,
            type: 'all',
            extension: ['pdf', 'jpg', 'jpeg', 'png'],
            success: (res) => this.uploadInvoices((res.tempFiles || []).map((file) => ({ path: file.path, name: file.name, size: file.size }))),
            fail: (error) => this.handlePickFailure(error, 'file')
          })
          return
        }
        const source = tapIndex === 1 ? 'album' : 'camera'
        wx.chooseMedia({
          count: remaining,
          mediaType: ['image'],
          sourceType: [source],
          sizeType: ['original', 'compressed'],
          success: (res) => this.uploadInvoices((res.tempFiles || []).map((file, index) => {
            const ext = extensionOf(file.tempFilePath) || 'jpg'
            return { path: file.tempFilePath, name: `发票照片-${Date.now().toString(36)}-${index + 1}.${ext}`, size: file.size }
          })),
          fail: (error) => this.handlePickFailure(error, source)
        })
      }
    })
  },

  // 选文件 / 选图 / 拍照失败：取消不提示；权限问题按原因引导（去设置、隐私指引、手机系统设置）；其余提示重试。
  async handlePickFailure(error, source) {
    const kind = await guideOnFailure(error, INVOICE_SOURCE_GUIDES[source])
    if (kind !== 'other') return
    const title = { file: '没能打开聊天文件，请重试', album: '没能打开相册，请重试', camera: '没能打开相机，请重试' }[source]
    wx.showToast({ title: title || '没能选择文件，请重试', icon: 'none' })
  },

  // 逐个上传到私有存储；失败的那一个去掉并提示，其余照常。
  async uploadInvoices(files) {
    const picked = (files || []).slice(0, MAX_INVOICES - this.data.invoices.length)
    if (!picked.length) return
    const items = picked.map((file, index) => {
      const format = extensionOf(file.name) || extensionOf(file.path)
      return {
        key: `inv-${Date.now().toString(36)}-${index}`,
        name: String(file.name || `发票.${format}`),
        format,
        isImage: IMAGE_FORMATS.includes(format),
        path: file.path,
        status: 'uploading',
        fileId: ''
      }
    })
    this.setData({ invoices: this.data.invoices.concat(items), uploading: true }, () => this.updateSubmitState())
    for (const item of items) {
      try {
        const uploaded = await uploadSettlementInvoice({ path: item.path, name: item.name })
        this.patchInvoice(item.key, { status: 'done', fileId: uploaded.fileId, format: uploaded.format, name: uploaded.name })
      } catch (error) {
        this.setData({ invoices: this.data.invoices.filter((entry) => entry.key !== item.key) })
        wx.showToast({ title: error.message || '发票上传失败，请重试', icon: 'none' })
      }
    }
    this.setData({ uploading: false }, () => this.updateSubmitState())
  },

  patchInvoice(key, patch) {
    this.setData({ invoices: this.data.invoices.map((item) => (item.key === key ? { ...item, ...patch } : item)) })
  },

  handleRemoveInvoice(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const item = this.data.invoices.find((entry) => entry.key === key)
    if (!item || item.status === 'uploading') return
    this.setData({ invoices: this.data.invoices.filter((entry) => entry.key !== key) }, () => this.updateSubmitState())
  },

  handlePreviewInvoice(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const item = this.data.invoices.find((entry) => entry.key === key)
    if (!item) return
    if (item.isImage) {
      wx.previewImage({ urls: this.data.invoices.filter((entry) => entry.isImage).map((entry) => entry.path), current: item.path })
      return
    }
    wx.openDocument({ filePath: item.path, fileType: 'pdf', showMenu: true, fail: () => wx.showToast({ title: '文件暂时打不开', icon: 'none' }) })
  },

  // ---- 劳务协议 ----
  handleToggleAgree() {
    this.setData({ agreed: !this.data.agreed }, () => this.updateSubmitState())
  },

  // 协议文件是后台上传的签名地址（约两天有效）：PDF 下载后用系统文档打开，图片直接预览。
  handleOpenAgreement() {
    const agreement = this.data.cash && this.data.cash.agreement
    if (!agreement || !agreement.url || this.data.openingAgreement) return
    if (IMAGE_FORMATS.includes(agreement.fileType)) {
      wx.previewImage({ urls: [agreement.url] })
      return
    }
    this.setData({ openingAgreement: true })
    wx.downloadFile({
      url: agreement.url,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          wx.showToast({ title: '协议暂时打不开，请刷新后重试', icon: 'none' })
          return
        }
        wx.openDocument({ filePath: res.tempFilePath, fileType: 'pdf', showMenu: true, fail: () => wx.showToast({ title: '协议暂时打不开', icon: 'none' }) })
      },
      fail: () => wx.showToast({ title: '协议下载失败，请检查网络', icon: 'none' }),
      complete: () => this.setData({ openingAgreement: false })
    })
  },

  // ---- 提交提现 ----
  handleSubmit() {
    if (!this.data.canSubmit) {
      if (this.data.submitHint) wx.showToast({ title: this.data.submitHint, icon: 'none' })
      return
    }
    const cash = this.data.cash
    wx.showModal({
      title: '确认提交提现申请',
      content: `整笔奖励 ¥${cash.amountText} 将转为提现中，由平台核算税费后打款到尾号 ${cash.bankTail} 的银行卡。提交后不能再改为兑换积分。`,
      confirmText: '确认提交',
      success: ({ confirm }) => { if (confirm) this.submitWithdrawal() }
    })
  },

  async submitWithdrawal() {
    if (this.data.submitting) return
    // 同一次提交沿用同一个幂等键：网络超时后重试不会生成第二笔申请
    this._cashKey = this._cashKey || createSettlementKey('settle-cash')
    this.setData({ submitting: true }, () => this.updateSubmitState())
    try {
      const invoices = this.data.invoices.filter((item) => item.status === 'done')
        .map((item) => ({ fileId: item.fileId, name: item.name, format: item.format }))
      const result = await submitSettlementWithdrawal({ invoices, idempotencyKey: this._cashKey })
      this._cashKey = ''
      this.setData({ invoices: [], agreed: false })
      wx.showToast({ title: '提现申请已提交', icon: 'success' })
      const id = result.settlement && result.settlement.id
      if (id) wx.navigateTo({ url: `/agent/settlement-application/index?id=${encodeURIComponent(String(id))}` })
    } catch (error) {
      wx.showToast({ title: error.message || '提现申请提交失败，请稍后重试', icon: 'none' })
      // 资格或金额变了（比如刚被后台停用、奖励刚被兑换）：重新读一次，页面按最新状态显示
      if (error && error.code && error.code !== 'failed') this._cashKey = ''
      this.loadPage()
    } finally {
      this.setData({ submitting: false }, () => this.updateSubmitState())
    }
  },

  // ---- 兑换积分 ----
  handleExchange() {
    const credits = this.data.credits
    if (!credits.ready || !(credits.credits > 0) || this.data.exchanging) {
      if (credits.ready && !(credits.credits > 0)) wx.showToast({ title: '暂无可兑换的奖励', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认兑换课程积分',
      content: `整笔奖励 ¥${credits.amountText} 兑换为 ${credits.creditsText} 积分，记入你的学习账户。兑换后不可撤回，也不能再提现。`,
      confirmText: '确认兑换',
      success: ({ confirm }) => { if (confirm) this.exchangeCredits() }
    })
  },

  async exchangeCredits() {
    if (this.data.exchanging) return
    this._creditKey = this._creditKey || createSettlementKey('settle-credit')
    this.setData({ exchanging: true })
    try {
      const result = await exchangeSettlementCredits({ idempotencyKey: this._creditKey })
      this._creditKey = ''
      wx.showToast({ title: `已兑换 ${view.creditsText(result.credits || result.settlement && result.settlement.credits_amount)} 积分`, icon: 'success' })
      const id = result.settlement && result.settlement.id
      if (id) wx.navigateTo({ url: `/agent/settlement-application/index?id=${encodeURIComponent(String(id))}` })
    } catch (error) {
      wx.showToast({ title: error.message || '兑换积分失败，请稍后重试', icon: 'none' })
      if (error && error.code && error.code !== 'failed') this._creditKey = ''
      this.loadPage()
    } finally {
      this.setData({ exchanging: false })
    }
  },

  // 资格提示卡上的按钮：没开通推广伙伴的去「申请成为推广伙伴」页（2026-09-29）；其余情况直接找客服。
  handleNoticeAction() {
    const notice = this.data.cash && this.data.cash.notice || {}
    if (notice.action === 'open_partner') return wx.navigateTo({ url: '/agent/partner-apply/index' })
    return this.handleService()
  },

  handleRecords() {
    wx.navigateTo({ url: '/agent/settlement-applications/index' })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/settlement/index' })
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
