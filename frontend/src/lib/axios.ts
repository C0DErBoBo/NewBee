import axios from 'axios';
import { store } from '../store';
import { logout, updateTokens } from '../store/authSlice';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 1000 * 30
});

const refreshClient = axios.create({
  baseURL: apiClient.defaults.baseURL ?? '/api',
  timeout: 1000 * 15
});

let isRefreshing = false;
let pendingQueue: Array<(token: string | null) => void> = [];

const processQueue = (token: string | null) => {
  pendingQueue.forEach((callback) => callback(token));
  pendingQueue = [];
};

apiClient.interceptors.request.use((config) => {
  const state = store.getState();
  const token = state.auth.accessToken;
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
    const originalRequest = error.config as typeof error.config & {
      _retry?: boolean;
    };

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    const { refreshToken } = store.getState().auth;

    if (!refreshToken) {
      store.dispatch(logout());
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          resolve(apiClient.request(originalRequest));
        });
      });
    }

    isRefreshing = true;

    try {
      const { data } = await refreshClient.post<{
        accessToken: string;
        refreshToken: string;
      }>('/auth/refresh', {
        refreshToken
      });

      store.dispatch(
        updateTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken
        })
      );

      processQueue(data.accessToken);

      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      }
      return apiClient.request(originalRequest);
    } catch (refreshError) {
      processQueue(null);
      store.dispatch(logout());
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
