function todayDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function validBirthday(value, today = todayDate()) {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > today) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function normalizeSemester(value) {
  const term = String(value || '').trim().toLowerCase()
  if (['上学期', '上册', '秋季', 'first'].includes(term)) return '上学期'
  if (['下学期', '下册', '春季', 'second'].includes(term)) return '下学期'
  return ''
}

// 生日 → 「X 岁 Y 个月」展示；无效或未来日期返回空串。
function ageDisplay(birthday, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthday))) return ''
  const birth = new Date(`${birthday}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || birth.getTime() > now.getTime()) return ''
  let years = now.getFullYear() - birth.getUTCFullYear()
  let months = now.getMonth() - birth.getUTCMonth()
  if (now.getDate() < birth.getUTCDate()) months -= 1
  if (months < 0) { years -= 1; months += 12 }
  if (years < 0) return ''
  if (years === 0 && months === 0) return '未满 1 个月'
  if (months === 0) return `${years} 岁`
  if (years === 0) return `${months} 个月`
  return `${years} 岁 ${months} 个月`
}

// 中国学制：当年 9 月 1 日前满 6 周岁入读一年级，学年 9 月 1 日起算。
// 返回 1-12 的预估年级；未到入学年龄返回 null（不自动填写）。
function gradeForBirthday(birthday, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthday))) return null
  const birth = new Date(`${birthday}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return null
  const six = new Date(birth)
  six.setUTCFullYear(six.getUTCFullYear() + 6)
  // 满 6 周岁在 9 月 1 日前（含8月底前）→ 当年 9 月入学；9 月及以后 → 次年入学
  const entrySchoolYear = six.getUTCMonth() >= 8 ? six.getUTCFullYear() + 1 : six.getUTCFullYear()
  const currentSchoolYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  const grade = currentSchoolYear - entrySchoolYear + 1
  if (grade < 1) return null
  return Math.min(grade, 12)
}

module.exports = { todayDate, validBirthday, normalizeSemester, ageDisplay, gradeForBirthday }
