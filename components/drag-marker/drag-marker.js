const ICONS = { signature: '📝', stamp: '🔴', date: '📅' };

Component({
  properties: {
    markerId: { type: String, value: '' },
    type: { type: String, value: 'signature' },
    label: { type: String, value: '' },
    selected: { type: Boolean, value: false },
    signerLabel: { type: String, value: '' },
    signerColor: { type: String, value: '' },
  },

  data: {
    typeIcon: '📝',
  },

  observers: {
    'type': function (type) {
      this.setData({ typeIcon: ICONS[type] || '📝' });
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('select', { markerId: this.data.markerId });
    },
    onDelete() {
      this.triggerEvent('delete', { markerId: this.data.markerId });
    },
  },
});
