const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const profileForm = require('../utils/profile-form')
function pageFor(semester) {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/profile-setup/index.js'), 'utf8'), {
    Page: value => { definition = value },
    require: name => name.includes('profile-form') ? profileForm : name.includes('identity') ? {loadCurrentUser:async()=>({profile:{id:1,current_grade:7,semester}}),isAuthenticationRequired:()=>false} : {},
    wx: {showToast(){}}, setTimeout, clearTimeout
  })
  return {...definition, isEditing:true, data:JSON.parse(JSON.stringify(definition.data)),setData(values){for(const [key,value] of Object.entries(values)){const keys=key.split('.');let obj=this.data;while(keys.length>1)obj=obj[keys.shift()];obj[keys[0]]=value}}}
}
test('profile editor restores lower-term aliases instead of silently showing the upper term', async () => {
  for (const term of ['second','春季','下册','下学期']) {
    const page=pageFor(term);await page.loadProfile()
    assert.equal(page.data.form.semester,'下学期')
    assert.equal(page.data.form.semesterIndex,1)
    assert.equal(page.data.form.grade,7)
  }
})
test('existing profile without a semester explicitly asks for a term; choosing year preserves the selected term', async () => {
  const page=pageFor('');await page.loadProfile()
  assert.equal(page.data.form.semesterIndex,-1)
  page.chooseSemester({detail:{value:1}})
  page.chooseGrade({detail:{value:0}})
  assert.equal(page.data.form.grade,1)
  assert.equal(page.data.form.semester,'下学期')
  page.data.saving=true
  page.chooseSemester({detail:{value:0}})
  assert.equal(page.data.form.semester,'下学期')
})
