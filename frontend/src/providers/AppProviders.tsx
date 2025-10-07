import { PropsWithChildren, useMemo } from 'react';
import { Provider } from 'react-redux';
import { store } from '../store';
import { ThemeProvider } from './ThemeProvider';

export function AppProviders({ children }: PropsWithChildren) {
  const memoizedStore = useMemo(() => store, []);

  return (
    <Provider store={memoizedStore}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        {children}
      </ThemeProvider>
    </Provider>
  );
}
