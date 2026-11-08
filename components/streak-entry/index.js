const streakBehavior = require('../../utils/streak-behavior')

// 四个 tab 页（首页、学习、宇宙、图谱）顶栏胶囊左边的学习连胜入口：打卡页「学习连胜」的火苗图标，
// 今天已打卡显示点亮版，否则显示未点亮版，两种都会动；点击进入学习连胜页。
// 位置由页面按微信胶囊算好传进来（top / right / size，单位 px），与胶囊顶对齐、同高。
Component({
  behaviors: [streakBehavior],
  properties: {
    top: { type: Number, value: 26 },
    right: { type: Number, value: 100 },
    size: { type: Number, value: 32 }
  }
})
