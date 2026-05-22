const { PRESET_TEMPLATES, PRESET_DOCUMENT_TEMPLATES, PRESET_CATEGORIES } = require('../../utils/constants');
const { getCustomTemplates, getDocumentTemplates, getCustomCategories, addCustomTemplate, removeCustomTemplate, addCustomCategory } = require('../../utils/cloud-db');
const { generateId, showToast } = require('../../utils/util');
const app = getApp();

Page({
  data: {
    keyword: '',
    currentCategory: '全部',
    categories: ['全部'],
    templates: [],
    filteredTemplates: [],
    showCreator: false,
    newTplName: '',
    newTplCategory: '',
    newTplDesc: '',
    newTplFields: [],
    newFieldInput: '',
    allCategories: [],
    showNewCatInput: false,
    newCatInput: '',
  },

  onLoad() {
    this.loadTemplates();
  },

  onShow() {
    this.loadTemplates();
  },

  async loadTemplates() {
    try {
      await app.loginPromise;
      const [customTpls, savedDocTpls, userCats] = await Promise.all([
        getCustomTemplates(),
        getDocumentTemplates(),
        getCustomCategories(),
      ]);

      const allDocTpls = [...PRESET_DOCUMENT_TEMPLATES, ...savedDocTpls];
      const allCats = [...PRESET_CATEGORIES, ...userCats];

      const allTemplates = [
        ...PRESET_TEMPLATES.map(t => ({ ...t, templateType: 'field', source: 'preset' })),
        ...customTpls.map(t => ({ ...t, templateType: 'field', source: 'custom' })),
        ...allDocTpls.map(t => ({ ...t, templateType: 'document', source: t._id ? 'custom' : 'preset' })),
      ];

      const cats = ['全部', ...new Set(allTemplates.map(t => t.category).filter(Boolean))];
      this.setData({
        categories: cats,
        templates: allTemplates,
        allCategories: allCats,
      });
      this.applyFilter();
    } catch (e) {
      console.error('Load templates failed', e);
    }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  onCategoryTap(e) {
    this.setData({ currentCategory: e.currentTarget.dataset.value });
    this.applyFilter();
  },

  applyFilter() {
    const { templates: list, currentCategory, keyword } = this.data;
    let filtered = list;

    if (currentCategory !== '全部') {
      filtered = filtered.filter(t => t.category === currentCategory);
    }

    if (keyword) {
      const kw = keyword.toLowerCase();
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(kw) ||
        (t.description || '').toLowerCase().includes(kw)
      );
    }

    this.setData({ filteredTemplates: filtered });
  },

  onUploadTap() {
    wx.navigateTo({ url: '/pkg-doc/pages/upload-template/upload-template' });
  },

  onTemplateTap(e) {
    const { id, type } = e.currentTarget.dataset;
    if (type === 'document') {
      wx.navigateTo({ url: `/pages/create-contract/create-contract?templateId=${id}&templateType=document` });
    } else {
      wx.navigateTo({ url: `/pages/create-contract/create-contract?templateId=${id}` });
    }
  },

  toggleCreator() {
    const show = !this.data.showCreator;
    this.setData({
      showCreator: show,
      newTplName: '',
      newTplCategory: '',
      newTplDesc: '',
      newTplFields: [],
      newFieldInput: '',
      showNewCatInput: false,
      newCatInput: '',
    });
  },

  onNewTplName(e) {
    this.setData({ newTplName: e.detail.value });
  },

  onNewTplDesc(e) {
    this.setData({ newTplDesc: e.detail.value });
  },

  onSelectCategory(e) {
    const { name } = e.currentTarget.dataset;
    if (name === '__new__') {
      this.setData({ showNewCatInput: true });
      return;
    }
    this.setData({
      newTplCategory: this.data.newTplCategory === name ? '' : name,
      showNewCatInput: false,
    });
  },

  onNewCatInput(e) {
    this.setData({ newCatInput: e.detail.value });
  },

  async confirmNewCategory() {
    const name = this.data.newCatInput.trim();
    if (!name) return;
    if (name.length > 6) {
      showToast('分类名最多6个字');
      return;
    }
    const { allCategories } = this.data;
    if (allCategories.find(c => c.name === name)) {
      showToast('分类已存在');
      return;
    }

    const newCat = { name, icon: '📁' };
    try {
      const res = await addCustomCategory(newCat);
      newCat.id = res.id;
      this.setData({
        allCategories: [...allCategories, newCat],
        newTplCategory: name,
        showNewCatInput: false,
        newCatInput: '',
      });
    } catch (e) {
      showToast('保存分类失败');
    }
  },

  onNewFieldInput(e) {
    this.setData({ newFieldInput: e.detail.value });
  },

  addField() {
    const name = this.data.newFieldInput.trim();
    if (!name) return;
    if (name.length > 15) {
      showToast('字段名最多15个字');
      return;
    }
    const fields = [...this.data.newTplFields];
    if (fields.includes(name)) {
      showToast('字段已存在');
      return;
    }
    fields.push(name);
    this.setData({ newTplFields: fields, newFieldInput: '' });
  },

  removeField(e) {
    const idx = e.currentTarget.dataset.index;
    const fields = this.data.newTplFields.filter((_, i) => i !== idx);
    this.setData({ newTplFields: fields });
  },

  async saveCustomTemplate() {
    const { newTplName, newTplCategory, newTplDesc, newTplFields } = this.data;
    if (!newTplName.trim()) {
      showToast('请输入模板名称');
      return;
    }
    if (!newTplCategory) {
      showToast('请选择分类');
      return;
    }

    const tpl = {
      name: newTplName.trim(),
      category: newTplCategory,
      icon: '✏️',
      description: newTplDesc.trim() || '自建模板',
      fields: newTplFields.length > 0 ? newTplFields : ['甲方名称', '乙方名称'],
      templateType: 'field',
      source: 'custom',
      createdAt: new Date().toISOString(),
    };

    try {
      await addCustomTemplate(tpl);
      this.setData({ showCreator: false });
      this.loadTemplates();
      showToast('模板已创建');
    } catch (e) {
      showToast('创建失败');
    }
  },

  deleteTemplate(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除模板',
      content: '确定删除此自建模板？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await removeCustomTemplate(id);
            this.loadTemplates();
            showToast('已删除');
          } catch (e) {
            showToast('删除失败');
          }
        }
      },
    });
  },
});
