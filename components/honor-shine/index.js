// 能「拿在手里转」的奖杯 / 勋章（2026-11-13 用户要求：照小米汽车勋章，随手机转动有动效）。
// 进场翻转一圈半落定；之后跟着手机姿态倾斜、高光扫过；手指拖动也能转；没有陀螺仪（电脑版、开发者工具）就自己慢慢摆。
// 画法在 utils/honor-shine.js：先用 WebGL 三维画（有厚度、真透视、光照在浮雕上，2026-11-13 夜用户嫌二维）；
// 手机不支持 WebGL 就退回二维画布；画布也用不了、图读不到时，就是一张普通的图。
const { drawHonor, createHonorRenderer, tiltFromMotion, idleTilt, clamp } = require('../../utils/honor-shine')

const FLIP_MS = 1100

Component({
  properties: {
    // 图的地址（页面用 UA.src 取好的）
    src: { type: String, value: '', observer() { this.restart() } }
  },

  data: { painted: false, mode: 'webgl' },

  lifetimes: {
    attached() { this._alive = true },
    ready() { this.restart() },
    detached() {
      this._alive = false
      this.stop()
    }
  },

  pageLifetimes: {
    hide() { this.stop() },
    show() { if (this._alive && this.data.src) this.restart() }
  },

  methods: {
    restart() {
      this.stop()
      if (!this._alive || !this.data.src) return
      const run = (this._run = (this._run || 0) + 1)
      const webgl = this.data.mode === 'webgl'
      // 等这一轮渲染完（换画布类型后节点才在）
      wx.nextTick(() => {
        if (run !== this._run) return
        this.createSelectorQuery().select(webgl ? '#hs-gl' : '#hs-canvas').fields({ node: true, size: true }).exec((result) => {
          const found = result && result[0]
          if (run !== this._run || !found || !found.node || !found.width) return
          const canvas = found.node
          const ratio = Math.min(3, (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2)
          canvas.width = Math.round(found.width * ratio)
          canvas.height = Math.round(found.height * ratio)
          let gl = null
          let ctx = null
          try {
            if (webgl) gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true })
            else ctx = canvas.getContext('2d')
          } catch (error) { /* 下面按拿不到处理 */ }
          if (webgl && !gl) return this.fallback()
          if (!webgl && !ctx) return
          const image = canvas.createImage()
          image.onload = () => {
            if (run !== this._run) return
            if (webgl) {
              const renderer = createHonorRenderer(gl, image)
              if (!renderer) return this.fallback()
              this._renderer = renderer
              this.play(canvas, (state) => renderer.draw(state))
            } else {
              this.play(canvas, (state) => drawHonor(ctx, image, found.width, state))
            }
          }
          image.onerror = () => { /* 留着底下那张普通的图 */ }
          image.src = this.data.src
        })
      })
    },

    // 三维画不了：换成二维画布再来一遍
    fallback() {
      if (this.data.mode !== 'webgl') return
      this.setData({ mode: '2d', painted: false }, () => this.restart())
    },

    play(canvas, draw) {
      const run = this._run
      const started = Date.now()
      this._tilt = { x: 0, y: 0 }
      this._target = null
      this.listenMotion()
      const frame = () => {
        if (run !== this._run || !this._alive) return
        const now = Date.now()
        // 手指拖着 > 手机姿态 > 自己摆
        const want = this._drag || this._target || idleTilt(now - started)
        this._tilt.x += (want.x - this._tilt.x) * 0.16
        this._tilt.y += (want.y - this._tilt.y) * 0.16
        try {
          draw({ tiltX: this._tilt.x, tiltY: this._tilt.y, flip: (now - started) / FLIP_MS })
        } catch (error) {
          return this.data.mode === 'webgl' ? this.fallback() : undefined // 画不了：三维退二维，二维就停、留着普通的图
        }
        if (!this.data.painted) this.setData({ painted: true })
        this._frame = canvas.requestAnimationFrame(frame)
        this._canvas = canvas
      }
      frame()
    },

    listenMotion() {
      if (this._motion || !wx.startDeviceMotionListening) return
      this._base = null
      this._motion = (motion) => {
        if (!this._base) this._base = { gamma: motion.gamma, beta: motion.beta }
        this._target = tiltFromMotion(motion, this._base)
      }
      wx.startDeviceMotionListening({
        interval: 'game',
        success: () => { if (this._motion) wx.onDeviceMotionChange(this._motion) },
        fail: () => { this._motion = null } // 没有陀螺仪：自己摆
      })
    },

    stop() {
      this._run = (this._run || 0) + 1
      if (this._canvas && this._frame) this._canvas.cancelAnimationFrame(this._frame)
      this._frame = null
      if (this._renderer) this._renderer.dispose()
      this._renderer = null
      if (this._motion) {
        try { wx.offDeviceMotionChange(this._motion) } catch (error) { /* 旧基础库没有按回调取消 */ }
        try { wx.stopDeviceMotionListening() } catch (error) { /* 没开过 */ }
        this._motion = null
      }
      this._target = null
      this._drag = null
    },

    onTouchStart(event) {
      const touch = event.touches[0]
      this._touch = { x: touch.clientX, y: touch.clientY }
    },

    onTouchMove(event) {
      const touch = event.touches[0]
      if (!this._touch || !touch) return
      this._drag = { x: clamp((touch.clientX - this._touch.x) / 90, -1, 1), y: clamp((touch.clientY - this._touch.y) / 90, -1, 1) }
    },

    onTouchEnd() {
      this._drag = null
      this._touch = null
      this._base = null // 松手后以现在的手机姿态为准重新算
    }
  }
})
