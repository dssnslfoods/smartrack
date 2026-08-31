import { api, auth } from '../api.js?v=43';
import { h, field, toast } from '../ui.js?v=43';

export function loginView() {
  const username = h('input', { placeholder: 'ชื่อผู้ใช้', autocomplete: 'username' });
  const password = h('input', { type: 'password', placeholder: 'รหัสผ่าน', autocomplete: 'current-password' });

  const submit = async () => {
    try {
      const r = await api.post('/api/auth/login', { username: username.value.trim(), password: password.value });
      auth.set(r.token, r.user);
      location.hash = '#/';
      location.reload();
    } catch (err) { toast(err.message, 'err'); }
  };
  [username, password].forEach((el) => el.addEventListener('keydown', (e) => e.key === 'Enter' && submit()));
  setTimeout(() => username.focus(), 100);

  return h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('div', { class: 'login-header' },
        h('img', { class: 'login-logo', src: '/img/deleaf-logo.png', alt: 'De Leaf' }),
        h('h1', {}, 'ระบบจัดการชั้นวางสินค้า'),
        h('p', {}, 'RACK Management System')),
      h('div', { class: 'login-body' },
        field('ชื่อผู้ใช้', username, null, 'ชื่อผู้ใช้ที่ได้รับจากผู้ดูแลระบบ'),
        field('รหัสผ่าน', password, null, 'รหัสผ่านสำหรับเข้าสู่ระบบ'),
        h('button', { class: 'btn primary lg', style: 'width:100%', title: 'ตรวจสอบชื่อผู้ใช้และรหัสผ่านเพื่อเข้าใช้งานระบบ — สิทธิ์ที่เห็นในเมนูขึ้นกับบทบาทของบัญชีที่ใช้', onclick: submit }, 'เข้าสู่ระบบ'),
        h('div', { class: 'demo-users' },
          h('strong', {}, 'บัญชีทดสอบ'), h('br'),
          'admin / admin123 — ผู้ดูแลระบบ', h('br'),
          'staff / staff123 — พนักงานคลัง', h('br'),
          'viewer / viewer123 — ผู้ดูข้อมูล'),
        h('div', { class: 'login-footer' },
          '© 2025 De Leaf Thanaka · ',
          h('a', { href: 'https://deleafthanaka.com', target: '_blank' }, 'deleafthanaka.com')))));
}
