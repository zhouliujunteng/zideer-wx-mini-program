const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 换头像（2026-11-14）：点头像弹 avatar-picker，能选知鹿默认头像（与网页端同一套 portal-avatars 图），也保留微信头像
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('both avatar entry points open the picker instead of the bare WeChat chooser', () => {
  for (const page of ['pages/profile/index', 'pages/profile-setup/index']) {
    const wxml = read(`${page}.wxml`)
    assert.match(wxml, /<avatar-picker [^>]*bind:preset="\w+"[^>]*bind:wechat="\w+"/)
    assert.doesNotMatch(wxml, /open-type="chooseAvatar"/, `${page} still opens the WeChat chooser directly`)
    assert.match(wxml, /bindtap="openAvatarPicker"/)
    assert.equal(JSON.parse(read(`${page}.json`)).usingComponents['avatar-picker'], '/components/avatar-picker/index')
  }
  const picker = read('components/avatar-picker/index.wxml')
  assert.match(picker, /open-type="chooseAvatar"/)
  assert.match(picker, /bindtap="pickPreset"/)
})

test('the preset list mirrors the web portal presets and is fetched from the course service, not the package', () => {
  const source = read('services/identity.js')
  const ids = [...source.match(/const AVATAR_PRESETS = \[([\s\S]*?)\n\]/)[1].matchAll(/id: '([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(ids, ['deer', 'fox', 'panda', 'cat', 'rabbit', 'bear', 'owl', 'penguin', 'tiger', 'dolphin', 'dino', 'astronaut'])
  assert.match(source, /\/portal-avatars\/\$\{preset\.id\}\.png/)
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'assets/avatar-presets')))
})
