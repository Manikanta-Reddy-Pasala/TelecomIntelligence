import api from './api';

export const authService = {
  async login(username, password) {
    const response = await api.post('/auth/login', { username, password });
    return response.data;
  },

  async getCurrentUser() {
    const response = await api.get('/auth/me');
    return response.data;
  },

  logout() {
    localStorage.removeItem('tiac_token');
    localStorage.removeItem('tiac_user');
    window.location.href = '/login';
  },

  getToken() {
    return localStorage.getItem('tiac_token');
  },

  isAuthenticated() {
    return Boolean(localStorage.getItem('tiac_token'));
  },
};
