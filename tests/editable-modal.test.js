const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 可输入的 wx.showModal（editable: true）里 content 是输入框的初始文字，不是说明文字：
// 写了说明就会原样填进输入框（2026-09-25 积分包、会员中心的填码框踩过）。说明放进 title / placeholderText。
const root = path.join(__dirname, '..')
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'tests', 'scripts', 'docs', 'integrations'].includes(name)) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

test('editable modals never pre-fill the input with explanatory content', () => {
  const offenders = []
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8')
    let index = text.indexOf('showModal(')
    while (index !== -1) {
      const options = text.slice(index, text.indexOf('success', index) === -1 ? index + 600 : text.indexOf('success', index))
      if (/editable:\s*true/.test(options) && /\bcontent:/.test(options)) offenders.push(`${path.relative(root, file)}:${text.slice(0, index).split('\n').length}`)
      index = text.indexOf('showModal(', index + 1)
    }
  }
  assert.deepEqual(offenders, [])
})
