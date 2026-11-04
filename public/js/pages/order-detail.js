const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const checking = ref(false);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-sage/10 text-sage border border-sage/20' },
      failed: { text: '付款失敗，請重試。', cls: 'bg-red-50 text-red-600 border border-red-100' },
      cancel: { text: '付款已取消。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
      pending: { text: '已從綠界返回，請點擊「查詢付款狀態」確認付款結果。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
    };

    // 前往綠界付款：帶 JWT token 以利 server 端驗證
    const ecpayUrl = computed(() => {
      const token = Auth.getToken();
      return `/ecpay/payment/${orderId}?token=${encodeURIComponent(token)}`;
    });

    async function checkPayment() {
      if (!order.value || checking.value) return;
      checking.value = true;
      try {
        const res = await apiFetch(`/api/orders/${order.value.id}/check-payment`, { method: 'POST' });
        if (res.data && res.data.status === 'paid') {
          order.value = { ...order.value, status: 'paid' };
          paymentResult.value = 'success';
        } else {
          Notification.show(res.message || '尚未完成付款', 'info');
        }
      } catch (e) {
        Notification.show('查詢失敗，請稍後再試', 'error');
      } finally {
        checking.value = false;
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders/' + orderId);
        order.value = res.data;
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }
    });

    return { order, loading, checking, paymentResult, statusMap, paymentMessages, ecpayUrl, checkPayment };
  }
}).mount('#app');
