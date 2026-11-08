/**
 * 学生的个性化学习偏好（2026-10-07 用户需求）：「学习宇宙 › 学习偏好」页面用的纯函数。
 *
 * 内置提示词（选项与每个选项背后那句话）由课程服务下发（OpenMAIC-sync lib/course/learning-preference.ts），
 * 这里只按目录画选项、管选中状态、拼「老师会看到」的预览。改提示词改课程服务，不用重新上传小程序。
 * 诊断会议的 AI 老师定制课程前会读这份偏好（随学习基本盘一起附在开场词里，见 services/identity.js loadLearnerBaseline）。
 */

// 课程服务读不到时（没联网、服务在更新）用的内置目录：学习偏好是学生自己编辑的，读不到也要能选、能填。
// 与课程服务 OpenMAIC-sync/lib/course/learning-preference.ts 的 LEARNING_PREFERENCE_CATALOG 保持一致；
// 以接口下发的为准，这份只在读取失败时兜底（选项 id 对不上的，保存时课程服务会丢掉）。
const FALLBACK_CATALOG = {
  noteLimit: 300,
  notePlaceholder: '比如：我容易粗心，希望每道题都提醒我检查一遍；我对图形不太敏感，希望多画图。',
  groups: [
    { id: 'explain', title: '怎么讲我更容易懂', hint: '最多选 3 项', max: 3, options: [
      { id: 'life', label: '多举生活例子', prompt: '讲新知识时多用生活里常见的事情打比方，先让我觉得熟悉，再讲概念。' },
      { id: 'visual', label: '多画图多演示', prompt: '能画图的地方就画图，变化的过程用动画一步步演示，少给大段文字。' },
      { id: 'why-first', label: '先讲为什么', prompt: '先把道理和来龙去脉讲清楚，再给公式和做法，我想知道为什么要这样做。' },
      { id: 'example-first', label: '先看例题再总结', prompt: '先带我完整做一道例题，再从例题里总结方法和规律。' },
      { id: 'story', label: '用故事或问题引入', prompt: '用一个小故事或有意思的问题开头，引起我的兴趣再进入正题。' },
      { id: 'compare', label: '易混的放一起对比', prompt: '容易混淆的概念放在一起对比着讲，讲清楚它们的区别。' }
    ] },
    { id: 'pace', title: '讲课节奏', hint: '选 1 项', max: 1, options: [
      { id: 'slow', label: '慢一点，步骤拆细', prompt: '讲慢一点，关键步骤拆细讲，重要的地方换个说法再讲一遍。' },
      { id: 'steady', label: '正常节奏', prompt: '节奏适中，讲清楚了就往下走。' },
      { id: 'fast', label: '快一点，直奔难点', prompt: '我接受得比较快，基础部分快速带过，把时间留给难点。' }
    ] },
    { id: 'practice', title: '练习方式', hint: '最多选 3 项', max: 3, options: [
      { id: 'each', label: '讲一点练一点', prompt: '每讲完一个小知识点，马上出一道小题让我练一练。' },
      { id: 'more', label: '多做题巩固', prompt: '多安排一些练习题，从易到难，帮我巩固。' },
      { id: 'hands-on', label: '多动手互动', prompt: '多用拖一拖、点一点的互动练习，我喜欢自己动手试。' },
      { id: 'mistakes', label: '讲清易错点', prompt: '把常见的错误和陷阱单独拿出来讲，告诉我怎么避开。' },
      { id: 'recap', label: '最后帮我总结', prompt: '每节课最后用几句话帮我把重点串起来。' }
    ] },
    { id: 'tone', title: '说话风格', hint: '选 1 项', max: 1, options: [
      { id: 'fun', label: '轻松有趣', prompt: '说话轻松有趣一点，可以幽默，像朋友聊天一样。' },
      { id: 'encourage', label: '多鼓励我', prompt: '多鼓励我，做对了就肯定我，做错了也别让我泄气。' },
      { id: 'concise', label: '简洁直接', prompt: '说话简洁直接，不绕弯子，直奔重点。' }
    ] }
  ]
}

function cleanCatalog(catalog) {
  const groups = Array.isArray(catalog && catalog.groups) ? catalog.groups : []
  return {
    noteLimit: Number(catalog && catalog.noteLimit) || 300,
    notePlaceholder: String((catalog && catalog.notePlaceholder) || ''),
    groups: groups
      .filter((group) => group && group.id && Array.isArray(group.options))
      .map((group) => ({
        id: String(group.id),
        title: String(group.title || ''),
        hint: String(group.hint || ''),
        max: Math.max(1, Number(group.max) || 1),
        options: group.options
          .filter((option) => option && option.id)
          .map((option) => ({ id: String(option.id), label: String(option.label || ''), prompt: String(option.prompt || '') }))
      }))
  }
}

