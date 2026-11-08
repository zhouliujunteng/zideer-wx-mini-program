// 帮助中心的搜索：只在本机内容里找（常见问题、操作指南都是固定内容，不读后端）。
// 关键词按空格拆开，每个词都要命中才算；词里「怎么」「如何」这类问法先去掉。
// 整个词找不到时按相邻两个字拆开再找（「金币提现」→ 金币 / 币提 / 提现），一半以上命中也算，
// 这样用户直接打一句话（「金币怎么提现」）也能找到「金币怎么兑换成现金？」。
// 排序：标题命中 > 同义词（keywords）命中 > 正文命中。

const FILLERS = ['为什么', '为啥', '怎么样', '怎么办', '怎么', '怎样', '如何', '什么', '在哪里', '在哪儿', '在哪', '哪里', '哪儿', '请问', '我想', '我要', '想要', '可以', '能不能', '能否', '是不是', '一下', '吗', '呢', '啊', '呀', '吧', '的', '了', '我']
const GRAM_RATIO = 0.5

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[\s，。？！、；：,.?!;:「」《》“”"'（）()]+/g, '')
}

function stripFillers(term) {
  let text = term
  for (const word of FILLERS) text = text.split(word).join(' ')
  return text.split(' ').filter(Boolean)
}

// 搜索词：按空格、标点拆开，再去掉问法；全是问法（如只打了「怎么」）就保留原词
function queryTerms(query) {
  const raw = String(query || '').toLowerCase().split(/[\s，。？！、；,.?!;]+/).filter(Boolean)
  const terms = []
  for (const word of raw) {
    const parts = stripFillers(word)
    terms.push(...(parts.length ? parts : [word]))
  }
  return terms
}

function grams(term) {
  const list = []
  for (let i = 0; i + 2 <= term.length; i += 1) list.push(term.slice(i, i + 2))
  return list
}

function haystacks(entry) {
  const body = [].concat(entry.answer || [], entry.summary || [], (entry.steps || []).map((step) => `${step.title}${step.hint || ''}`))
  return {
    title: normalize(entry.title),
    // 同义词之间用「|」隔开，拆字时不会把两个词拼出一个假词
    keywords: (entry.keywords || []).map(normalize).join('|'),
    body: normalize(body.join('|'))
  }
}

function scoreTerm(text, term) {
  if (text.title.includes(term)) return 10
  if (text.keywords.includes(term)) return 6
  if (text.body.includes(term)) return 2
  const list = grams(term)
  if (list.length < 2) return 0
  let hits = 0
  let weight = 0
  for (const gram of list) {
    if (text.title.includes(gram)) { hits += 1; weight += 3 }
    else if (text.keywords.includes(gram)) { hits += 1; weight += 2 }
    else if (text.body.includes(gram)) { hits += 1; weight += 1 }
  }
  return hits / list.length >= GRAM_RATIO ? weight / list.length : 0
}

// 0 表示没命中；分越高越靠前
function scoreEntry(entry, terms) {
  if (!terms.length) return 0
  const text = haystacks(entry)
  let score = 0
  let matched = 0
  for (const term of terms) {
    const value = scoreTerm(text, term)
    // 拆剩的单个字（「换 学生」的「换」）找不到不算数，其余词都要命中
    if (!value && term.length === 1 && terms.length > 1) continue
    if (!value) return 0
    score += value
    matched += 1
  }
  return matched ? score : 0
}

function searchEntries(entries, query) {
  const terms = queryTerms(query)
  if (!terms.length) return []
  return entries
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry)
}

// 把标题按命中的词切成片段，模板里命中的片段标橙色：[{ text, hit }]
function highlight(text, query) {
  const source = String(text || '')
  const lower = source.toLowerCase()
  const marks = new Array(source.length).fill(false)
  const mark = (word) => {
    let from = lower.indexOf(word)
    while (from >= 0) {
      for (let i = from; i < from + word.length; i += 1) marks[i] = true
      from = lower.indexOf(word, from + word.length)
    }
  }
  for (const term of queryTerms(query)) {
    if (lower.includes(term)) mark(term)
    else grams(term).forEach(mark)
  }
  const parts = []
  for (let i = 0; i < source.length; i += 1) {
    const last = parts[parts.length - 1]
    if (last && last.hit === marks[i]) last.text += source[i]
    else parts.push({ text: source[i], hit: marks[i] })
  }
  return parts.length ? parts : [{ text: '', hit: false }]
}

module.exports = { normalize, queryTerms, scoreEntry, searchEntries, highlight }
