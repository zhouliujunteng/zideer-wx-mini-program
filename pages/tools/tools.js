Page({
  data: {
    tools: [
      { id: 'record', name: '学习记录', detail: '沉淀每次私课后的重点与反馈', tone: 'green' },
      { id: 'practice', name: '课后练习', detail: '按当前学习计划领取练习内容', tone: 'yellow' },
      { id: 'consult', name: '私课咨询', detail: '整理学习问题并提交给老师', tone: 'coral' }
    ]
  },

  showUnavailable() {
    wx.showToast({ title: '工具服务正在接入', icon: 'none' })
  }
})
