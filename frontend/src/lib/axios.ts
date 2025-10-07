import axios from 'axios';
import { store } from '../store';
import { updateToken, logout } from '../store/authSlice';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 1000 * 30
});

apiClient.interceptors.request.use((config) => {
  const state = store.getState();
  const token = state.auth.user?.token;
  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`
    };
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        const refreshToken = await axios.post<{ token: string }>(
          '/auth/refresh'
        );
        store.dispatch(updateToken(refreshToken.data.token));
        error.config.headers.Authorization = `Bearer ${refreshToken.data.token}`;
        return apiClient.request(error.config);
      } catch (refreshError) {
        store.dispatch(logout());
      }
    }
    return Promise.reject(error);
  }
);
