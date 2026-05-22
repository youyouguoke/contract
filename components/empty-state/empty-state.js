Component({
  properties: {
    text: { type: String, value: '暂无数据' },
    showBtn: { type: Boolean, value: false },
    btnText: { type: String, value: '去看看' },
  },
  methods: {
    onBtnTap() {
      this.triggerEvent('btnclick');
    },
  },
});
