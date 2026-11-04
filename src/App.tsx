import { CameraOnly } from './components/CameraOnly';
import { Duel, HostRoom } from './components/Duel';
import { JoinChoice, Lobby } from './components/Lobby';
import { ROOM_RE } from './identity';

export function App() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room')?.toLowerCase() ?? '';
  if (!ROOM_RE.test(room)) return <Lobby invalidLink={params.has('room')} />;
  // カメラ端末は合言葉で持ち主に結び付く(席は持ち主に付いていく)。合言葉はサーバーに送られない # 以降にある
  if (params.get('cam') === '1') {
    return <CameraOnly room={room} camKey={new URLSearchParams(location.hash.slice(1)).get('key') ?? ''} />;
  }
  if (params.get('host') === '1') return <HostRoom room={room} />;
  const as = params.get('as');
  // 招待リンクで来た人には、まず対戦するか観戦するかを選んでもらう
  if (as !== 'play' && as !== 'watch') return <JoinChoice room={room} />;
  return <Duel room={room} hostKey={null} spectator={as === 'watch'} />;
}
