const { layoutGoalMap, initialScale } = require('../../utils/goal-map')

// 目标导图组件（2026-10-10）：「目标」tab 与 learning/goal-diagnosis 共用。
// movable-area + movable-view：单指拖动，双指缩放（scale-area 让整块区域都能捏合），右上角也有 ＋/－。
// 卡片和曲线连线都是普通 view（utils/goal-map.js 排版）。点卡片弹说明，卡点下面挂着对应的定制课程，点课程抛 course 事件。
// 事件：course { stageId, state }；sheet { open }（页面据此收起自定义底栏，别盖住说明）。
const MIN = 0.4
const MAX = 2

Component({
  properties: {
    nodes: { type: Array, value: [] },
    height: { type: Number, value: 420 },
    // 示例导图（游客 / 没建档）：只看不点
    sample: { type: Boolean, value: false },
    // 老师只读：课程制作中也列出来
    teacher: { type: Boolean, value: false }
  },

  data: {
    map: null,
    scale: 1,
    scaleValue: 1,
    zoomText: '100%',
    detail: null
  },

  observers: {
    nodes(nodes) {
      const map = layoutGoalMap(nodes)
      const first = !this.data.map || !this.data.map.width
      this.setData({ map })
      if (first) this.fit()
    }
  },

  methods: {
    // 第一次有图：整张放得下就原样，放不下就缩小（不小于 55%）
    fit() {
      const map = this.data.map
      if (!map || !map.width) return
      wx.nextTick(() => {
        this.createSelectorQuery().select('.gm-map-box').boundingClientRect((rect) => {
          if (!rect || !rect.width) return
          // 实测（开发者工具 2026-10-10）：movable-view 缩放后图仍贴着左上角，左边的「目标」一开始就看得到，不用再挪位置
          this.applyScale(initialScale(map.width, map.height, rect.width, this.data.height))
        }).exec()
      })
    },

    applyScale(scale) {
      const value = Math.min(MAX, Math.max(MIN, Math.round(scale * 100) / 100))
      this.setData({ scale: value, scaleValue: value, zoomText: `${Math.round(value * 100)}%` })
    },

    // 双指缩放中：只记数字，不回写 scale-value（回写会和手势打架）
    handleScale(event) {
      const scale = Number(event.detail && event.detail.scale) || this.data.scale
      this._scale = scale
      const text = `${Math.round(scale * 100)}%`
      if (text !== this.data.zoomText) this.setData({ zoomText: text, scale })
    },

    zoomIn() { this.applyScale((this._scale || this.data.scale) * 1.25); this._scale = 0 },
    zoomOut() { this.applyScale((this._scale || this.data.scale) / 1.25); this._scale = 0 },

    openCard(event) {
      if (this.data.sample) return
      const id = String(event.currentTarget.dataset.id || '')
      const card = ((this.data.map && this.data.map.cards) || []).find((item) => item.id === id)
      if (!card) return
      const courses = card.courses
        .filter((course) => this.data.teacher || course.state === 'ready')
        .map((course) => ({ ...course, stateText: course.state === 'making' ? '制作中' : course.state === 'failed' ? '没做成' : '' }))
      this.setData({ detail: { ...card, courses } })
      this.triggerEvent('sheet', { open: true })
    },

    closeDetail() {
      this.setData({ detail: null })
      this.triggerEvent('sheet', { open: false })
    },

    openCourse(event) {
      const { stage, state } = event.currentTarget.dataset
      if (!stage) return
      this.triggerEvent('course', { stageId: String(stage), state: String(state || '') })
    },

    noop() {}
  }
})
