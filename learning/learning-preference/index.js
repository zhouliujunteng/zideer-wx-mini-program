const { loadLearningPreference, saveLearningPreference } = require('../../services/identity')
const { getNavigationMetrics } = require('../../utils/navigation')
const {
  toggleChoice,
  decorateGroups,
  previewLines,
  sameChoices,
  normalizePreferenceView
} = require('../../utils/learning-preference')

// 学习宇宙 › 学习偏好（2026-10-07 用户需求）：学生点选内置提示词、再补充一段自己的话，
// 诊断会议的 AI 老师定制课程前会先读它、学习目标和学习宇宙，每一页课生成时也会照着来（课程服务 lib/course/learning-preference.ts）。
// 选项目录由课程服务下发：第一次读到之前只画骨架。偏好是学生自己编辑的，读不到也不挡着：
// 用内置目录照样能选、能填，顶部提示之前保存的暂时没读到（可重新读取），保存后以这次为准。

// 骨架：四组选项，每组几块不同宽度的胶囊
const SKELETON_GROUPS = [[96, 84, 108, 72], [118, 76, 104], [90, 100, 82, 96], [80, 74, 88]]

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    state: 'loading',
    readFailed: false,
    readError: '',
    skeletonGroups: SKELETON_GROUPS,
    groups: [],
    note: '',
    noteLength: 0,
    noteLimit: 300,
    notePlaceholder: '',
    preview: [],
    dirty: false,
    saving: false,
    saveError: '',
    // 读到的是已经保存过的内容：没改动时按钮显示「已保存」
    hasSaved: false
  },

  onLoad() {
    this.setData(getNavigationMetrics())
    this.load()
  },

  onResize() {
    this.setData(getNavigationMetrics())
  },

  async load() {
    if (this._loading) return
    this._loading = true
    try {
      const view = normalizePreferenceView(await loadLearningPreference())
      // 读失败后学生已经动手改了：不冲掉他正在改的，只换上真实的「已保存」用来判断改没改
      if (this.data.state === 'ready' && this.data.dirty) {
        this._saved = { choices: view.choices, note: view.note }
        this.setData({ readFailed: false, readError: '' })
        this.refresh()
      } else {
        this.applySaved(view)
        this.setData({ readFailed: false, readError: '' })
      }
    } catch (error) {
      // 读到过就不打扰；第一次就读不到：用内置目录先让他选
      if (this.data.state === 'ready' && !this.data.readFailed) return
      if (this.data.state !== 'ready') this.applySaved(normalizePreferenceView(null))
      this.setData({ readFailed: true, readError: (error && error.message) || '' })
    } finally {
      this._loading = false
    }
  },

  retryRead() {
    this.load()
  },

  // 读到 / 保存后：以后端为准重画，记下这一版用来判断有没有改动
  applySaved(view) {
    this._catalog = view.catalog
    this._saved = { choices: view.choices, note: view.note }
    this._choices = view.choices
    this.setData({
      state: 'ready',
      hasSaved: view.status === 'set',
      noteLimit: view.catalog.noteLimit,
      notePlaceholder: view.catalog.notePlaceholder,
      note: view.note,
      saveError: ''
    })
    this.refresh()
  },

  refresh() {
    const note = String(this.data.note || '')
    const saved = this._saved || { choices: {}, note: '' }
    this.setData({
      groups: decorateGroups(this._catalog, this._choices),
      preview: previewLines(this._catalog, this._choices, note),
      noteLength: Array.from(note).length,
      dirty: !sameChoices(saved.choices, this._choices) || saved.note.trim() !== note.trim()
    })
  },

  handleOptionTap(event) {
    if (this.data.saving || !this._catalog) return
    const { group, option } = event.currentTarget.dataset
    const result = toggleChoice(this._catalog, this._choices, String(group || ''), String(option || ''))
    if (result.full) {
      wx.showToast({ title: `这一组最多选 ${result.max} 项`, icon: 'none' })
      return
    }
    this._choices = result.choices
    this.setData({ saveError: '' })
    this.refresh()
  },

  handleNoteInput(event) {
    if (this.data.saving) return
    this.setData({ note: String((event.detail && event.detail.value) || ''), saveError: '' })
    this.refresh()
  },

  async save() {
    if (this.data.saving || !this.data.dirty) return
    this.setData({ saving: true, saveError: '' })
    try {
      const view = normalizePreferenceView(await saveLearningPreference({ choices: this._choices, note: this.data.note }))
      this.applySaved(view)
      this.setData({ readFailed: false, readError: '' })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (error) {
      this.setData({ saveError: (error && error.message) || '学习偏好没有保存成功，请稍后重试。' })
    } finally {
      this.setData({ saving: false })
    }
  },

  handleBack() {
    const leave = () => wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/knowledge-universe/index' }) })
    if (!this.data.dirty || this.data.state !== 'ready') return leave()
    wx.showModal({
      title: '还没有保存',
      content: '这次的修改还没保存，离开后不会生效。',
      confirmText: '保存',
      cancelText: '不保存',
      success: (result) => {
        if (result && result.confirm) this.save().then(() => { if (!this.data.dirty) leave() })
        else if (result && result.cancel) leave()
      }
    })
  }
})
