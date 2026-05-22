const { PRESET_TAG_LIST, PRESET_CATEGORIES } = require('../../utils/constants');
const { getContracts, getCustomCategories } = require('../../utils/cloud-db');
const app = getApp();

Page({
  data: {
    keyword: '',
    currentFilter: 'all',
    contracts: [],
    filteredContracts: [],
    filters: [
      { label: '全部', value: 'all', count: 0 },
      { label: '待签署', value: 'pending', count: 0 },
      { label: '签署中', value: 'signing', count: 0 },
      { label: '已完成', value: 'completed', count: 0 },
      { label: '草稿', value: 'draft', count: 0 },
      { label: '已拒绝', value: 'rejected', count: 0 },
    ],
    showFilterPanel: false,
    categories: [...PRESET_CATEGORIES],
    selectedCategory: '',
    allTags: [],
    selectedTags: [],
    activeFilterCount: 0,
    hasAnyFilter: false,
    sortMode: 'time_desc',
    sortLabel: '最新优先',
  },

  onLoad() {
    this.loadContracts();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.loadContracts();
  },

  setFilter(status) {
    this.setData({ currentFilter: status });
    this.applyFilter();
  },

  async loadContracts() {
    try {
      await app.loginPromise;
      const [allContracts, customCats] = await Promise.all([
        getContracts(),
        getCustomCategories(),
      ]);

      const categories = [...PRESET_CATEGORIES, ...customCats];

      const tagSet = new Set();
      allContracts.forEach(c => (c.tags || []).forEach(t => tagSet.add(t)));
      const allTags = Array.from(tagSet);

      const filters = this.data.filters.map(f => ({
        ...f,
        count: f.value === 'all' ? allContracts.length : allContracts.filter(c => c.status === f.value).length,
      }));

      this.setData({ contracts: allContracts, filters, allTags, categories });
      this.applyFilter();
    } catch (e) {
      console.error('Load contracts failed', e);
    }
  },

  applyFilter() {
    const { contracts: list, currentFilter, keyword, selectedCategory, selectedTags, sortMode } = this.data;
    let filtered = list;

    if (currentFilter !== 'all') {
      filtered = filtered.filter(c => c.status === currentFilter);
    }

    if (selectedCategory) {
      filtered = filtered.filter(c => c.category === selectedCategory);
    }

    if (selectedTags.length > 0) {
      filtered = filtered.filter(c => {
        const cTags = c.tags || [];
        return selectedTags.every(t => cTags.includes(t));
      });
    }

    if (keyword) {
      const kw = keyword.toLowerCase();
      filtered = filtered.filter(c =>
        c.title.toLowerCase().includes(kw) ||
        c.templateName.toLowerCase().includes(kw) ||
        (c.category || '').toLowerCase().includes(kw) ||
        (c.tags || []).some(t => t.toLowerCase().includes(kw)) ||
        (c.signers || []).some(s => s.name.toLowerCase().includes(kw))
      );
    }

    filtered = this.sortContracts(filtered, sortMode);

    const activeFilterCount = (selectedCategory ? 1 : 0) + selectedTags.length;
    const hasAnyFilter = !!(keyword || currentFilter !== 'all' || selectedCategory || selectedTags.length > 0);

    this.setData({ filteredContracts: filtered, activeFilterCount, hasAnyFilter });
  },

  sortContracts(list, mode) {
    const sorted = [...list];
    switch (mode) {
      case 'time_desc':
        sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        break;
      case 'time_asc':
        sorted.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
        break;
      case 'title_asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
        break;
    }
    return sorted;
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  onFilterTap(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ currentFilter: value });
    this.applyFilter();
  },

  toggleFilterPanel() {
    this.setData({ showFilterPanel: !this.data.showFilterPanel });
  },

  onCategoryTap(e) {
    const { name } = e.currentTarget.dataset;
    this.setData({
      selectedCategory: this.data.selectedCategory === name ? '' : name,
    });
  },

  onTagFilterChange(e) {
    this.setData({ selectedTags: e.detail.selectedTags });
  },

  confirmFilters() {
    this.setData({ showFilterPanel: false });
    this.applyFilter();
  },

  resetFilters() {
    this.setData({
      selectedCategory: '',
      selectedTags: [],
      keyword: '',
      currentFilter: 'all',
      showFilterPanel: false,
    });
    this.applyFilter();
  },

  clearCategory() {
    this.setData({ selectedCategory: '' });
    this.applyFilter();
  },

  removeTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const selectedTags = this.data.selectedTags.filter(t => t !== tag);
    this.setData({ selectedTags });
    this.applyFilter();
  },

  toggleSort() {
    const modes = [
      { mode: 'time_desc', label: '最新优先' },
      { mode: 'time_asc', label: '最早优先' },
      { mode: 'title_asc', label: '名称排序' },
    ];
    const currentIdx = modes.findIndex(m => m.mode === this.data.sortMode);
    const next = modes[(currentIdx + 1) % modes.length];
    this.setData({ sortMode: next.mode, sortLabel: next.label });
    this.applyFilter();
  },

  onContractTap(e) {
    const { id } = e.detail;
    wx.navigateTo({ url: `/pages/contract-detail/contract-detail?id=${id}` });
  },

  createContract() {
    wx.navigateTo({ url: '/pages/templates/templates' });
  },

  onShareAppMessage() {
    return {
      title: '秒签 - 免费电子签约小程序',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '秒签 - 免费电子签约小程序',
    };
  },
});
