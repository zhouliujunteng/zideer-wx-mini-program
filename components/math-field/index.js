const { splitAtCursor } = require('../../utils/math-keyboard')

// 数学键盘用的「假输入框」（2026-11-17）：小程序的 input 一聚焦就弹系统键盘，所以用数学键盘时答案画在这里，
// 光标画在 cursor 处；点一下发 focus 事件，页面把键盘对准这一格。
Component({
  properties: {
    value: { type: String, value: '' },
    cursor: { type: Number, value: -1 },
    active: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    placeholder: { type: String, value: '在这里填写' },
    small: { type: Boolean, value: false }
  },

  data: { before: '', after: '' },

  observers: {
    'value, cursor': function (value, cursor) {
      this.setData(splitAtCursor(value, cursor < 0 ? String(value || '').length : cursor))
    }
  },

  methods: {
    tap() {
      if (this.properties.disabled) return
      this.triggerEvent('focus')
    }
  }
})
