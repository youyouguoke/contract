const { getTagColor } = require('../../utils/util');

Component({
  properties: {
    title: { type: String, value: '标签' },
    tags: { type: Array, value: [] },
    selectedList: { type: Array, value: [] },
    showHeader: { type: Boolean, value: true },
  },

  data: {
    expanded: false,
    selectedMap: {},
    colorMap: {},
  },

  observers: {
    'tags': function (tags) {
      const colorMap = {};
      (tags || []).forEach(t => { colorMap[t] = getTagColor(t); });
      this.setData({ colorMap });
    },
    'selectedList': function (list) {
      const selectedMap = {};
      (list || []).forEach(t => { selectedMap[t] = true; });
      this.setData({ selectedMap });
    },
  },

  methods: {
    onTagTap(e) {
      const tag = e.currentTarget.dataset.tag;
      const list = [...this.data.selectedList];
      const idx = list.indexOf(tag);
      if (idx > -1) {
        list.splice(idx, 1);
      } else {
        list.push(tag);
      }
      this.setData({ selectedList: list });
      this.triggerEvent('change', { selectedTags: list });
    },

    clearAll() {
      this.setData({ selectedList: [] });
      this.triggerEvent('change', { selectedTags: [] });
    },

    toggleExpand() {
      this.setData({ expanded: !this.data.expanded });
    },
  },
});
