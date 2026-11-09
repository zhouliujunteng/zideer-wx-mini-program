// 「目标」tab 的示例导图（2026-10-10）：没登录、没建档时画这一张（审核能按路径打开 tab 页，不能空着）。
// 目标、知识点都是真实的初二数学，掌握状态是编的；页面上方标「示例」，点了去登录 / 去完善。
const N = (id, parentId, kind, label, level, status, extra) => Object.assign(
  { id, parentId, kind, label, level, status, alias: false, current: false }, extra || {}
)

const SAMPLE_GOAL = { text: '期末数学函数部分不丢分', direction: '提高考试成绩', deadline: '' }

const SAMPLE_NODES = [
  N('g', null, 'goal', '函数部分不丢分', 0, 'gap'),
  N('c1', 'g', 'condition', '一次函数的图像与性质', 1, 'gap', { note: '看懂图像是做函数题的基础' }),
  N('t1', 'c1', 'topic', '一次函数的图像', 2, 'gap', { gradeLabel: '初二', topicId: 1 }),
  N('t2', 't1', 'topic', '正比例函数', 3, 'gap', { gradeLabel: '初二', topicId: 2 }),
  N('t3', 't2', 'topic', '比例的意义和基本性质', 4, 'root_gap', { gradeLabel: '六年级', topicId: 3 }),
  N('t4', 't1', 'topic', '平面直角坐标系', 3, 'mastered', { gradeLabel: '初一', topicId: 4 }),
  N('t5', 'c1', 'topic', '一次函数的增减性', 2, 'shaky', { gradeLabel: '初二', topicId: 5 }),
  N('c2', 'g', 'condition', '列方程解应用题', 1, 'mastered', { note: '考试大题常考' }),
  N('t6', 'c2', 'topic', '一元一次方程的应用', 2, 'mastered', { gradeLabel: '初一', topicId: 6 }),
  N('c3', 'g', 'condition', '函数与方程的联系', 1, 'pending', { note: '综合题要把两者连起来' }),
  N('t7', 'c3', 'topic', '一次函数与一元一次方程', 2, 'pending', { gradeLabel: '初二', topicId: 7 })
]

module.exports = { SAMPLE_GOAL, SAMPLE_NODES }
