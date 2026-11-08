// 成就卡详情浮层（学习页成就卡，2026-10-13，参考某运动 App「成就卡」的点卡动效）：
//  - 打开：卡片从格子原位置（origin，页面坐标 px）一边绕 Y 轴转一圈一边飞到屏幕中央，背景模糊变暗；关闭时反向飞回。
//  - 打开后卡片跟随手机倾斜轻轻摆动（陀螺仪；电脑版、没有陀螺仪时可用手指拖着摆），反光跟着移动。
//  - 左右滑动卡片或点箭头切换等级。
//  - 抽卡（2026-10-13 按用户录屏逐帧复刻）：卡片翻到背面缩小 → 摊成 5 张背面的扇形「点击选择卡片」→
//    选中那张放大飞到正中「点击卡片查看结果」→ 点一下炸出彩色纸屑、翻到正面揭晓抽到的等级。
//    服务端在点「抽卡」时就开始抽，选哪张只是仪式感，不影响结果。
//  - 震动：打开、切换等级、选卡轻震，开始抽卡中震，揭晓重震。
const { drawInSeries } = require('../../services/achievement-cards')
const { rpxToPx, getMenuButtonRect } = require('../../utils/screen')
const { burstConfetti } = require('../../utils/confetti')

const FLY_IN_MS = 620
const FLY_OUT_MS = 460
const TILT_MAX = 9
const SWIPE_PX = 46
// 抽卡各段时长（按录屏 60fps 量的）
const COLLAPSE_MS = 450
const FAN_MS = 420
const PICK_MS = 380
const REVEAL_MS = 420
const FAN_SCALE = 0.48
const FAN_COUNT = 5

// 扇形里第 i 张（0..4）的位置：以卡片中心为原点，左右摊开、两边略低、各转一点角度
function fanTransform(i, geo, spread) {
  const k = i - (FAN_COUNT - 1) / 2
  // 录屏里相邻两张错开约单张宽的四分之一，两边各转约 7°
  const x = spread ? k * geo.cardWidth * FAN_SCALE * 0.27 : k * 2
  const y = geo.fanDy + (spread ? k * k * geo.cardWidth * 0.012 : 0)
  const r = spread ? k * 7 : k * 1.5
  return `transform: translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${FAN_SCALE}) rotate(${r}deg);`
}

