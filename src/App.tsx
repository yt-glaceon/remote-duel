import { CameraOnly } from './components/CameraOnly';
import { Duel } from './components/Duel';
import { Lobby } from './components/Lobby';
import { ROOM_RE } from './identity';

export function App() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room')?.toLowerCase() ?? '';
  if (!ROOM_RE.test(room)) return <Lobby />;
  const cam = params.get('cam');
  if (cam === 'p1' || cam === 'p2') return <CameraOnly room={room} seat={cam} />;
  return <Duel room={room} isHost={params.get('host') === '1'} />;
}
