const { loadCurrentLearningCheckin, loadMeDashboard, useCurrentStreakCard } = require('../../services/identity')
const { buildCheckInModel, dateRange } = require('../../services/checkin-model')
const { publishCheckin } = require('../../services/learning-streak')
const { attachUiAssets, getUiAssets } = require('../../services/ui-assets')
const { rpxToPx, columnWidth } = require('../../utils/screen')

// 每日学习打卡页：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 b5cc5ab（E05，2026-09-19 同步）。
// 打卡规则由后端决定（2026-09-25 起：当天学完一节课或费曼验收通过算一天），本页不提交打卡。
// 冻结卡、复活卡在本页使用（AF48）；用完重新读一次打卡，日历上当场显示冻结 / 补回的日子。
// 未移植：设计稿的「开发调试」面板与模拟今天日期。

const CELEBRATED_KEY = 'learning_checkin_celebrated_day'
const CALENDAR_TRANSITION_MS = 360
const SHARE_SHEET_CLOSE_MS = 280
const POSTER_LOGO_KEY = 'home/brand-logo.png'
const CARD_SHEET_CLOSE_MS = 260
const CARD_EFFECT_MS = 1600
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    model: {},
    calendarYear: 0,
    calendarMonth: 0,
    calendarTransitionClass: '',
    showSuccessSheet: false,
    showShareSheet: false,
    shareSheetClosing: false,
    cardSheet: null,
    cardSheetClosing: false,
    usingCard: false,
    cardEffect: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    heroStageHeight: 243,
    shareTop: 26,
    shareRight: 100,
    shareSize: 32,
    sharePosterWidth: 300,
    sharePosterHeight: 400,
    shareRenderScale: 3,
    shareCanvasWidth: 900,
    shareCanvasHeight: 1200
  },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    const sharePosterWidth = Math.min(columnWidth(windowWidth) - rpxToPx(40, windowWidth), rpxToPx(660, windowWidth))
    const sharePosterHeight = sharePosterWidth * (4 / 3)
    const contentTop = statusBarHeight + navigationBarHeight + rpxToPx(16, windowWidth)
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop,
      heroStageHeight: contentTop + rpxToPx(326, windowWidth),
      shareTop: menuButton.top,
      shareRight: windowWidth - menuButton.left + 8,
      shareSize: menuButton.height,
      sharePosterWidth,
      sharePosterHeight,
      shareCanvasWidth: Math.round(sharePosterWidth * 3),
      shareCanvasHeight: Math.round(sharePosterHeight * 3)
    })
    if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
  },

  // 每次回到本页都重新读取：从学习页学完一节课回来，今天可能刚点亮。
  onShow() {
    return this.loadCheckIn()
  },

  async loadCheckIn() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const [checkin, me] = await Promise.all([
        // 一读到就同步给顶栏火苗入口与「我的」页连胜卡片（不等昵称）：这里刚点亮，返回时外面也是点亮的。
        loadCurrentLearningCheckin().then((value) => { publishCheckin(value); return value }),
        loadMeDashboard().catch(() => null)
      ])
      if (requestId !== this._loadRequestId) return
      this._checkin = checkin
      this._nickname = me && me.profile && me.profile.displayName || ''
      const today = checkin.today.split('-').map(Number)
      const year = this.data.calendarYear || today[0]
      const month = this.data.calendarMonth || today[1]
      const model = this.buildModel(year, month)
      const celebrate = model.checkedToday && this.readCelebratedDay() !== checkin.today
      this.setData({ loadState: 'ready', model, calendarYear: year, calendarMonth: month, showSuccessSheet: celebrate || this.data.showSuccessSheet })
      if (celebrate) this.writeCelebratedDay(checkin.today)
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '学习打卡刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  buildModel(year, month) {
    const model = buildCheckInModel({
      ...this._checkin,
      viewedYear: year,
      viewedMonth: month,
      nickname: this._nickname
    })
    // 刚用完道具卡：新保护的日子在日历上弹一下。
    const fresh = this._freshProtected
    if (fresh && fresh.size) model.calendar.days.forEach((day) => { day.isFresh = fresh.has(day.id) })
    return model
  },

  readCelebratedDay() {
    try { return wx.getStorageSync(CELEBRATED_KEY) || '' } catch (error) { return '' }
  },

  writeCelebratedDay(day) {
    try { wx.setStorageSync(CELEBRATED_KEY, day) } catch (error) {}
  },

  handleMonthChange(e) {
    const direction = Number(e.currentTarget.dataset.direction)
    if (!this._checkin || !direction) return
    if (direction > 0 && !this.data.model.calendar.canGoNext) return
    const target = new Date(Date.UTC(this.data.calendarYear, this.data.calendarMonth - 1 + direction, 1))
    const year = target.getUTCFullYear()
    const month = target.getUTCMonth() + 1
    if (this._calendarTransitionTimer) clearTimeout(this._calendarTransitionTimer)
    this.setData({
      model: this.buildModel(year, month),
      calendarYear: year,
      calendarMonth: month,
      calendarTransitionClass: direction > 0 ? 'calendar-transition-next' : 'calendar-transition-prev'
    })
    this._calendarTransitionTimer = setTimeout(() => {
      this._calendarTransitionTimer = null
      this.setData({ calendarTransitionClass: '' })
    }, CALENDAR_TRANSITION_MS)
  },

  handleDayTap(e) {
    const days = this.data.model.calendar && this.data.model.calendar.days
    const day = days ? days[Number(e.currentTarget.dataset.index)] : null
    if (!day || !day.isInMonth) return
    if (day.isChecked) return wx.showToast({ title: '这一天已经点亮啦', icon: 'none' })
    if (day.isFrozen) return wx.showToast({ title: day.isFuture ? '这一天已冻结，不打卡也不断连胜' : '这一天用冻结卡保住了连胜', icon: 'none' })
    if (day.isRevived) return wx.showToast({ title: '这一天用复活卡补回来了', icon: 'none' })
    if (day.isFuture) return wx.showToast({ title: '未来日期还不能打卡', icon: 'none' })
    if (day.isToday) return wx.showToast({ title: '学完一节课、通过验收或完成一次复习就能点亮', icon: 'none' })
    wx.showToast({ title: '历史日期仅供查看', icon: 'none' })
  },

  // ---- 道具卡 ----
  handleCardTap(e) {
    const card = (this.data.model.cards || []).find((item) => item.type === e.currentTarget.dataset.type)
    if (!card) return
    if (this._cardSheetCloseTimer) {
      clearTimeout(this._cardSheetCloseTimer)
      this._cardSheetCloseTimer = null
    }
    // 每次打开弹层换一个幂等键：确认后网络重试不会扣两张卡，关掉再开是新的一次使用。
    this._cardUseKey = `streak-card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    const days = card.plan ? card.plan.dates.map((key) => {
      const date = new Date(`${key}T00:00:00Z`)
      return { id: key, label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, weekday: `周${WEEKDAY_SHORT[date.getUTCDay()]}` }
    }) : []
    this.setData({ cardSheet: { ...card, days }, cardSheetClosing: false })
  },

  handleCloseCardSheet() {
    if (!this.data.cardSheet || this.data.cardSheetClosing || this.data.usingCard) return
    this.setData({ cardSheetClosing: true })
    this._cardSheetCloseTimer = setTimeout(() => {
      this._cardSheetCloseTimer = null
      this.setData({ cardSheet: null, cardSheetClosing: false })
    }, CARD_SHEET_CLOSE_MS)
  },

  async handleConfirmUseCard() {
    const sheet = this.data.cardSheet
    if (!sheet || !sheet.usable || this.data.usingCard) return
    this.setData({ usingCard: true })
    let result
    try {
      result = await useCurrentStreakCard(sheet.type, this._cardUseKey)
    } catch (error) {
      this.setData({ usingCard: false })
      wx.showToast({ title: error.message || '道具卡暂时无法使用', icon: 'none' })
      return
    }
    this._freshProtected = new Set(result.dates)
    // 复活卡补的日子可能在上个月：日历翻到补回的那个月，让学生看得见。
    const first = result.dates[0]
    const calendar = first ? { calendarYear: Number(first.slice(0, 4)), calendarMonth: Number(first.slice(5, 7)) } : {}
    this.setData({ usingCard: false, cardSheet: null, cardSheetClosing: false, cardEffect: sheet.type, ...calendar })
    wx.showToast({ title: sheet.type === 'freeze' ? `已冻结 ${dateRange(result.dates)}` : `已补回 ${dateRange(result.dates)}`, icon: 'none' })
    if (this._cardEffectTimer) clearTimeout(this._cardEffectTimer)
    this._cardEffectTimer = setTimeout(() => {
      this._cardEffectTimer = null
      this._freshProtected = null
      this.setData({ cardEffect: '' })
    }, CARD_EFFECT_MS)
    await this.loadCheckIn()
  },



  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/learning/index' })
  },

  handlePrimaryAction() {
    if (this.data.model.checkedToday) {
      this.handleShare()
      return
    }
    wx.switchTab({ url: '/pages/learning/index' })
  },

  // 今日打卡两行任务：没完成时点一行去学习页（学课、费曼验收都从学习页的课程进去）。
  handleTaskTap() {
    if (this.data.model.checkedToday) return
    wx.switchTab({ url: '/pages/learning/index' })
  },

  handleCloseSheet() {
    this.setData({ showSuccessSheet: false })
  },

  handleShare() {
    if (this.data.loadState !== 'ready') return
    if (this._shareSheetCloseTimer) {
      clearTimeout(this._shareSheetCloseTimer)
      this._shareSheetCloseTimer = null
    }
    this.setData({ showShareSheet: true, shareSheetClosing: false }, () => {
      this.drawSharePoster()
      this.exportSharePoster().then((path) => { this._sharePosterPath = path }).catch(() => {})
    })
  },

  handleCloseShareSheet() {
    if (!this.data.showShareSheet || this.data.shareSheetClosing) return
    this.setData({ shareSheetClosing: true })
    this._shareSheetCloseTimer = setTimeout(() => {
      this._shareSheetCloseTimer = null
      this.setData({ showShareSheet: false, shareSheetClosing: false })
    }, SHARE_SHEET_CLOSE_MS)
  },

  handleSheetAction(e) {
    const action = e.currentTarget.dataset.action
    if (action === 'save') {
      this.handleSaveSharePoster()
      return
    }
    if (action === 'timeline') {
      if (this.data.showShareSheet) this.handleCloseShareSheet()
      wx.showToast({ title: '请从右上角菜单选择分享到朋友圈', icon: 'none' })
    }
  },

  shareTitle() {
    const days = this.data.model.streak ? this.data.model.streak.days : 0
    return `我已在知鹿连续学习 ${days} 天`
  },

  onShareAppMessage() {
    const result = { title: this.shareTitle(), path: '/learning/check-in/index' }
    if (this._sharePosterPath) result.imageUrl = this._sharePosterPath
    return result
  },

  onShareTimeline() {
    const result = { title: this.shareTitle(), query: '' }
    if (this._sharePosterPath) result.imageUrl = this._sharePosterPath
    return result
  },

  // 画布不能直接画网络图片：Logo 先从后端素材地址下载到本地（需在小程序后台把素材域名加入 downloadFile 合法域名）。
  // 下载失败时返回空串，海报改用文字品牌名，不影响生成。
  loadPosterLogo() {
    if (this._posterLogoPath !== undefined) return Promise.resolve(this._posterLogoPath)
    const url = getUiAssets()[POSTER_LOGO_KEY]
    if (!url || !wx.getImageInfo) return Promise.resolve('')
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: url,
        success: (info) => { this._posterLogoPath = info.path || ''; resolve(this._posterLogoPath) },
        fail: () => resolve('')
      })
    })
  },

  drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
  },

  // 3:4 海报；预览与 3 倍高清导出共用同一套几何（设计稿 E05 v2）。
  drawSharePoster(done, canvasId = 'sharePosterCanvas', renderScale = 1) {
    return this.loadPosterLogo().then((logoPath) => {
      const width = this.data.sharePosterWidth
      const model = this.data.model
      const sheet = model.successSheet
      const ctx = wx.createCanvasContext(canvasId, this)
      const scale = width / 300 * renderScale
      const font = (size, weight = 600, family = 'sans-serif') => {
        ctx.setFontSize(size * scale)
        ctx.font = `${weight} ${size * scale}px ${family}`
      }
      ctx.clearRect(0, 0, 300 * scale, 400 * scale)
      this.drawRoundRect(ctx, 0, 0, 300 * scale, 400 * scale, 14 * scale)
      ctx.setFillStyle('#FFFFFF')
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(0, 292 * scale)
      ctx.lineTo(300 * scale, 292 * scale)
      ctx.lineTo(300 * scale, 386 * scale)
      ctx.arcTo(300 * scale, 400 * scale, 286 * scale, 400 * scale, 14 * scale)
      ctx.lineTo(14 * scale, 400 * scale)
      ctx.arcTo(0, 400 * scale, 0, 386 * scale, 14 * scale)
      ctx.closePath()
      ctx.setFillStyle('#C4C2BB')
      ctx.fill()

      if (logoPath) {
        ctx.drawImage(logoPath, 18 * scale, 17 * scale, 90 * scale, 35 * scale)
      } else {
        ctx.setTextAlign('left')
        ctx.setFillStyle('#FD7C02')
        font(15, 700)
        ctx.fillText('知鹿学习 iDeer', 18 * scale, 40 * scale)
      }

      ctx.setTextAlign('right')
      ctx.setFillStyle('#151515')
      font(13, 600, 'Georgia')
      ctx.fillText(sheet.posterDateLine, 282 * scale, 32 * scale)
      ctx.fillText(sheet.posterWeekday, 282 * scale, 50 * scale)

      ctx.setTextAlign('left')
      ctx.setFillStyle('#F4F4F2')
      font(15, 600)
      ctx.fillText(`我是 ${model.shareCard.posterNickname}`, 18 * scale, 337 * scale)
      font(14, 600)
      ctx.fillText(`已在知鹿已累计学习打卡${sheet.totalDays}天`, 18 * scale, 359 * scale)

      ctx.beginPath()
      ctx.arc(250 * scale, 344 * scale, 29 * scale, 0, Math.PI * 2)
      ctx.setFillStyle('#FFFFFF')
      ctx.fill()
      ctx.draw(false, done || (() => {}))
    })
  },

  exportSharePoster() {
    return new Promise((resolve, reject) => {
      this.drawSharePoster(() => {
        wx.canvasToTempFilePath({
          canvasId: 'sharePosterExportCanvas',
          x: 0,
          y: 0,
          width: this.data.shareCanvasWidth,
          height: this.data.shareCanvasHeight,
          destWidth: this.data.shareCanvasWidth,
          destHeight: this.data.shareCanvasHeight,
          fileType: 'png',
          success: (result) => resolve(result.tempFilePath),
          fail: reject
        }, this)
      }, 'sharePosterExportCanvas', this.data.shareRenderScale)
    })
  },

  async handleSaveSharePoster() {
    let path
    try {
      path = await this.exportSharePoster()
    } catch (error) {
      wx.showToast({ title: '海报生成失败，请重试', icon: 'none' })
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => {
        this.handleCloseShareSheet()
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (error) => {
        // 取消不提示；没同意隐私指引、手机系统没给微信相册权限、设置里关了相册，各自说明（utils/permission-guide.js，2026-10-06）
        const { guideOnFailure } = require('../../utils/permission-guide')
        guideOnFailure(error, { scope: 'scope.writePhotosAlbum', content: '保存海报需要允许访问相册，请在设置里打开相册权限后再试。' })
          .then((kind) => { if (kind === 'other') wx.showToast({ title: '保存失败，请重试', icon: 'none' }) })
      }
    })
  },

  noop() {},

  onUnload() {
    if (this._calendarTransitionTimer) clearTimeout(this._calendarTransitionTimer)
    if (this._shareSheetCloseTimer) clearTimeout(this._shareSheetCloseTimer)
    if (this._cardSheetCloseTimer) clearTimeout(this._cardSheetCloseTimer)
    if (this._cardEffectTimer) clearTimeout(this._cardEffectTimer)
  }
})
