const { keyRows } = require('../../utils/math-keyboard')

// 数学键盘面板（2026-11-17）：只管按键，按一下发 key 事件 { key }，由页面用 utils/math-keyboard.js 的 applyKey 改答案。
// key：要插入的字，或 back（退格）/ clear（长按退格清空）/ left / right（挪光标）/ system（换系统键盘写汉字）。
Component({
  data: {
    page: 'num',
    rows: keyRows('num')
  },

  methods: {
    noop() {},
    emit(key) {
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      this.triggerEvent('key', { key })
    },
    tapKey(event) {
      this.emit(String(event.currentTarget.dataset.key || ''))
    },
    tapFn(event) {
      this.emit(String(event.currentTarget.dataset.fn || ''))
    },
    clearAll() {
      this.emit('clear')
    },
    togglePage() {
      const page = this.data.page === 'num' ? 'sym' : 'num'
      this.setData({ page, rows: keyRows(page) })
    }
  }
})
