const streakBehavior = require('../../utils/streak-behavior')

// 「我的」页常用入口上方的「我的学习连胜」：连续天数、今天是否点亮、本周七天的打卡情况，
// 视觉取自学习连胜页（火苗图标、橙色打卡圆点）；点击进入学习连胜页看完整日历。
// 与顶栏火苗入口共用同一份打卡状态（services/learning-streak.js），任何一处刷新两边同步。
Component({
  behaviors: [streakBehavior],
  data: {
    weekdayLabels: ['日', '一', '二', '三', '四', '五', '六']
  },
  methods: {
    handleTap() {
      // 第一次就没读到：点卡片重试，不带学生去一个同样读不到的页面。
      if (this.data.streakStatus === 'failed') {
        this.refreshStreakState()
        return
      }
      this.openCheckIn()
    }
  }
})
