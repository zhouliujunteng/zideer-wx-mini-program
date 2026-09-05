const { switchTab } = require('../utils/navigation')

Component({
  data: {
    selected: 0,
    tabs: [
      { text: '首页', icon: 'home', path: '/pages/home/index' },
      { text: '学习', icon: 'book', path: '/pages/learning/index' },
      { text: '知识图谱', icon: 'network', path: '/pages/knowledge-map/index' },
      { text: '我的', icon: 'user', path: '/pages/me/index' }
    ]
  },

  methods: {
    handleTap(event) {
      const index = Number(event.currentTarget.dataset.index)
      if (index === this.data.selected) return
      switchTab(index)
    }
  }
})
