import React from 'react';
import ReactDOM from 'react-dom/client';
// Primer Primitives design tokens: base scales + light/dark_dimmed color themes.
// These define the --fgColor-*, --bgColor-*, --borderColor-*, --borderRadius-*,
// --shadow-* and --fontStack-* custom properties that Primer components and our
// minimal styles consume. The themes are scoped to the data-color-mode /
// data-*-theme attributes that <ThemeProvider> sets.
import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark-dimmed.css';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
