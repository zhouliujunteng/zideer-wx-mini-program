const assert = require('node:assert/strict')
const test = require('node:test')
const { courseGenerationState } = require('../utils/course-state')

test('disabled course state takes precedence over a stale ready job', () => {
  for (const status of ['closed', 'cancelled', 'failed', 'voided_credit_limit', 'voided_quality_issue']) {
    const state = courseGenerationState({ status, contentVersionRef: 'lesson' }, { status: 'ready' })
    assert.equal(state.status, status)
    assert.equal(state.canLaunch, false)
    assert.equal(state.canPoll, false)
  }
})

test('missing business readiness or content keeps completed generation synchronizing', () => {
  for (const course of [null, { status: 'generating', contentVersionRef: 'lesson' }, { status: 'ready', contentVersionRef: ' ' }]) {
    const state = courseGenerationState(course, { status: 'completed' })
    assert.equal(state.canLaunch, false)
    assert.equal(state.canPoll, true)
    assert.equal(state.key, 'validating')
  }
})

test('course progress wins over old generation status and controls acceptance', () => {
  for (const status of ['ready', 'in_progress', 'lesson_completed', 'awaiting_acceptance', 'passed']) {
    const state = courseGenerationState({ status, content_version_ref: 'lesson' }, { status: 'usage_collecting' })
    assert.equal(state.status, status)
    assert.equal(state.canLaunch, true)
    assert.equal(state.canPoll, false)
    assert.equal(state.canStartAcceptance, ['lesson_completed', 'awaiting_acceptance'].includes(status))
  }
  assert.equal(courseGenerationState({ status: 'lesson_completed' }).canStartAcceptance, false)
})

test('unrecognized status never invents a generation or learning state', () => {
  const state = courseGenerationState(null, { status: 'unrecognized' }, 'available')
  assert.equal(state.key, 'unknown')
  assert.equal(state.canLaunch, false)
  assert.equal(state.canPoll, false)
})
