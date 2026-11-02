import { createRoot } from 'react-dom/client';
import { App } from './App';
import { purgeExpiredStates } from './game/state';
import './styles.css';

purgeExpiredStates();

// StrictMode は使わない: 開発時に effect が二重に走ると、同じルーム ID で Peer を2つ作ろうとして衝突する
createRoot(document.getElementById('root')!).render(<App />);
