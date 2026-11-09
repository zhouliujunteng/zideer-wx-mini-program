const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// 学生看板后端（动作流「读取当前家长学生看板」）：只给家长有效关系下的孩子，测评报告只留答错的题
const source = fs.readFileSync(require.resolve('../integrations/zion/guardian/guardian-dashboard.js'), 'utf8')

// 列表只给称呼等轻字段；详情按关系编号给完整数据（与线上两条查询一致）
const LIGHT = ['id', 'nickname', 'real_name', 'current_grade', 'school_stage', 'avatar']
function run(relations, payload) {
  const ops = []
  let result
  const context = {
    getArg: (key) => ({ buyerId: 7, payload })[key],
    setResult: (value) => { result = JSON.parse(JSON.stringify(value)) },
    runGql(name, query, variables) {
      ops.push({ name, query, variables })
      if (name === 'FindGuardianPrincipal') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'ListGuardianDashboardChildren') {
        return { relations: JSON.parse(JSON.stringify(relations)).map((relation) => {
          const light = {}
          for (const key of LIGHT) if (key in relation.student_profile) light[key] = relation.student_profile[key]
          return { ...relation, student_profile: light }
        }) }
      }
      if (name === 'ReadGuardianDashboardChild') {
        const found = relations.filter((relation) => relation.id === variables.relationId)
        return { relations: JSON.parse(JSON.stringify(found)).map((relation) => ({ student_profile: relation.student_profile })) }
      }
      throw new Error('Unexpected operation ' + name)
    }
  }
  vm.runInNewContext('(function(){' + source + '})()', { context })
  return { ops, result }
}

const review = [
  { number: 1, prompt: '  3.5 × 2 = ?  ', correct: true, selected: 'B', topicName: '小数乘法' },
  { number: 2, prompt: '比较 0.5 和 0.45 的大小'.repeat(8), correct: false, selected: 'A', topicName: '小数大小比较' },
  { number: 3, prompt: '没做到的题', correct: false, selected: '', unreached: true, topicName: '小数的意义' }
]
const child = (overrides = {}) => ({
  id: 3, relationship_type: 'guardian', effective_at: '2026-09-01', expires_at: null,
  student_profile: { id: 221, nickname: '小鹿', k12_assessments: [{ id: 40, submitted_at: '2026-09-24T15:00:44+08:00', exam_scope: { name: '四年级数学摸底', subject_code: 'math' }, report: { review, topics: [{ big: 'x' }] } }], ...overrides }
})

test('the dashboard reads only active, unrevoked relations of the signed-in guardian and a bounded history', () => {
  const { ops, result } = run([child()])
  const list = ops.find((op) => op.name === 'ListGuardianDashboardChildren')
  const detail = ops.find((op) => op.name === 'ReadGuardianDashboardChild')
  assert.equal(list.variables.principalId, 42)
  assert.match(list.query, /status: \{ _eq: "active" \}, revoked_at: \{ _is_null: true \}/)
  // 列表不带学习数据
  assert.doesNotMatch(list.query, /k12_assessments|learning_time_rollups|topic_learning_reports/)
  assert.equal(detail.variables.relationId, 3)
  assert.match(detail.variables.sinceDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(result.status, 'ready')
  assert.equal(result.history_since, detail.variables.sinceDate)
})

test('assessment reports are reduced to the wrong answers only', () => {
  const { result } = run([child()])
  const profile = result.children[0].student_profile
  assert.equal(profile.k12_assessments, undefined)
  const [summary] = profile.assessment_mistakes
  assert.equal(summary.scope_name, '四年级数学摸底')
  assert.equal(summary.question_count, 3)
  // 没作答的不算错题
  assert.equal(summary.wrong_count, 1)
  assert.equal(summary.wrong[0].topic_name, '小数大小比较')
  assert.ok(summary.wrong[0].prompt.length <= 61)
  assert.equal(JSON.stringify(summary).includes('explanation'), false)
})

test('expired relations are dropped and an empty list reports no-active-children', () => {
  assert.equal(run([child({}), { ...child(), id: 4, expires_at: '2020-01-01T00:00:00Z' }]).result.children.length, 1)
  assert.equal(run([]).result.status, 'no-active-children')
})

test('flow code keeps Chinese out of string literals', () => {
  // Zion 回读代码时中文偶尔会乱码，只允许出现在注释里
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.equal(/[一-鿿]/.test(code), false)
})

test('only the requested child gets the full data; the rest stay light', () => {
  const second = { ...child(), id: 9, student_profile: { ...child().student_profile, id: 222, nickname: '小星' } }
  const { ops, result } = run([child(), second], { studentProfileId: '222' })
  assert.equal(ops.filter((op) => op.name === 'ReadGuardianDashboardChild').length, 1)
  assert.equal(result.selected_student_profile_id, 222)
  const [first, picked] = result.children
  assert.equal(picked.detail_loaded, true)
  assert.equal(picked.student_profile.assessment_mistakes.length, 1)
  assert.equal(first.detail_loaded, undefined)
  assert.equal(first.student_profile.assessment_mistakes, undefined)
  assert.equal(first.student_profile.nickname, '小鹿')
})

test('a child outside the account falls back to the first one', () => {
  const { result } = run([child()], { studentProfileId: '999' })
  assert.equal(result.selected_student_profile_id, 221)
  assert.equal(result.children[0].detail_loaded, true)
})

test('no children means no detail query', () => {
  const { ops, result } = run([])
  assert.equal(ops.some((op) => op.name === 'ReadGuardianDashboardChild'), false)
  assert.equal(result.selected_student_profile_id, null)
})
