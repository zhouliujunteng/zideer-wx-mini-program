const { loadCurrentGrowthCenter, redeemCurrentStudentCode, giftCurrentPromoterClientDeepAssessment, createCurrentPromoterInvitation, generateCurrentPromoterPosterBackground, loadPublishedPromotionAssets } = require('../../services/identity')

const titles = {
  application: '推广伙伴与结算资格', dashboard: '推广伙伴工作台', clients: '直属用户',
  'client-detail': '直属用户详情', 'share-tools': '推广工具', 'ai-poster': 'AI 推广海报',
  'material-library': '平台宣传素材', 'deep-assessment-gift': '深测赠送',
  coins: '金币中心', 'coin-tasks': '金币任务', 'coin-withdrawal': '金币提现', redemption: '兑换码'
}

function formatTime(value) {
  if (!value) return '待处理'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '待处理'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function redemptionBenefitLabels(benefits) {
  const source = benefits && typeof benefits === 'object' ? benefits : {}
  const labels = []
  const credits = Number(source.course_credit)
  const coins = Number(source.coin)
  if (Number.isFinite(credits) && credits > 0) labels.push(`课程积分 +${credits}`)
  if (Number.isFinite(coins) && coins > 0) labels.push(`金币 +${coins}`)
  if (source.experience_product_access && source.experience_product_access.product_version_id) {
    labels.push('体验商品权益已开通')
  }
  return labels
}

Component({
  properties: { mode: { type: String, value: 'dashboard' } },
  data: {
    loading: true,
    failed: false,
    center: null,
    title: '',
    isPartnerPage: false,
    isCoinPage: false,
    redemptionCode: '',
    redeeming: false,
    redemptionResult: null,
    giftingAttributionId: '',
    gifting: false,
    giftResult: null,
    creatingInvitation: false,
    invitationResult: null,
    posterTheme: '',
    generatingPoster: false,
    posterStatus: '',
    posterResult: null,
    materialLoading: false,
    materialFailed: false,
    materialStatus: '',
    materialAssets: []
  },
  lifetimes: { attached() { this.loadPage() } },
  methods: {
    async loadPage() {
      this.setData({ loading: true, failed: false, title: titles[this.data.mode] || '成长中心' })
      try {
        const growth = await loadCurrentGrowthCenter()
        let materials = null
        if (this.data.mode === 'material-library') {
          this.setData({ materialLoading: true, materialFailed: false })
          materials = await loadPublishedPromotionAssets()
        }
        const center = {
          ...growth,
          invitations: (growth.invitations || []).map((item) => ({ ...item, timeLabel: formatTime(item.created_at) })),
          coinLedger: (growth.coinLedger || []).map((item) => ({ ...item, timeLabel: formatTime(item.occurred_at) })),
          withdrawals: (growth.withdrawals || []).map((item) => ({ ...item, timeLabel: formatTime(item.requested_at) })),
          redemptionRecords: (growth.redemptionRecords || []).map((item) => ({ ...item, timeLabel: formatTime(item.redeemed_at) }))
        }
        const pages = getCurrentPages()
        const currentPage = pages[pages.length - 1] || {}
        const selectedClientId = String(currentPage.options && currentPage.options.id || '')
        const selectedClient = (center.clients || []).find((item) => String(item.id) === selectedClientId) || null
        this.setData({
          center,
          selectedClient,
          materialStatus: materials && materials.status || '',
          materialAssets: materials && materials.assets || [],
          isPartnerPage: ['application', 'dashboard', 'clients', 'client-detail', 'share-tools', 'ai-poster', 'material-library', 'deep-assessment-gift'].includes(this.data.mode),
          isCoinPage: ['coins', 'coin-tasks', 'coin-withdrawal', 'redemption'].includes(this.data.mode)
        })
      } catch (error) {
        this.setData({ failed: true })
        if (this.data.mode === 'material-library') this.setData({ materialFailed: true })
        wx.showToast({ title: error.message || '数据加载失败', icon: 'none' })
      } finally {
        this.setData({ loading: false, materialLoading: false })
      }
    },
    navigate(event) {
      const url = event.currentTarget.dataset.url
      if (url) wx.navigateTo({ url })
    },
    openClient(event) {
      const id = String(event.currentTarget.dataset.id || '')
      if (id) wx.navigateTo({ url: `/agent/client-detail/index?id=${encodeURIComponent(id)}` })
    },
    unavailable() {
      wx.showToast({ title: '该操作依赖服务端写入流程，当前暂未开放。', icon: 'none' })
    },
    async createInvitation() {
      if (this.data.creatingInvitation) return
      this.setData({ creatingInvitation: true, invitationResult: null })
      try {
        const result = await createCurrentPromoterInvitation({ targetPath: '/pages/home/index', sceneType: 'share' })
        this.setData({ invitationResult: result })
        wx.setClipboardData({ data: result.sharePath, success: () => wx.showToast({ title: '邀请路径已复制', icon: 'success' }) })
        await this.loadPage()
      } catch (error) {
        wx.showToast({ title: error.message || '邀请创建失败，请稍后重试。', icon: 'none' })
      } finally {
        this.setData({ creatingInvitation: false })
      }
    },
    updatePosterTheme(event) {
      this.setData({ posterTheme: String(event.detail.value || ''), posterResult: null })
    },
    async generatePoster() {
      if (this.data.generatingPoster) return
      this.setData({ generatingPoster: true, posterStatus: '正在生成背景图...', posterResult: null })
      try {
        const result = await generateCurrentPromoterPosterBackground(this.data.posterTheme, (status) => {
          this.setData({ posterStatus: status === 'IN_PROGRESS' ? '正在生成背景图...' : '正在整理图片...' })
        })
        this.setData({ posterStatus: '', posterResult: result })
        wx.showToast({ title: '背景图已生成', icon: 'success' })
      } catch (error) {
        this.setData({ posterStatus: '' })
        wx.showToast({ title: error.message || '海报生成失败，请稍后重试。', icon: 'none' })
      } finally {
        this.setData({ generatingPoster: false })
      }
    },
    previewMaterialImage(event) {
      const url = String(event.currentTarget.dataset.url || '')
      if (!url) return
      const urls = (this.data.materialAssets || []).map((item) => item.coverImage && item.coverImage.url).filter(Boolean)
      wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
    },
    copyMaterialText(event) {
      const text = String(event.currentTarget.dataset.text || '')
      if (!text) {
        wx.showToast({ title: '该素材暂未提供文案。', icon: 'none' })
        return
      }
      wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '文案已复制', icon: 'success' }) })
    },
    selectGiftClient(event) {
      this.setData({ giftingAttributionId: String(event.currentTarget.dataset.id || ''), giftResult: null })
    },
    async submitDeepAssessmentGift() {
      if (this.data.gifting) return
      const attributionId = Number(this.data.giftingAttributionId)
      if (!Number.isSafeInteger(attributionId) || attributionId <= 0) {
        wx.showToast({ title: '请先选择直属用户。', icon: 'none' })
        return
      }
      const client = (this.data.center.clients || []).find((item) => Number(item.id) === attributionId)
      if (!client) {
        wx.showToast({ title: '直属用户信息已变化，请刷新后重试。', icon: 'none' })
        return
      }
      const confirmed = await new Promise((resolve) => wx.showModal({
        title: '确认赠送深测',
        content: `将向${client.displayName}发放一次深测资格，发放后不可撤回。`,
        confirmText: '确认赠送',
        success: (result) => resolve(Boolean(result.confirm))
      }))
      if (!confirmed) return
      this.setData({ gifting: true, giftResult: null })
      try {
        const result = await giftCurrentPromoterClientDeepAssessment(attributionId)
        this.setData({ giftResult: result.reused ? '本次请求已处理，无重复发放。' : '深测资格已发放。' })
        wx.showToast({ title: '赠送成功', icon: 'success' })
        await this.loadPage()
      } catch (error) {
        wx.showToast({ title: error.message || '赠送失败，请稍后重试。', icon: 'none' })
      } finally {
        this.setData({ gifting: false })
      }
    },
    updateRedemptionCode(event) {
      const redemptionCode = String(event.detail.value || '').toUpperCase().replace(/\s+/g, '')
      this.setData({ redemptionCode, redemptionResult: null })
    },
    scanRedemptionCode() {
      wx.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode', 'barCode'],
        success: (result) => {
          const redemptionCode = String(result.result || '').toUpperCase().replace(/\s+/g, '')
          if (!redemptionCode) {
            wx.showToast({ title: '未识别到兑换码，请手动输入。', icon: 'none' })
            return
          }
          this.setData({ redemptionCode, redemptionResult: null })
        },
        fail: (error) => {
          if (error && /cancel/i.test(String(error.errMsg || ''))) return
          wx.showToast({ title: '扫码未完成，请检查相机权限后重试。', icon: 'none' })
        }
      })
    },
    async submitRedemption() {
      if (this.data.redeeming) return
      const code = String(this.data.redemptionCode || '').trim()
      const studentId = Number(this.data.center && this.data.center.student && this.data.center.student.id)
      if (!code) {
        wx.showToast({ title: '请输入兑换码。', icon: 'none' })
        return
      }
      if (!Number.isSafeInteger(studentId) || studentId <= 0) {
        wx.showToast({ title: '当前学生信息未就绪，请刷新后重试。', icon: 'none' })
        return
      }

      this.setData({ redeeming: true, redemptionResult: null })
      try {
        const result = await redeemCurrentStudentCode(code, studentId)
        this.setData({
          redemptionCode: '',
          redemptionResult: {
            recordNo: result.record_no || result.recordNo || '',
            message: result.message || '兑换完成，权益与账本已由服务端更新。',
            benefits: redemptionBenefitLabels(result.benefits)
          }
        })
        wx.showToast({ title: '兑换完成', icon: 'success' })
        await this.loadPage()
      } catch (error) {
        wx.showToast({ title: error.message || '兑换失败，请稍后重试。', icon: 'none' })
      } finally {
        this.setData({ redeeming: false })
      }
    }
  }
})