function buzz(type) {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type, fail() {} })
  } catch (error) {
    // 电脑版微信等没有震动能力
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    // 点开的那张卡（mode = detail）；抽卡在它所属的整个系列里抽，抽到哪张就翻出哪张
    card: { type: Object, value: null },
    // 卡所属的系列（含全部卡、这个系列能抽几次 drawsTotal）
    series: { type: Object, value: null },
    // detail：从卡片点开；draw：从系列标题点「抽卡」，直接摊开扇形
    mode: { type: String, value: 'detail' },
    // 卡片在页面上的位置 { left, top, width, height }（boundingClientRect）
    origin: { type: Object, value: null },
    startLevelId: { type: Number, value: 0 }
  },

  data: {
    phase: 'hidden',
    maskOn: false,
    infoOn: false,
    levelIndex: 0,
    level: {},
    cardLeft: 0,
    cardTop: 0,
    cardWidth: 0,
    cardHeight: 0,
    closeTop: 40,
    closeSize: 32,
    infoTop: 400,
    glowTop: 100,
    flyStyle: '',
    tiltStyle: '',
    shineStyle: '',
    flipped: false,
    flipInstant: false,
    shaking: false,
    drawing: false,
    popKey: 0,
    // 抽卡阶段：view 平时 / collapse 翻背面缩小 / fan 扇形可选 / pick 选中飞到中间 / ready 等点开 / reveal 揭晓
    stage: 'view',
    cardHidden: false,
    fan: [],
    hint: '',
    // 正在显示的卡（抽卡后换成抽到的那张）、这个系列还能抽几次、刚抽到的重复卡变了几个碎片
    dcard: null,
    drawsLeft: 0,
    seriesTitle: '',
    dup: null
  },

  lifetimes: {
    detached() {
      this.stopMotion()
      this.clearTimers()
    }
  },

  observers: {
    'card, series, mode'(card, series, mode) {
      if (this.data.phase !== 'hidden' || !series || !series.cards || !series.cards.length) return
      if (mode === 'draw') this.openForDraw()
      else if (card && card.levels && card.levels.length) this.open()
    }
  },

  methods: {
    noop() {},

    timer(fn, ms) {
      this._timers = this._timers || []
      const id = setTimeout(() => {
        this._timers = this._timers.filter((t) => t !== id)
        fn()
      }, ms)
      this._timers.push(id)
    },

    clearTimers() {
      ;(this._timers || []).forEach(clearTimeout)
      this._timers = []
    },

    layout() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const ww = info.windowWidth || 375
      const wh = info.windowHeight || 667
      const top = (info.statusBarHeight || 20) + 44
      // 卡片宽 520rpx，但给下面的信息区留够地方（矮屏缩小）
      const infoHeight = rpxToPx(470, ww)
      const width = Math.min(rpxToPx(520, ww), (wh - top - infoHeight - 24) / 1.4)
      const height = width * 1.4
      const cardTop = top + Math.max(12, (wh - top - infoHeight - height) / 2)
      return {
        ww,
        cardLeft: (ww - width) / 2,
        cardTop,
        cardWidth: width,
        cardHeight: height,
        // 关闭键放左上角、与微信胶囊同一高度（右上角被胶囊占着）
        closeTop: getMenuButtonRect(info).top,
        closeSize: getMenuButtonRect(info).height,
        fanDy: height * 0.05,
        infoTop: cardTop + height + rpxToPx(36, ww),
        glowTop: cardTop + height / 2 - rpxToPx(300, ww)
      }
    },

    // 格子位置 → 相对于中央卡片的位移与缩放
    originTransform(geo, spin) {
      const o = this.data.origin || this.properties.origin
      let dx = 0
      let dy = geo.cardHeight * 0.3
      let scale = 0.3
      if (o && o.width > 0) {
        dx = o.left + o.width / 2 - (geo.cardLeft + geo.cardWidth / 2)
        dy = o.top + o.height / 2 - (geo.cardTop + geo.cardHeight / 2)
        scale = o.width / geo.cardWidth
      }
      return `transform: perspective(1400px) translate3d(${dx}px, ${dy}px, 0) scale(${scale}) rotateY(${spin}deg);`
    },

    /** 从系列标题点「抽卡」：不飞卡，遮罩一出来就摊开扇形。 */
    openForDraw() {
      const series = this.properties.series
      const geo = this.layout()
      this._geo = geo
      const dcard = series.cards[0]
      this.clearTimers()
      this.setData({
        ...geo,
        phase: 'open',
        maskOn: false,
        infoOn: false,
        flipped: true,
        flipInstant: true,
        drawing: false,
        stage: 'view',
        cardHidden: true,
        fan: [],
        hint: '',
        dup: null,
        dcard,
        seriesTitle: series.title,
        drawsLeft: series.drawsTotal || 0,
        levelIndex: 0,
        level: dcard.levels[0],
        tiltStyle: '',
        flyStyle: 'transform: perspective(1400px) translate3d(0, 0, 0) scale(1) rotateY(0deg); transition: none;'
      }, () => this.timer(() => {
        buzz('light')
        this.setData({ maskOn: true, flipInstant: false })
        this.draw()
      }, 34))
    },

    open() {
      const card = this.properties.card
      const series = this.properties.series
      const geo = this.layout()
      this._geo = geo
      let levelIndex = card.levels.findIndex((l) => l.id === this.properties.startLevelId)
      if (levelIndex < 0) {
        // 默认停在拥有的最高一级，没有就第一级
        levelIndex = 0
        card.levels.forEach((l, i) => { if (l.owned) levelIndex = i })
      }
      this.clearTimers()
      this.setData({
        ...geo,
        phase: 'entering',
        maskOn: false,
        infoOn: false,
        flipped: false,
        flipInstant: false,
        shaking: false,
        drawing: false,
        stage: 'view',
        cardHidden: false,
        fan: [],
        hint: '',
        dup: null,
        dcard: card,
        seriesTitle: series.title,
        drawsLeft: series.drawsTotal || 0,
        levelIndex,
        level: card.levels[levelIndex],
        tiltStyle: '',
        shineStyle: '',
        // 背面朝上从格子里飞出来，到中间正好翻成正面
        flyStyle: `${this.originTransform(geo, -180)} transition: none;`
      }, () => {
        this.timer(() => {
          buzz('light')
          this.setData({
            maskOn: true,
            flyStyle: `transform: perspective(1400px) translate3d(0, 0, 0) scale(1) rotateY(0deg); transition: transform ${FLY_IN_MS}ms cubic-bezier(0.2, 1.08, 0.32, 1);`
          })
          this.timer(() => {
            this.setData({ phase: 'open', infoOn: true })
            this.startMotion()
          }, FLY_IN_MS - 120)
        }, 34)
      })
    },

    close() {
      if (this.data.phase !== 'open' || this.data.drawing) return
      this.stopMotion()
      this.setData({
        phase: 'leaving',
        maskOn: false,
        infoOn: false,
        tiltStyle: 'transform: none; transition: transform 200ms ease-out;',
        // 翻回背面飞回格子
        flyStyle: `${this.originTransform(this._geo || this.layout(), 180)} transition: transform ${FLY_OUT_MS}ms cubic-bezier(0.5, 0, 0.75, 0.2);`
      })
      this.timer(() => {
        this.setData({ phase: 'hidden', flyStyle: '' })
        this.triggerEvent('close')
      }, FLY_OUT_MS)
    },

    /* ---------- 倾斜 ---------- */

    applyTilt(rx, ry, smooth) {
      const x = clamp(rx, -TILT_MAX, TILT_MAX)
      const y = clamp(ry, -TILT_MAX, TILT_MAX)
      const last = this._tilt || { x: 0, y: 0 }
      if (!smooth && Math.abs(last.x - x) < 0.35 && Math.abs(last.y - y) < 0.35) return
      const now = Date.now()
      if (!smooth && now - (this._tiltAt || 0) < 32) return
      this._tilt = { x, y }
      this._tiltAt = now
      this.setData({
        tiltStyle: `transform: perspective(900px) rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg); transition: transform ${smooth ? 260 : 90}ms ease-out;`,
        shineStyle: `background-position: ${(50 - y * 5).toFixed(1)}% ${(50 - x * 5).toFixed(1)}%;`
      })
    },

    startMotion() {
      if (!wx.startDeviceMotionListening || this._motion) return
      this._base = null
      this._motion = (e) => {
        if (this._touching || this.data.phase !== 'open') return
        if (!this._base) this._base = { beta: e.beta, gamma: e.gamma }
        // 手机前后倾（beta）→ 卡片上下翻，左右倾（gamma）→ 左右转
        this.applyTilt(-(e.beta - this._base.beta) * 0.32, (e.gamma - this._base.gamma) * 0.32)
      }
      wx.startDeviceMotionListening({
        interval: 'game',
        success: () => wx.onDeviceMotionChange(this._motion),
        fail: () => { this._motion = null }
      })
    },

    stopMotion() {
      if (!this._motion) return
      try {
        if (wx.offDeviceMotionChange) wx.offDeviceMotionChange(this._motion)
        wx.stopDeviceMotionListening({ fail() {} })
      } catch (error) {}
      this._motion = null
    },

    /* ---------- 手指：拖着摆、左右滑切换等级 ---------- */

    touchStart(e) {
      if (this.data.phase !== 'open' || this.data.drawing) return
      const t = e.touches[0]
      this._touch = { x: t.clientX, y: t.clientY }
      this._touching = true
    },

    touchMove(e) {
      if (!this._touch) return
      const t = e.touches[0]
      const dx = t.clientX - this._touch.x
      const dy = t.clientY - this._touch.y
      this.applyTilt(-dy * 0.08, dx * 0.08)
    },

    touchEnd(e) {
      if (!this._touch) return
      const t = (e.changedTouches || [])[0]
      const dx = t ? t.clientX - this._touch.x : 0
      const dy = t ? t.clientY - this._touch.y : 0
      this._touch = null
      this._touching = false
      this._base = null
      this.applyTilt(0, 0, true)
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) this.nextLevel()
        else this.prevLevel()
      }
    },

    /* ---------- 等级 ---------- */

    showLevel(index) {
      const levels = this.data.dcard.levels
      if (this.data.phase !== 'open' || this.data.drawing || index < 0 || index >= levels.length || index === this.data.levelIndex) return
      buzz('light')
      this.setData({ levelIndex: index, level: levels[index], popKey: this.data.popKey + 1 })
    },

    prevLevel() { this.showLevel(this.data.levelIndex - 1) },
    nextLevel() { this.showLevel(this.data.levelIndex + 1) },
    pickLevel(e) { this.showLevel(Number(e.currentTarget.dataset.index)) },

    /* ---------- 抽卡 ---------- */

    /** 点「抽卡」：服务端开始抽；卡片翻到背面、缩小落到中间，接着摊成扇形。 */
    draw() {
      const series = this.properties.series
      if (this.data.phase !== 'open' || this.data.drawing || !(this.data.drawsLeft > 0)) return
      buzz('medium')
      this.stopMotion()
      this._result = drawInSeries(series.id).then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      const geo = this._geo || this.layout()
      // 从系列标题进来、或者已经藏起主卡：直接摊扇形
      if (this.data.cardHidden) {
        this.setData({ drawing: true, stage: 'collapse', infoOn: false, dup: null })
        this.spreadFan(geo)
        return
      }
      this.setData({
        dup: null,
        drawing: true,
        stage: 'collapse',
        infoOn: false,
        tiltStyle: 'transform: none; transition: transform 200ms ease-out;',
        flipped: true,
        flyStyle: `transform: perspective(1400px) translate3d(0, ${geo.fanDy}px, 0) scale(${FAN_SCALE}) rotateY(0deg); transition: transform ${COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1);`
      })
      this.timer(() => this.spreadFan(geo), COLLAPSE_MS)
    },

    /** 换成 5 张叠在一起的背面，下一帧摊开成扇形。 */
    spreadFan(geo) {
      const fan = [0, 1, 2, 3, 4].map((i) => ({ id: i, style: `${fanTransform(i, geo, false)} transition: none;` }))
      this.setData({ stage: 'fan', cardHidden: true, fan }, () => {
        this.timer(() => {
          this.setData({
            fan: fan.map((f) => ({ ...f, style: `${fanTransform(f.id, geo, true)} transition: transform ${FAN_MS}ms cubic-bezier(0.22, 1.2, 0.36, 1), opacity 260ms ease;` })),
            hint: '点击选择卡片'
          })
        }, 34)
      })
    },

    /** 选一张：选中的放大飞到正中摆正，其余往左下淡出。 */
    pickFan(e) {
      if (this.data.stage !== 'fan') return
      const chosen = Number(e.currentTarget.dataset.id)
      const geo = this._geo || this.layout()
      buzz('light')
      this.setData({
        stage: 'pick',
        hint: '',
        fan: this.data.fan.map((f) => f.id === chosen
          ? { ...f, chosen: true, style: `transform: translate3d(0, 0, 0) scale(1) rotate(0deg); transition: transform ${PICK_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.04);` }
          : { ...f, style: `transform: translate3d(${(-geo.cardWidth * 0.3).toFixed(1)}px, ${(geo.cardHeight * 0.32).toFixed(1)}px, 0) scale(0.36) rotate(${(f.id - 2) * 8}deg); opacity: 0; transition: transform ${PICK_MS}ms ease-in, opacity ${PICK_MS}ms ease-in;` })
      })
      this.timer(() => {
        // 正中这张换回主卡（背面朝上、不带过渡），等学生点开
        this.setData({
          flipInstant: true,
          flipped: true,
          flyStyle: 'transform: perspective(1400px) translate3d(0, 0, 0) scale(1) rotateY(0deg); transition: none;',
          cardHidden: false,
          fan: [],
          stage: 'ready',
          hint: '点击卡片查看结果'
        }, () => this.timer(() => this.setData({ flipInstant: false }), 34))
      }, PICK_MS)
    },

    /** 卡片上的点击：平时什么都不做（只拦住关闭），等点开时揭晓。 */
    tapCard() {
      if (this.data.stage === 'ready') this.reveal()
    },

    /** 点开：彩色纸屑 + 翻到正面揭晓。服务端还没回来就等它。 */
    async reveal() {
      this.setData({ stage: 'reveal', hint: '' })
      const outcome = await this._result
      if (this.data.phase === 'hidden') return
      if (outcome.error) {
        const failure = outcome.error
        this.setData({ flipped: false, drawing: false, stage: 'view', infoOn: true, cardHidden: false })
        wx.showToast({ title: failure.message || '抽卡没成功，请稍后再试', icon: 'none' })
        if (failure.code === 'NO_DRAWS') this.triggerEvent('stale')
        this.startMotion()
        return
      }
      const result = outcome.value
      // 在整个系列里抽：翻出来的可能是别的卡
      const series = this.properties.series
      const base = series.cards.find((c) => c.id === result.cardId) || this.data.dcard
      const levels = base.levels.map((l) => (l.id === result.levelId ? { ...l, owned: result.owned, lastDrawn: result.lastDrawn } : l))
      const index = Math.max(0, levels.findIndex((l) => l.id === result.levelId))
      const dcard = { ...base, levels, ownedLevels: base.ownedLevels + (result.isNew ? 1 : 0), ownedCards: base.ownedCards + 1 }
      // 背面朝上时先换好正面内容，再翻
      this.setData({ dcard, levelIndex: index, level: levels[index], drawsLeft: Math.max(0, this.data.drawsLeft - 1) }, () => {
        buzz('heavy')
        this.startConfetti()
        this.setData({ flipped: false })
        this.triggerEvent('drawn', { card: dcard, draw: result })
        this.timer(() => {
          // 抽到已经有的：显示变成了几个碎片
          this.setData({ stage: 'view', drawing: false, infoOn: true, dup: result.fragments > 0 ? { fragments: result.fragments, balance: result.fragmentBalance } : null })
          if (result.fragments > 0) buzz('light')
          this.startMotion()
        }, REVEAL_MS + 180)
      })
    },

    /* ---------- 彩色纸屑（2d 画布，从卡片上沿炸开、带重力飘落） ---------- */

    startConfetti() {
      const geo = this._geo || this.layout()
      burstConfetti(this, '#cr-confetti', { x: geo.cardLeft + geo.cardWidth / 2, y: geo.cardTop + geo.cardHeight * 0.18, spread: geo.cardWidth * 0.5 },
        () => this.data.phase !== 'hidden')
    }
  }
})
