const test = require('node:test')
const assert = require('node:assert/strict')

// 错因诊断等工具页的题目 / 作答输入框按文字量估高度，代替 auto-height（长题会把高度算大好几倍，2026-10-09）。
const { estimateLines, textareaHeightRpx } = require('../utils/textarea-height')

const FIT = { widthRpx: 586, fontRpx: 27, lineHeight: 1.7, paddingRpx: 40, minRpx: 260, maxRpx: 1400 }

test('counts wrapped lines, ASCII narrower than CJK', () => {
  assert.equal(estimateLines('', 21), 1)
  assert.equal(estimateLines('一二三\n\n四', 21), 3)
  assert.equal(estimateLines('字'.repeat(43), 21), 3)
  assert.equal(estimateLines('a'.repeat(37), 21), 1)
})

test('height follows the text and stays within bounds', () => {
  assert.equal(textareaHeightRpx('短题', FIT), 260)
  const proof = Array.from({ length: 12 }, () => '故 β − α = 2 ln t > 4(t−1)/(t+1) = 4(β−α)/(α+β)。').join('\n')
  const h = textareaHeightRpx(proof, FIT)
  assert.ok(h > 260 && h < 1400, `got ${h}`)
  assert.equal(textareaHeightRpx('字'.repeat(4000), FIT), 1400)
})
