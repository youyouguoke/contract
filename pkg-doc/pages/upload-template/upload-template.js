const { generateId, showToast } = require('../../../utils/util');
const app = getApp();

Page({
  data: {
    fileInfo: { name: '', size: 0, type: '', path: '' },
    fileSizeText: '',
    uploadProgress: 0,
    uploadStatus: 'idle', // idle | uploading | done | error
    convertStatus: 'idle', // idle | converting | done | error
    templateName: '',
    pageCount: 0,
    manualPageCount: 3,
    isPdf: false,
    isOldDoc: false,
  },

  cloudFileID: '',
  pageDimensions: [],
  pageImages: [],

  onUnload() {},

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'doc', 'docx'],
      success: (res) => {
        const file = res.tempFiles[0];
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'doc', 'docx'].includes(ext)) {
          showToast('仅支持 PDF 和 Word 文件');
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('文件不能超过 20MB');
          return;
        }

        const type = ext === 'pdf' ? 'pdf' : 'word';
        const isPdf = ext === 'pdf';
        const isOldDoc = ext === 'doc';
        const sizeText = file.size < 1024 * 1024
          ? (file.size / 1024).toFixed(1) + ' KB'
          : (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        this.setData({
          fileInfo: { name: file.name, size: file.size, type, path: file.path },
          fileSizeText: sizeText,
          templateName: file.name.replace(/\.(pdf|docx?)$/i, ''),
          uploadStatus: 'idle',
          uploadProgress: 0,
          convertStatus: 'idle',
          pageCount: 0,
          manualPageCount: 3,
          isPdf,
          isOldDoc,
        });
      },
    });
  },

  removeFile() {
    this.cloudFileID = '';
    this.pageDimensions = [];
    this.pageImages = [];
    this.setData({
      fileInfo: { name: '', size: 0, type: '', path: '' },
      fileSizeText: '',
      uploadStatus: 'idle',
      uploadProgress: 0,
      convertStatus: 'idle',
      templateName: '',
      pageCount: 0,
      manualPageCount: 3,
      isPdf: false,
      isOldDoc: false,
    });
  },

  onNameInput(e) {
    this.setData({ templateName: e.detail.value });
  },

  decreasePages() {
    if (this.data.manualPageCount > 1) {
      this.setData({ manualPageCount: this.data.manualPageCount - 1 });
    }
  },

  increasePages() {
    if (this.data.manualPageCount < 20) {
      this.setData({ manualPageCount: this.data.manualPageCount + 1 });
    }
  },

  async startProcess() {
    if (this.data.convertStatus === 'done') {
      this.goToPreview();
      return;
    }
    if (this.data.isOldDoc && this.data.uploadStatus === 'done') {
      this.goToPreview();
      return;
    }

    if (!this.data.templateName.trim()) {
      showToast('请输入模板名称');
      return;
    }
    if (!this.data.fileInfo.path) {
      showToast('请先选择文件');
      return;
    }

    // Step 1: 上传文件到云存储
    this.setData({ uploadStatus: 'uploading', uploadProgress: 0 });

    try {
      const cloudPath = `templates/${Date.now()}_${this.data.fileInfo.name}`;
      const res = await new Promise((resolve, reject) => {
        const uploadTask = wx.cloud.uploadFile({
          cloudPath,
          filePath: this.data.fileInfo.path,
          success: resolve,
          fail: reject,
        });
        uploadTask.onProgressUpdate((prog) => {
          this.setData({ uploadProgress: prog.progress });
        });
      });
      this.cloudFileID = res.fileID;
      this.setData({ uploadProgress: 100, uploadStatus: 'done' });
    } catch (e) {
      this.setData({ uploadStatus: 'error' });
      showToast('上传失败');
      return;
    }

    // Step 2: 调用云函数解析页数（PDF 和 DOCX）
    if (!this.data.isOldDoc) {
      await this.convertDocument();
    }
  },

  async convertDocument() {
    this.setData({ convertStatus: 'converting' });
    try {
      const isPdf = this.data.isPdf;
      const convertRes = await wx.cloud.callFunction({
        name: 'doc2images',
        data: { cloudFileID: this.cloudFileID, renderImages: true },
      });
      const result = convertRes.result;
      if (result && result.code === 0 && result.data) {
        this.pageDimensions = result.data.pageDimensions || [];
        this.pageImages = result.data.pageImages || [];
        const pageCount = result.data.pageCount;

        // DOCX 转 PDF 后，使用转换后的 PDF 的 cloudFileID
        if (result.data.pdfCloudFileID) {
          this.cloudFileID = result.data.pdfCloudFileID;
          this.setData({ isPdf: true });
        }

        if (result.data.renderError) {
          console.warn('PDF渲染错误:', result.data.renderError);
        }

        if (pageCount > 0) {
          this.setData({ convertStatus: 'done', pageCount });
        } else if (result.data.needManualPageCount) {
          this.setData({ convertStatus: 'done', isOldDoc: true });
        } else {
          this.setData({ convertStatus: 'error' });
          showToast('未能检测到页数');
        }
      } else {
        this.setData({ convertStatus: 'error' });
        showToast(result && result.message ? result.message : '文档解析失败');
      }
    } catch (e) {
      console.error('doc2images failed:', e);
      this.setData({ convertStatus: 'error' });
      showToast('文档解析失败');
    }
  },

  retryConvert() {
    if (!this.cloudFileID) {
      showToast('请重新上传文件');
      return;
    }
    this.convertDocument();
  },

  goToPreview() {
    const { fileInfo, templateName, isOldDoc, pageCount, manualPageCount } = this.data;
    const templateId = generateId();
    const finalPageCount = isOldDoc ? manualPageCount : pageCount;

    if (!finalPageCount || finalPageCount <= 0) {
      showToast('未检测到文档页数');
      return;
    }

    const pages = [];
    for (let i = 0; i < finalPageCount; i++) {
      const dim = (this.pageDimensions && this.pageDimensions[i]) || null;
      pages.push({
        pageIndex: i,
        mockLabel: `${templateName} - 第${i + 1}页`,
        image: (this.pageImages && this.pageImages[i]) || '',
        pdfWidth: dim ? dim.width : 0,
        pdfHeight: dim ? dim.height : 0,
      });
    }

    console.log('[goToPreview] cloudFileID:', this.cloudFileID);

    app.globalData.pendingDocTemplate = {
      id: templateId,
      type: 'document',
      name: templateName,
      category: '默认',
      description: `上传文档: ${fileInfo.name}`,
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      fileType: fileInfo.type,
      cloudFileID: this.cloudFileID,
      pageCount: finalPageCount,
      pages,
      markers: [],
      createdAt: new Date().toISOString(),
    };

    wx.navigateTo({ url: `/pkg-doc/pages/doc-preview/doc-preview?templateId=${templateId}` });
  },
});
