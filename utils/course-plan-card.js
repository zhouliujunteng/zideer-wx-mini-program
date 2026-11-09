// 诊断室「课程安排」卡片：老师（AI）每次用 propose_course_plan 登记方案，就把这份方案原样摆给学生看。
//
// 2026-10-04 线上实测：模型把总纲和每节小纲只写进了 propose_course_plan 的参数，正文一个字没说，
// 诊断室又不显示工具调用，学生一路答题，最后直接被问「这样安排可以吗？」，大纲从没见过。
// 只靠提示词管不住，所以由小程序把登记的方案画成卡片：登记了就一定看得到，看到的就是要建的。
// 参数结构见课程服务 lib/server/agent-runtime/diagnosis-meeting-gate.ts 的 PlanParams。

const PLAN_TOOL_NAME = 'propose_course_plan'
const MAX_LESSONS = 12

function text(value, max) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, max)
}

// 卡片上只放一两句话的概括（2026-10-10 用户要求：课程安排给标题就行，细节不用打出来，字太多不好看）。
// 取 findings 的前一两句，超过 SUMMARY_LIMIT 个字截断。完整的 findings 和每节小纲仍写进会议记录（coursePlanRecordText）。
const SUMMARY_LIMIT = 60
function briefSummary(findings) {
  const sentences = String(findings || '').replace(/\s+/g, ' ').trim().match(/[^。！？!?；;]+[。！？!?；;]?/g) || []
  let out = ''
  for (const sentence of sentences.slice(0, 2)) {
    if (out && Array.from(out + sentence).length > SUMMARY_LIMIT) break
    out += sentence.trim()
  }
  const chars = Array.from(out)
  return chars.length > SUMMARY_LIMIT ? `${chars.slice(0, SUMMARY_LIMIT - 1).join('')}…` : out
}

/**
 * @param {object} args propose_course_plan 的调用参数 { seriesTitle, lessons: [{ lesson, title, knowledgePoint, outline, prerequisites }], findings }
 * @param {object} options { id, revised }：revised = 这场会议里之前已经登记过方案（这份是调整后的）
 * @returns 卡片数据；参数里一节课都没有时返回 null（不画空卡片）
 */
function buildCoursePlanCard(args, { id = '', revised = false } = {}) {
  const value = args && typeof args === 'object' ? args : {}
  const lessons = (Array.isArray(value.lessons) ? value.lessons : [])
    .filter((item) => item && typeof item === 'object' && text(item.title, 80))
    .slice(0, MAX_LESSONS)
    .map((item, index) => {
      const number = Number.isInteger(item.lesson) && item.lesson > 0 ? item.lesson : index + 1
      const prerequisites = (Array.isArray(item.prerequisites) ? item.prerequisites : [])
        .map((point) => text(point, 40))
        .filter(Boolean)
      return {
        key: `${number}-${index}`,
        numberText: `第${number}节`,
        title: text(item.title, 80),
        point: text(item.knowledgePoint, 80),
        outline: text(item.outline, 600),
        prerequisitesText: prerequisites.join('、')
      }
    })
  if (!lessons.length) return null
  return {
    kind: 'plan',
    id,
    label: revised ? '调整后的课程安排' : '课程安排',
    title: text(value.seriesTitle, 80) || '系列课程',
    countText: `共 ${lessons.length} 节`,
    findings: text(value.findings, 400),
    summary: briefSummary(text(value.findings, 400)),
    lessons
  }
}

// 写进会议记录给老师看的纯文本（老师端「直播间记录」按文字显示）。
function coursePlanRecordText(card) {
  if (!card) return ''
  const lines = [`【${card.label}】${card.title}（${card.countText}）`]
  if (card.findings) lines.push(card.findings)
  for (const lesson of card.lessons) {
    lines.push(`${lesson.numberText} ${lesson.title}${lesson.point ? `｜知识点：${lesson.point}` : ''}`)
    if (lesson.outline) lines.push(`  ${lesson.outline}`)
    if (lesson.prerequisitesText) lines.push(`  要用到：${lesson.prerequisitesText}`)
  }
  return lines.join('\n').slice(0, 4000)
}

module.exports = { PLAN_TOOL_NAME, buildCoursePlanCard, coursePlanRecordText, briefSummary }
