import { CameraOnly } from './components/CameraOnly';
import { Duel } from './components/Duel';
import { JoinChoice, Lobby } from './components/Lobby';
import { ROOM_RE } from './identity';

export function App() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room')?.toLowerCase() ?? '';
  if (!ROOM_RE.test(room)) return <Lobby />;
  // カメラ端末は合言葉で持ち主に結び付く(席は持ち主に付いていく)。cam=p1/p2 は以前のリンクの形
  const cam = params.get('cam');
  if (cam === '1' || cam === 'p1' || cam === 'p2') return <CameraOnly room={room} camKey={params.get('key') ?? ''} />;
  const isHost = params.get('host') === '1';
  const as = params.get('as');
  // 招待リンクで来た人には、まず対戦するか観戦するかを選んでもらう
  if (!isHost && as !== 'play' && as !== 'watch') return <JoinChoice room={room} />;
  return <Duel room={room} isHost={isHost} spectator={!isHost && as === 'watch'} />;
}
