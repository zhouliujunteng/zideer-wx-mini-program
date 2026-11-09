// 家长「学习报告」页（account/parent-reports，2026-10-07）的显示：课程服务给的绑定孩子与报告 → 按孩子分组的卡片。
// 时间、摘要胶囊与老师端同一套（utils/parent-report-view.js）。
const { timeLabel, summaryChips } = require('./parent-report-view')

function studentName(name) {
  const text = String(name || '').trim()
  return text || '孩子'
}

// 每个孩子一组：报告新的在前；没有报告的孩子单独列出来，提示老师还没出。
function groupGuardianReports(view, now = new Date()) {
  const students = Array.isArray(view && view.students) ? view.students : []
  const reports = Array.isArray(view && view.reports) ? view.reports : []
  const groups = students.map((student) => {
    const items = reports
      .filter((report) => Number(report.studentProfileId) === Number(student.profileId))
      .map((report) => ({
        id: report.id,
        timeText: timeLabel(report.completedAt || report.createdAt, now),
        byText: report.teacherName ? `${report.teacherName}出的报告` : '',
        chips: summaryChips(report.summary),
        note: String(report.teacherNote || '')
      }))
    return { profileId: String(student.profileId), name: studentName(student.name), reports: items }
  })
  return {
    groups: groups.filter((group) => group.reports.length),
    waiting: groups.filter((group) => !group.reports.length).map((group) => group.name),
    total: reports.length,
    hasStudents: students.length > 0
  }
}

module.exports = { groupGuardianReports }
