import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 初回描画が終わったら起動スプラッシュを消す
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById('splash')?.remove();
  });
});