/** 已保存的选择只留目录里还认得的。 */
function cleanChoices(catalog, choices) {
  const result = {}
  ;(catalog.groups || []).forEach((group) => {
    const picked = Array.isArray(choices && choices[group.id]) ? choices[group.id] : []
    const ids = group.options.map((option) => option.id).filter((id) => picked.indexOf(id) >= 0).slice(0, group.max)
    if (ids.length) result[group.id] = ids
  })
  return result
}

/**
 * 点一个选项：单选组直接换成它（再点取消）；多选组再点取消，已满时不加，返回 full 让页面提示。
 * 返回新的 choices，不改传入的对象。
 */
function toggleChoice(catalog, choices, groupId, optionId) {
  const group = (catalog.groups || []).find((item) => item.id === groupId)
  const next = Object.assign({}, choices)
  if (!group || !group.options.some((option) => option.id === optionId)) return { choices: next, full: false }
  const current = (next[groupId] || []).slice()
  const index = current.indexOf(optionId)
  if (index >= 0) current.splice(index, 1)
  else if (group.max === 1) current.splice(0, current.length, optionId)
  else if (current.length >= group.max) return { choices: next, full: true, max: group.max }
  else current.push(optionId)
  const ordered = group.options.map((option) => option.id).filter((id) => current.indexOf(id) >= 0)
  if (ordered.length) next[groupId] = ordered
  else delete next[groupId]
  return { choices: next, full: false }
}

/** WXML 不能调方法：选中状态写成每个选项上的布尔值。 */
function decorateGroups(catalog, choices) {
  return (catalog.groups || []).map((group) => {
    const picked = choices[group.id] || []
    return Object.assign({}, group, {
      selectedCount: picked.length,
      options: group.options.map((option) => Object.assign({}, option, { selected: picked.indexOf(option.id) >= 0 }))
    })
  })
}

/** 「老师会看到」：每组一行，写的是选项背后的提示词原文；最后是学生自己补充的话。 */
function previewLines(catalog, choices, note) {
  const lines = []
  ;(catalog.groups || []).forEach((group) => {
    const picked = choices[group.id] || []
    const prompts = group.options.filter((option) => picked.indexOf(option.id) >= 0).map((option) => option.prompt)
    if (prompts.length) lines.push({ id: group.id, title: group.title, text: prompts.join('') })
  })
  const extra = String(note || '').trim()
  if (extra) lines.push({ id: 'note', title: '我还想说', text: extra })
  return lines
}

function choiceCount(choices) {
  return Object.keys(choices || {}).reduce((sum, key) => sum + ((choices[key] || []).length), 0)
}

function sameChoices(a, b) {
  const keys = Object.keys(Object.assign({}, a, b))
  return keys.every((key) => (a[key] || []).join(',') === (b[key] || []).join(','))
}

/** 宇宙页入口上的一行摘要。 */
function summaryText(labels, note) {
  const list = (Array.isArray(labels) ? labels : []).filter(Boolean)
  if (!list.length) return String(note || '').trim() ? '已写下补充说明' : ''
  return list.length > 3 ? `${list.slice(0, 3).join('、')} 等 ${list.length} 项` : list.join('、')
}

/** 接口回包 → 页面用的样子；回包里没有目录（或读取失败传 null）时用内置目录。 */
function normalizePreferenceView(data) {
  const served = cleanCatalog(data && data.catalog)
  const catalog = served.groups.length ? served : cleanCatalog(FALLBACK_CATALOG)
  const preference = (data && data.preference) || null
  return {
    catalog,
    status: data && data.status === 'set' ? 'set' : 'empty',
    choices: cleanChoices(catalog, preference && preference.choices),
    note: String((preference && preference.note) || ''),
    labels: Array.isArray(data && data.labels) ? data.labels.map(String) : [],
    updatedAt: String((preference && preference.updatedAt) || '')
  }
}

module.exports = {
  FALLBACK_CATALOG,
  cleanCatalog,
  cleanChoices,
  toggleChoice,
  decorateGroups,
  previewLines,
  choiceCount,
  sameChoices,
  summaryText,
  normalizePreferenceView
}
