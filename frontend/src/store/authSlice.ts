import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface AuthUser {
  id: string;
  name: string;
  roles: string[];
  token?: string;
}

interface AuthState {
  user: AuthUser | null;
}

const initialState: AuthState = {
  user: null
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload;
    },
    logout(state) {
      state.user = null;
    },
    updateToken(state, action: PayloadAction<string>) {
      if (state.user) {
        state.user.token = action.payload;
      }
    }
  }
});

export const { loginSuccess, logout, updateToken } = authSlice.actions;
export const authReducer = authSlice.reducer;
