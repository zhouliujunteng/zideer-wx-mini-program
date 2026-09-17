const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const common = fs.readFileSync(path.join(__dirname, '../../scripts/k12-flows/common.js'), 'utf8')
const map = fs.readFileSync(path.join(__dirname, '../../scripts/k12-flows/map.js'), 'utf8')
const assessment = ['engine.cjs','backend.js'].map(name=>fs.readFileSync(path.join(__dirname,'../../scripts/assessment',name),'utf8')).join('\n')

function matches(row, where) {
  if (where._and) return where._and.every(part => matches(row, part))
  if (where._or) return where._or.some(part => matches(row, part))
  if (where._eq) { const operand = Object.values(where._eq)[0]; return row[operand.left_operand.column] === operand.right_operand.literal }
  return true
}

function graph(profile, args = {}) {
  const topics = Array.from({ length: 12 }, (_, i) => ['上册', '下册', null].map((semester, j) => ({ id: i * 3 + j + 1, dataset_id: 1, grade: i + 1, semester, subject_id: 1, name: `${i + 1}-${j}`, volume: semester || '全一册' }))).flat()
  const tables = {
    account_identity: [{ account_id: 7, user_principal_id: 9, disabled_at: null }],
    user_profile: [{ id: 10, user_principal_id: 9, status: 'active', profile_completed_at: '2026-09-10', ...profile }],
    k12_dataset: [{ id: 1, dataset_key: 'china-k12-tokenmap-135386badef4', status: 'ready' }],
    k12_topic: topics, k12_subject: [{ id: 1, dataset_id: 1, subject_key: 'math', display_name: '数学' }],
    k12_prerequisite: [], k12_evidence: [], k12_score_snapshot: [], k12_exam_scope: [], k12_assessment_attempt: []
  }
  let result
  const context = { getArg: key => key === 'accountId' ? 7 : args[key], setResult: value => { result = value }, runGql(name, query, variables) {
    const table = query.match(/\{(\w+)\(where/)[1]
    let rows = tables[table].filter(row => matches(row, variables.where || variables.w)).map(row => ({ ...row }))
    if (table === 'user_profile' && !query.includes(' semester')) rows.forEach(row => { delete row.semester })
    if (table === 'k12_topic') rows = rows.map(row => ({ ...row, display_name: row.name, grade_start: row.grade, grade_end: row.grade, textbook_volume: row.volume }))
    return { [table]: rows }
  } }
  vm.runInNewContext(assessment + '\n' + common + '\n' + map, { context })
  return result
}

test('graph uses saved grade and semester for every supported profile grade', () => {
  for (let grade = 1; grade <= 12; grade++) for (const semester of ['上学期', '下学期']) {
    const result = graph({ current_grade: grade, semester }, { grade: 8, semester: '上学期' })
    assert.equal(result.status, 'ready')
    assert.equal(result.grade, grade)
    assert.equal(result.semester, semester)
    assert.equal(result.topics.length, 2)
    assert.ok(result.topics.every(topic => topic.grade_start === grade))
    assert.ok(result.topics.every(topic => !topic.semester || topic.semester === (semester === '上学期' ? '上册' : '下册')))
  }
})

test('legacy profile term aliases map to the same source volume without modifying the database', () => {
  for (const [semester, expected] of [['first', '上学期'], ['秋季', '上学期'], ['上册', '上学期'], ['second', '下学期'], ['春季', '下学期'], ['下册', '下学期']]) {
    const result = graph({ current_grade: 8, semester })
    assert.equal(result.semester, expected)
    assert.equal(result.topics.length, 2)
  }
})

test('missing or unknown profile semester asks for selection instead of inventing the first term', () => {
  for (const semester of [null, '', '未知学期']) assert.equal(graph({ current_grade: 8, semester }).status, 'semester_required')
})

test('unassigned source volumes remain available and are counted separately', () => {
  const result = graph({ current_grade: 9, semester: '下学期' })
  assert.equal(result.unassignedTermCount, 1)
  assert.equal(result.topics.some(topic => topic.textbook_volume === '全一册'), true)
})

test('「都不是」 profiles (grade 0) open the universe without a semester instead of asking to complete the profile', () => {
  for (const semester of [null, '']) {
    const result = graph({ current_grade: 0, semester })
    assert.equal(result.status, 'ready')
    assert.equal(result.grade, 0)
    assert.equal(result.semester, '')
    assert.equal(result.topics.length, 0)
    assert.equal(result.diagnostics.length, 0)
  }
})

test('out-of-range grades still require the profile', () => {
  for (const current_grade of [-1, 13, null]) assert.equal(graph({ current_grade, semester: '上学期' }).status, 'profile_required')
})
