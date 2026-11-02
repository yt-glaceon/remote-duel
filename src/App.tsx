import { CameraOnly } from './components/CameraOnly';
import { Duel } from './components/Duel';
import { JoinChoice, Lobby } from './components/Lobby';
import { ROOM_RE } from './identity';

export function App() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room')?.toLowerCase() ?? '';
  if (!ROOM_RE.test(room)) return <Lobby />;
  const cam = params.get('cam');
  if (cam === 'p1' || cam === 'p2') return <CameraOnly room={room} seat={cam} camKey={params.get('key') ?? ''} />;
  const isHost = params.get('host') === '1';
  const as = params.get('as');
  // 招待リンクで来た人には、まず対戦するか観戦するかを選んでもらう
  if (!isHost && as !== 'play' && as !== 'watch') return <JoinChoice room={room} />;
  return <Duel room={room} isHost={isHost} spectator={!isHost && as === 'watch'} />;
}
