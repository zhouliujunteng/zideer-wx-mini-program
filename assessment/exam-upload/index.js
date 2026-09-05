const {
  loadCurrentAssessmentScores,
  saveCurrentAssessmentExamFiles,
  uploadAssessmentImage
} = require('../../services/identity')

const MAX_PAGE_COUNT = 10

function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function emptyForm() {
  return { id: '', examName: '', examDate: today() }
}

function presentPage(file, index) {
  return {
    ...file,
    id: `${file.assetId || 'local'}-${index}`,
    pageNo: index + 1,
    label: `第 ${index + 1} 页`,
    sizeLabel: file.sizeBytes ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '待上传',
    localPath: file.localPath || ''
  }
}

Page({
  data: {
    loading: true,
    saving: false,
    uploading: false,
    attemptId: '',
    records: [],
    recordOptions: ['新建试卷记录'],
    recordIndex: 0,
    form: emptyForm(),
    pages: []
  },

  async onLoad(options) {
    const attemptId = String(options.attemptId || '')
    if (!attemptId) {
      wx.showToast({ title: '缺少测评记录', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ attemptId })
    await this.loadRecords()
  },

  async onPullDownRefresh() {
    await this.loadRecords()
    wx.stopPullDownRefresh()
  },

  async loadRecords() {
    this.setData({ loading: true })
    try {
      const records = await loadCurrentAssessmentScores(this.data.attemptId)
      this.setData({
        records,
        recordOptions: ['新建试卷记录'].concat(records.map((item) => `${item.examName || '未命名试卷'} · ${item.examDate || '未填写日期'}`))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '试卷记录加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseRecord(event) {
    const recordIndex = Number(event.detail.value)
    const record = recordIndex ? this.data.records[recordIndex - 1] : null
    const form = record
      ? { id: record.id, examName: record.examName, examDate: record.examDate || today() }
      : emptyForm()
    const pages = (record && record.originalFiles ? record.originalFiles : []).map(presentPage)
    this.setData({ recordIndex, form, pages })
  },

  updateForm(event) {
    this.setData({ [`form.${event.currentTarget.dataset.key}`]: event.detail.value })
  },

  chooseDate(event) {
    this.setData({ 'form.examDate': event.detail.value })
  },

  chooseFromCamera() {
    this.chooseImages(['camera'])
  },

  chooseFromAlbum() {
    this.chooseImages(['album'])
  },

  chooseImages(sourceType) {
    const remaining = MAX_PAGE_COUNT - this.data.pages.length
    if (!remaining) {
      wx.showToast({ title: `最多上传 ${MAX_PAGE_COUNT} 页`, icon: 'none' })
      return
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType,
      success: (result) => {
        const localPages = (result.tempFilePaths || []).map((localPath) => ({ localPath, name: '待上传图片', sizeBytes: 0 }))
        this.setData({ pages: this.data.pages.concat(localPages).map(presentPage) })
      }
    })
  },

  removePage(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ pages: this.data.pages.filter((_, itemIndex) => itemIndex !== index).map(presentPage) })
  },

  movePage(event) {
    const index = Number(event.currentTarget.dataset.index)
    const target = index + Number(event.currentTarget.dataset.direction)
    if (target < 0 || target >= this.data.pages.length) return
    const pages = this.data.pages.slice()
    const current = pages[index]
    pages[index] = pages[target]
    pages[target] = current
    this.setData({ pages: pages.map(presentPage) })
  },

  async uploadAndSave() {
    if (this.data.saving || this.data.uploading) return
    if (!this.data.form.examName.trim()) {
      wx.showToast({ title: '请填写试卷名称', icon: 'none' })
      return
    }
    if (!this.data.pages.length) {
      wx.showToast({ title: '请先添加至少一页试卷', icon: 'none' })
      return
    }

    this.setData({ uploading: true })
    try {
      const uploadedPages = []
      for (let index = 0; index < this.data.pages.length; index += 1) {
        const page = this.data.pages[index]
        if (page.assetId) {
          uploadedPages.push({ ...page, pageNo: index + 1 })
          continue
        }
        const uploaded = await uploadAssessmentImage(page.localPath, index)
        uploadedPages.push({ ...uploaded, localPath: page.localPath })
        this.setData({ pages: uploadedPages.concat(this.data.pages.slice(index + 1)).map(presentPage) })
      }

      this.setData({ saving: true })
      const saved = await saveCurrentAssessmentExamFiles(this.data.attemptId, this.data.form, uploadedPages)
      wx.showToast({ title: '试卷已保存', icon: 'success' })
      this.setData({
        form: { id: String(saved.id), examName: saved.exam_name, examDate: saved.exam_date || today() },
        pages: uploadedPages.map(presentPage)
      })
      wx.redirectTo({ url: `/assessment/ocr-review/index?attemptId=${encodeURIComponent(this.data.attemptId)}&uploadId=${encodeURIComponent(saved.id)}` })
    } catch (error) {
      wx.showToast({ title: error.message || '图片上传失败，请重试', icon: 'none', duration: 2600 })
    } finally {
      this.setData({ uploading: false, saving: false })
    }
  },

  continueToAnalysis() {
    wx.redirectTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(this.data.attemptId)}` })
  }
})
