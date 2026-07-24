import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { verifySupabaseEnvironment } from './lib/supabase.ts';

// Perform on-load Supabase environment and connection diagnostics
verifySupabaseEnvironment();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
