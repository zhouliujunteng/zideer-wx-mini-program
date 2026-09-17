const assert = require('node:assert/strict')
const test = require('node:test')

const engine = require('../../scripts/assessment/engine.cjs')

test('AI acceptance pass makes a course knowledge point mastered', () => {
  const mastery = engine.mastery(81, [{
    topicId: 81,
    source: 'ai-acceptance:701',
    type: 'ai_acceptance',
    score: 1,
    level: 'basic'
  }])

  assert.equal(mastery.status, 'mastered')
  assert.equal(mastery.aiVerified, true)
  assert.equal(mastery.teacherVerified, false)
})

test('AI acceptance requiring reinforcement remains visible as a weak point', () => {
  const mastery = engine.mastery(81, [{
    topicId: 81,
    source: 'ai-acceptance:702',
    type: 'ai_acceptance',
    score: 0,
    level: 'basic'
  }])

  assert.equal(mastery.status, 'reinforce')
  assert.equal(mastery.aiVerified, false)
})

