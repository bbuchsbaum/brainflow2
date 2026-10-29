import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserApp } from './BrowserViewer';
import { installNumericInputGuard } from '../utils/numericInput';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../index.css';
import './viewer.css';

installNumericInputGuard(document);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserApp />
  </React.StrictMode>,
);
