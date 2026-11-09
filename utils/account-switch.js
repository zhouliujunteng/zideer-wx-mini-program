// 学生、家长身份互换（2026-09-24 用户规则）：入口在「身份与登录」。
// 家长改学生要补齐学校、年级、教材，基本信息缺什么补什么。
// 2026-09-25 起学生改家长不再清空学校、年级、教材：改回学生时资料都在，直接沿用（studentInfoComplete）。
const { validBirthday } = require('./profile-form')

const accountTypeLabels = { student: '学生', guardian: '家长' }

// 学生、家长共用的基本信息：称呼、所在城市、生日（按学生的要求算：家长的所在城市、生日选填）。
// 性别 2026-09-26 起选填，不算在内。
function basicInfoComplete(profile) {
  const value = profile || {}
  return Boolean(
    String(value.nickname || '').trim() &&
    String(value.region_detail || '').trim() &&
    value.birthday && validBirthday(value.birthday)
  )
}

// 学生资料（年级学期、学校、教材）是否齐全。家长档案的年级 0 只表示「没有年级」，不算齐全。
function studentInfoComplete(profile) {
  const value = profile || {}
  const grade = Number(value.current_grade)
  return Boolean(
    Number.isInteger(grade) && grade >= 1 && grade <= 12 &&
    ['上学期', '下学期'].includes(value.semester) &&
    String(value.school_name || '').trim() &&
    String(value.textbook_version || '').trim()
  )
}

function gradeText(grade) {
  if (grade <= 6) return `小学${grade}年级`
  if (grade <= 9) return `初中${grade - 6}年级`
  return `高中${grade - 9}年级`
}

function studentInfoSummary(profile) {
  const value = profile || {}
  return `${gradeText(Number(value.current_grade))}${value.semester} · ${String(value.school_name || '').trim()} · ${value.textbook_version}`
}

function switchTargetFor(accountType) {
  return accountType === 'guardian' ? 'student' : 'guardian'
}

module.exports = { accountTypeLabels, basicInfoComplete, studentInfoComplete, studentInfoSummary, switchTargetFor }
