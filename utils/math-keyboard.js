// 数学键盘（2026-11-17 用户要求）：闯关里的互动练习、考试挑战要写算式时，孩子的输入法打不出 − × ÷ ² ≤ √ π 这些符号，
// 所以页面自带一把键盘。题目是否给键盘由课程服务按题下发（mathKeyboard），学生随时能切回系统键盘写汉字。
// 键位与编辑规则和学生网页端 lib/portal/math-keyboard.ts 是同一份，改一边要改另一边。
// 判分时课程服务把 − × ÷ ² ≤ 与 - * / ^2 <= 当成同一种写法（practice.ts normalizeFill）。

const KEY_PAGES = {
  num: [
    ['7', '8', '9', '+', '(', ')'],
    ['4', '5', '6', '−', '×', '÷'],
    ['1', '2', '3', '=', '/', '.'],
    ['0', 'x', 'y', '²', '√', 'π']
  ],
  sym: [
    ['<', '>', '≤', '≥', '≠', '≈'],
    ['^', '³', '%', '°', '±', '∞'],
    ['∠', '△', '⊥', '∥', ':', ','],
    ['a', 'b', 'c', 'm', 'n', '|']
  ]
}

// 键上显示的字与插入的字不同的键
const KEY_LABELS = { '/': '分数 /', '^': '次方 ^' }

const MAX_LENGTH = 40

function clampCursor(value, cursor) {
  const n = Number(cursor)
  if (!Number.isFinite(n)) return value.length
  return Math.max(0, Math.min(value.length, Math.round(n)))
}

/** 按一个键：返回新的 { value, cursor }。key 是要插入的字，或 back / left / right / clear。 */
function applyKey(value, cursor, key, max = MAX_LENGTH) {
  const text = String(value || '')
  const at = clampCursor(text, cursor)
  if (key === 'back') {
    if (!at) return { value: text, cursor: 0 }
    const cut = at - 1
    return { value: text.slice(0, cut) + text.slice(at), cursor: cut }
  }
  if (key === 'left') return { value: text, cursor: Math.max(0, at - 1) }
  if (key === 'right') return { value: text, cursor: Math.min(text.length, at + 1) }
  if (key === 'clear') return { value: '', cursor: 0 }
  const token = String(key || '')
  if (!token || text.length + token.length > max) return { value: text, cursor: at }
  return { value: text.slice(0, at) + token + text.slice(at), cursor: at + token.length }
}

/** 假输入框按光标拆成前后两段（光标画在中间）。 */
function splitAtCursor(value, cursor) {
  const text = String(value || '')
  const at = clampCursor(text, cursor)
  return { before: text.slice(0, at), after: text.slice(at) }
}

function keyRows(page) {
  return (KEY_PAGES[page] || KEY_PAGES.num).map((row) => row.map((key) => ({ key, label: KEY_LABELS[key] || key })))
}

module.exports = { KEY_PAGES, KEY_LABELS, MAX_LENGTH, applyKey, splitAtCursor, keyRows }
