import { PropsWithChildren, useMemo } from 'react';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { store } from '../store';
import { ThemeProvider } from './ThemeProvider';
import { queryClient } from '../queryClient';

export function AppProviders({ children }: PropsWithChildren) {
  const memoizedStore = useMemo(() => store, []);

  return (
    <Provider store={memoizedStore}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  );
}
