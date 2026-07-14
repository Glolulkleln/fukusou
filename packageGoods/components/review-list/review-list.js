Component({
  properties: {
    reviews: {
      type: Array,
      value: []
    }
  },
  methods: {
    previewImage(e) {
      const { url, index } = e.currentTarget.dataset;
      const review = this.data.reviews[index];
      const urls = (review && review.images) || [];
      wx.previewImage({
        current: url,
        urls: urls
      });
    }
  }
});
