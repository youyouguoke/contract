const { MARKER_TYPES, SIGNER_ROLES, PRESET_DOCUMENT_TEMPLATES } = require('../../../utils/constants');
const { addDocumentTemplate, updateDocumentTemplate, getDocumentTemplates } = require('../../../utils/cloud-db');
const { generateId, showToast } = require('../../../utils/util');
const app = getApp();

Page({
  data: {
    templateId: '',
    pages: [],
    markers: [],
    currentPageIndex: 0,
    currentPage: {},
    currentPageMarkers: [],
    selectedMarkerId: '',
    pageWidthPx: 0,
    pageHeightPx: 0,
    mockLines: [],
    signerRoles: SIGNER_ROLES.slice(0, 2),
    pendingMarkerType: '',
    cloudFileID: '',
  },

  pageWidthPx: 0,
  pageHeightPx: 0,

  async onLoad(options) {
    const { templateId } = options;

    let template = app.globalData.pendingDocTemplate;
    if (!template || template.id !== templateId) {
      template = PRESET_DOCUMENT_TEMPLATES.find(t => t.id === templateId);
    }
    if (!template) {
      try {
        await app.loginPromise;
        const savedTpls = await getDocumentTemplates();
        template = savedTpls.find(t => t.id === templateId || t._id === templateId);
      } catch (e) {
        console.error('Load template from DB failed', e);
      }
    }
    if (!template) {
      showToast('模板不存在');
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    if (!app.globalData.pendingDocTemplate || app.globalData.pendingDocTemplate.id !== templateId) {
      app.globalData.pendingDocTemplate = template;
    }

    const mockLines = [];
    for (let i = 0; i < 15; i++) {
      mockLines.push(60 + Math.floor(Math.random() * 40));
    }

    console.log('[doc-preview] cloudFileID:', template.cloudFileID);

    this.setData({
      templateId,
      pages: template.pages,
      markers: template.markers || [],
      currentPage: template.pages[0],
      mockLines,
      cloudFileID: template.cloudFileID || '',
    });

    this.calcPageSize();
  },

  onImageLoad(e) {
    // image loaded
  },

  onImageError(e) {
    console.error('[doc-preview] image load FAILED:', JSON.stringify(e.detail));
  },

  onReady() {
    setTimeout(() => {
      this.renderCurrentPageMarkers();
    }, 200);
  },

  calcPageSize() {
    const sysInfo = wx.getWindowInfo();
    const pageWidthPx = sysInfo.windowWidth - 24;

    const currentPage = this.data.pages[this.data.currentPageIndex];
    let aspectRatio = 1.414; // A4 默认
    if (currentPage && currentPage.pdfWidth && currentPage.pdfHeight) {
      aspectRatio = currentPage.pdfHeight / currentPage.pdfWidth;
    }

    const pageHeightPx = Math.floor(pageWidthPx * aspectRatio);
    this.pageWidthPx = pageWidthPx;
    this.pageHeightPx = pageHeightPx;
    this.setData({ pageWidthPx, pageHeightPx });
  },

  renderCurrentPageMarkers() {
    const { markers, currentPageIndex, signerRoles } = this.data;

    const pageMarkers = markers
      .filter(m => m.page === currentPageIndex)
      .map(m => {
        const role = signerRoles[m.signerIndex] || signerRoles[0];
        return {
          ...m,
          _x: (m.xPercent / 100) * this.pageWidthPx,
          _y: (m.yPercent / 100) * this.pageHeightPx,
          _width: (m.widthPercent / 100) * this.pageWidthPx,
          _height: (m.heightPercent / 100) * this.pageHeightPx,
          typeIcon: MARKER_TYPES[m.type] ? MARKER_TYPES[m.type].icon : '📝',
          signerLabel: role.label,
          signerColor: role.color,
          xPctDisplay: Math.round(m.xPercent),
          yPctDisplay: Math.round(m.yPercent),
        };
      });

    this.setData({ currentPageMarkers: pageMarkers, selectedMarkerId: '' });
  },

  onMarkerMove(e) {
    const { x, y, source } = e.detail;
    if (source !== 'touch' && source !== 'friction') return;

    const markerId = e.currentTarget.dataset.markerId;
    const xPercent = (x / this.pageWidthPx) * 100;
    const yPercent = (y / this.pageHeightPx) * 100;

    const markers = this.data.markers.map(m => {
      if (m.id === markerId) {
        return { ...m, xPercent, yPercent };
      }
      return m;
    });
    this.setData({ markers });
  },

  onMarkerSelect(e) {
    const markerId = e.detail ? e.detail.markerId : e.currentTarget.dataset.markerId;
    this.setData({
      selectedMarkerId: this.data.selectedMarkerId === markerId ? '' : markerId,
    });
  },

  onMarkerDelete(e) {
    const { markerId } = e.detail;
    wx.showModal({
      title: '删除标记',
      content: '确认删除此签署位置标记？',
      success: (res) => {
        if (res.confirm) {
          const markers = this.data.markers.filter(m => m.id !== markerId);
          this.setData({ markers, selectedMarkerId: '' });
          this.renderCurrentPageMarkers();
        }
      },
    });
  },

  addMarker(e) {
    const { signerRoles } = this.data;

    const items = signerRoles.map(r => r.label);
    items.push('+ 添加更多签署方');

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === signerRoles.length) {
          this.addSignerRole();
        } else {
          this.doAddMarkerGroup(res.tapIndex);
        }
      },
    });
  },

  doAddMarkerGroup(signerIndex) {
    const { currentPageIndex, markers, signerRoles } = this.data;
    const role = signerRoles[signerIndex];
    const sigConfig = MARKER_TYPES.signature;
    const stampConfig = MARKER_TYPES.stamp;
    const dateConfig = MARKER_TYPES.date;

    const groupCount = markers.filter(m => m.type === 'signature' && m.signerIndex === signerIndex).length;
    const baseY = 40 + groupCount * 30;

    // 以签名区域为参考，三个标记水平居中对齐
    const maxWidth = Math.max(sigConfig.defaultWidthPercent, stampConfig.defaultWidthPercent, dateConfig.defaultWidthPercent);
    const centerX = (signerIndex % 2 === 0 ? 5 : 50) + maxWidth / 2;

    // 签名位
    const sigMarker = {
      id: generateId(),
      page: currentPageIndex,
      xPercent: centerX - sigConfig.defaultWidthPercent / 2,
      yPercent: baseY,
      widthPercent: sigConfig.defaultWidthPercent,
      heightPercent: sigConfig.defaultHeightPercent,
      type: 'signature',
      signerIndex,
      label: `${role.label}签名${groupCount > 0 ? groupCount + 1 : ''}`,
    };

    // 盖章位 — 签名下方，垂直居中对齐
    const stampMarker = {
      id: generateId(),
      page: currentPageIndex,
      xPercent: centerX - stampConfig.defaultWidthPercent / 2,
      yPercent: baseY + sigConfig.defaultHeightPercent + 1,
      widthPercent: stampConfig.defaultWidthPercent,
      heightPercent: stampConfig.defaultHeightPercent,
      type: 'stamp',
      signerIndex,
      label: `${role.label}盖章${groupCount > 0 ? groupCount + 1 : ''}`,
    };

    // 日期位 — 盖章下方，垂直居中对齐
    const dateMarker = {
      id: generateId(),
      page: currentPageIndex,
      xPercent: centerX - dateConfig.defaultWidthPercent / 2,
      yPercent: baseY + sigConfig.defaultHeightPercent + 1 + stampConfig.defaultHeightPercent + 1,
      widthPercent: dateConfig.defaultWidthPercent,
      heightPercent: dateConfig.defaultHeightPercent,
      type: 'date',
      signerIndex,
      label: `${role.label}日期${groupCount > 0 ? groupCount + 1 : ''}`,
    };

    this.setData({ markers: [...markers, sigMarker, stampMarker, dateMarker] });
    this.renderCurrentPageMarkers();
    showToast(`已添加 ${role.label}签署位`);
  },

  doAddMarker(type, signerIndex) {
    const config = MARKER_TYPES[type];
    const { currentPageIndex, markers, signerRoles } = this.data;
    const role = signerRoles[signerIndex];

    const sameCount = markers.filter(m => m.type === type && m.signerIndex === signerIndex).length;

    const newMarker = {
      id: generateId(),
      page: currentPageIndex,
      xPercent: signerIndex % 2 === 0 ? 10 : 55,
      yPercent: 40 + sameCount * 12,
      widthPercent: config.defaultWidthPercent,
      heightPercent: config.defaultHeightPercent,
      type,
      signerIndex,
      label: `${role.label}${config.label}${sameCount > 0 ? sameCount + 1 : ''}`,
    };

    this.setData({ markers: [...markers, newMarker] });
    this.renderCurrentPageMarkers();
    showToast(`已添加 ${role.label}${config.label}`);
  },

  addSignerRole() {
    const { signerRoles } = this.data;
    if (signerRoles.length >= SIGNER_ROLES.length) {
      showToast('最多支持' + SIGNER_ROLES.length + '方签署');
      return;
    }
    const newRole = SIGNER_ROLES[signerRoles.length];
    const newRoles = [...signerRoles, newRole];
    this.setData({ signerRoles: newRoles });
    showToast(`已添加${newRole.label}`);

    setTimeout(() => {
      this.doAddMarkerGroup(newRoles.length - 1);
    }, 500);
  },

  prevPage() {
    const { currentPageIndex } = this.data;
    if (currentPageIndex > 0) {
      this.setData({
        currentPageIndex: currentPageIndex - 1,
        currentPage: this.data.pages[currentPageIndex - 1],
      });
      this.calcPageSize();
      this.renderCurrentPageMarkers();
    }
  },

  nextPage() {
    const { currentPageIndex, pages } = this.data;
    if (currentPageIndex < pages.length - 1) {
      this.setData({
        currentPageIndex: currentPageIndex + 1,
        currentPage: this.data.pages[currentPageIndex + 1],
      });
      this.calcPageSize();
      this.renderCurrentPageMarkers();
    }
  },

  goToPage(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      currentPageIndex: index,
      currentPage: this.data.pages[index],
    });
    this.calcPageSize();
    this.renderCurrentPageMarkers();
  },

  saveTemplate() {
    const { markers } = this.data;
    if (markers.length === 0) {
      wx.showModal({
        title: '提示',
        content: '尚未添加任何签署位置标记，确定保存？',
        success: (res) => {
          if (res.confirm) this.doSave();
        },
      });
      return;
    }
    this.doSave();
  },

  async doSave() {
    const { markers, signerRoles } = this.data;
    const template = app.globalData.pendingDocTemplate;

    if (template) {
      template.markers = markers;
      template.signerRoles = signerRoles;

      try {
        if (template._id) {
          await updateDocumentTemplate(template._id, { markers, signerRoles });
        } else {
          await addDocumentTemplate(template);
        }
        app.globalData.pendingDocTemplate = null;
      } catch (e) {
        console.error('Save template failed', e);
        showToast('保存失败');
        return;
      }
    }

    showToast('模板保存成功');
    setTimeout(() => {
      wx.navigateBack({ delta: 2 });
    }, 1500);
  },
});
