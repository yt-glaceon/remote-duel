import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomClient, type RoomOptions } from './room';

export function useRoom(opts: RoomOptions) {
  const [client] = useState(() => new RoomClient(opts));
  useEffect(() => {
    client.start();
    return () => client.destroy();
  }, [client]);
  const view = useSyncExternalStore(client.subscribe, client.getView);
  return [view, client] as const;
}
