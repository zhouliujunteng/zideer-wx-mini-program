const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function allocate({ existing = null, occupied = [], raceWinner = null, collision = false, random = 0, accountId = 1 } = {}) {
  const calls = []
  let value = existing
  const context = {
    getArg: () => accountId,
    setResult: result => { value = result },
    runGql(name, query, variables) {
      calls.push({ name, query, variables })
      if (name === 'PublicIdOwner') return { account_identity: [{ user_principal_id: 7 }] }
      if (name === 'ReadPublicId') return { user_principal: [{ id: 7, public_id: value }] }
      if (name === 'OccupiedPublicIds') return { user_principal: occupied.map(public_id => ({ public_id })) }
      if (name === 'AssignPublicId') {
        assert.match(query, /public_id:\s*\{\s*_is_null:\s*true/)
        if (collision) throw new Error('duplicate key violates unique constraint user_principal_public_id_unique')
        value = raceWinner || variables.publicId
        return { update_user_principal: { returning: raceWinner ? [] : [{ public_id: value }] } }
      }
      throw new Error('Unexpected query: ' + name)
    }
  }
  const source = fs.readFileSync(path.join(__dirname, '../integrations/zion/profile/assign-public-user-id.js'), 'utf8')
  const math = Object.create(Math)
  let randomIndex = 0
  math.random = () => Array.isArray(random) ? random[randomIndex++ % random.length] : random
  vm.runInNewContext('(function(){' + source + '})()', { context, Math: math })
  return { value, calls }
}

test('new user receives six digits without changing the internal identity', () => {
  const result = allocate()
  assert.equal(result.value, '100000')
  assert.equal(result.calls.find(c => c.name === 'AssignPublicId').variables.principalId, 7)
  assert.equal(allocate({ random: 0.999999999 }).value, '999999')
})
test('existing public ID never changes on another login', () => {
  const result = allocate({ existing: '234567' })
  assert.equal(result.value, '234567')
  assert.equal(result.calls.some(c => c.name === 'AssignPublicId'), false)
})
test('occupied candidates are skipped; bounded exhaustion fails explicitly', () => {
  assert.equal(allocate({ occupied: ['100000'], random: [0, 0.5] }).value, '550000')
  assert.throws(() => allocate({ occupied: ['100000'] }), /PUBLIC_ID_RETRY/)
})
test('concurrent same-user allocation preserves the first committed number', () => {
  assert.equal(allocate({ raceWinner: '765432' }).value, '765432')
})
test('database uniqueness conflict retries the entire transaction, never more queries in an aborted transaction', () => {
  assert.throws(() => allocate({ collision: true }), /PUBLIC_ID_RETRY/)
})
test('unauthenticated user cannot allocate an ID', () => {
  assert.throws(() => allocate({ accountId: null }), /请先登录/)
})

test('My account displays the public ID instead of a database primary key', async () => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module, require: name => name === './mock-service' ? { getMeModel: () => ({ profile: {}, accountSummary: [{}, {}] }) } : {
      loadMeDashboard: async () => ({ profile: { id: 7, publicId: '234567' } }),
      loadCurrentGrowthCenter: async () => null,
    },
  })
  assert.equal((await module.exports.getLiveMeModel()).profile.id, '234567')
})
