const { createApp, ref } = Vue;

createApp({
  setup() {
    const activeTab = ref('login');
    const submitting = ref(false);
    const loginForm = ref({ email: '', password: '' });
    const registerForm = ref({ name: '', email: '', password: '' });
    const errors = ref({});

    // 登入後會立即跳頁，提示留到下一頁由 header-init.js 顯示
    function rememberCartNotice(cartMerge) {
      if (cartMerge && cartMerge.adjusted > 0) {
        sessionStorage.setItem('flower_cart_notice', '部分購物車商品因庫存不足已調整，請確認數量');
      }
    }

    function validateLogin() {
      errors.value = {};
      if (!loginForm.value.email.trim()) errors.value.email = '請輸入 Email';
      if (!loginForm.value.password) errors.value.password = '請輸入密碼';
      return Object.keys(errors.value).length === 0;
    }

    function validateRegister() {
      errors.value = {};
      if (!registerForm.value.name.trim()) errors.value.name = '請輸入姓名';
      if (!registerForm.value.email.trim()) errors.value.email = '請輸入 Email';
      if (!registerForm.value.password) {
        errors.value.password = '請輸入密碼';
      } else if (registerForm.value.password.length < 6) {
        errors.value.password = '密碼至少 6 個字元';
      }
      return Object.keys(errors.value).length === 0;
    }

    async function handleLogin() {
      if (!validateLogin() || submitting.value) return;
      submitting.value = true;
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(loginForm.value)
        });
        Auth.login(res.data.token, res.data.user);
        rememberCartNotice(res.data.cart_merge);
        Notification.show('登入成功', 'success');
        const params = new URLSearchParams(window.location.search);
        window.location.href = params.get('redirect') || '/';
      } catch (err) {
        Notification.show(err?.data?.message || '登入失敗', 'error');
      } finally {
        submitting.value = false;
      }
    }

    async function handleRegister() {
      if (!validateRegister() || submitting.value) return;
      submitting.value = true;
      try {
        const res = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(registerForm.value)
        });
        Auth.login(res.data.token, res.data.user);
        rememberCartNotice(res.data.cart_merge);
        Notification.show('註冊成功', 'success');
        const params = new URLSearchParams(window.location.search);
        window.location.href = params.get('redirect') || '/';
      } catch (err) {
        Notification.show(err?.data?.message || '註冊失敗', 'error');
      } finally {
        submitting.value = false;
      }
    }

    return {
      activeTab, submitting, loginForm, registerForm, errors,
      handleLogin, handleRegister
    };
  }
}).mount('#app');
