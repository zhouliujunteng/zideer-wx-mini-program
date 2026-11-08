// 学生年级的显示名（学生档案 current_grade 存 1–12），老师端名单与添加学生共用，写法与「我的学生详情」一致。
const GRADE_NAMES = ['小学一年级', '小学二年级', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '初一', '初二', '初三', '高一', '高二', '高三']

function gradeName(grade) {
  const value = Number(grade)
  return Number.isInteger(value) && value >= 1 && value <= 12 ? GRADE_NAMES[value - 1] : ''
}

module.exports = { gradeName }
