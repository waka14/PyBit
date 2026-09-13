import { useMemo, useState } from 'react';
import { v2MockWorkspace } from './mock';
import { createV2MemoryStore, MemoryV2Repository } from './repository';
import { V2App } from './V2App';

export default function V2DemoApp() {
  const [store, setStore] = useState(() => createV2MemoryStore(structuredClone(v2MockWorkspace)));
  const [actorId, setActorId] = useState('one');
  const repository = useMemo(() => new MemoryV2Repository(store, actorId), [store, actorId]);
  const reset = () => {
    setStore(createV2MemoryStore(structuredClone(v2MockWorkspace)));
    setActorId('one');
  };
  return <V2App repository={repository} demoMembers={store.workspace.members} onDemoActorChange={setActorId} onResetDemo={reset} />;
}
