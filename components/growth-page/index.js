const { loadCurrentGrowthCenter, redeemCurrentStudentCode, unlockDevelopmentReset, generateCurrentPromoterPosterBackground, loadPublishedPromotionAssets, claimCurrentDailyCoinCheckin } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')

const titles = {
  application: '推广伙伴与结算资格', dashboard: '推广伙伴工作台', clients: '直属用户',
  'client-detail': '直属用户详情', 'ai-poster': '智能推广海报',
  'material-library': '平台宣传素材',
  coins: '金币中心', 'coin-tasks': '金币任务', 'coin-withdrawal': '兑换记录', redemption: '兑换码'
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
  // 学习连胜道具卡（激活码可领，2026-09-25）
  const freezeCards = Number(source.streak_freeze_card)
  const reviveCards = Number(source.streak_revive_card)
  if (Number.isFinite(freezeCards) && freezeCards > 0) labels.push(`冻结卡 +${freezeCards}`)
  if (Number.isFinite(reviveCards) && reviveCards > 0) labels.push(`复活卡 +${reviveCards}`)
  // 成就卡通用抽卡次数（2026-10-13，课程服务按兑换记录发放，任意卡可用）
  const cardDraws = Number(source.achievement_card_draw)
  if (Number.isFinite(cardDraws) && cardDraws > 0) labels.push(`成就卡抽卡次数 +${cardDraws}`)
  if (source.experience_product_access && source.experience_product_access.product_version_id) {
    labels.push('体验商品权益已开通')
  }
  return labels
}

const PARTNER_MODES = ['application', 'dashboard', 'clients', 'client-detail', 'ai-poster', 'material-library']
const COIN_MODES = ['coins', 'coin-tasks', 'coin-withdrawal', 'redemption']

Component({
  // 卡片、状态面板等公共样式由所在页面引入的 styles/account-form.wxss 提供，这里让页面样式作用进组件。
  options: { styleIsolation: 'apply-shared' },
  properties: { mode: { type: String, value: 'dashboard' } },
  data: {
    // loaded：成长中心第一次读成功后为 true，之后刷新保留旧数据、后台静默更新；
    // failed：只表示首次读取失败（显示重试），已读到过数据时刷新失败只提示。
    loaded: false,
    failed: false,
    center: null,
    title: '',
    isPartnerPage: false,
    isCoinPage: false,
    redemptionCode: '',
    redeeming: false,
    redemptionResult: null,
    posterTheme: '',
    generatingPoster: false,
    posterStatus: '',
    posterResult: null,
    materialStatus: '',
    materialAssets: [],
    checkingIn: false,
    checkinResult: null
  },
  lifetimes: {
    attached() {
      attachUiAssets(this)
      // 标题与页面类型只由 mode 决定，首屏就显示，不等数据
      const mode = this.data.mode
      this.setData({
        title: titles[mode] || '成长中心',
        isPartnerPage: PARTNER_MODES.includes(mode),
        isCoinPage: COIN_MODES.includes(mode)
      })
      this.loadPage()
    }
  },
  methods: {
    async loadPage() {
      if (!this.data.loaded) this.setData({ failed: false })
      try {
        const growth = await loadCurrentGrowthCenter()
        let materials = null
        if (this.data.mode === 'material-library') materials = await loadPublishedPromotionAssets()
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
          loaded: true,
          failed: false,
          center,
          selectedClient,
          materialStatus: materials && materials.status || '',
          materialAssets: materials && materials.assets || []
        })
      } catch (error) {
        // 已经显示过数据时保留旧内容，只提示刷新失败
        if (!this.data.loaded) this.setData({ failed: true })
        wx.showToast({ title: error.message || '数据加载失败', icon: 'none' })
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
    async claimDailyCheckin() {
      if (this.data.checkingIn) return
      this.setData({ checkingIn: true, checkinResult: null })
      try {
        const result = await claimCurrentDailyCoinCheckin()
        this.setData({ checkinResult: result })
        wx.showToast({ title: result.status === 'checked_in' ? `签到成功 +${result.rewardCoins}` : '今天已签到', icon: 'success' })
        await this.loadPage()
      } catch (error) {
        wx.showToast({ title: error.message || '签到失败，请稍后重试。', icon: 'none' })
      } finally {
        this.setData({ checkingIn: false })
      }
    },
    async submitRedemption() {
      if (this.data.redeeming) return
      const code = String(this.data.redemptionCode || '').trim()
      const studentId = Number(this.data.center && this.data.center.student && this.data.center.student.id)
      if (!code) {
        wx.showToast({ title: '请输入兑换码。', icon: 'none' })
        return
      }

      this.setData({ redeeming: true, redemptionResult: null })
      try {
        // 与兑换码页一致：先问后端是不是「重置测试账号」的开启码（2026-09-28 用户规则），放在学生信息检查之前
        if (await unlockDevelopmentReset(code)) {
          this.setData({ redemptionCode: '', redemptionResult: { title: '已开启重置测试账号', message: '页面右下角会出现「重置测试账号」按钮，这台手机上登录的账号都能用。', benefits: [], recordNo: '' } })
          return
        }
        if (!Number.isSafeInteger(studentId) || studentId <= 0) {
          wx.showToast({ title: '当前学生信息未就绪，请刷新后重试。', icon: 'none' })
          return
        }
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
