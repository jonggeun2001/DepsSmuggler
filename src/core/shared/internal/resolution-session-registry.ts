import { ResolutionSession } from './resolution-session';

const attachedResolutionSessions = new WeakMap<object, ResolutionSession>();

export function attachResolutionSession(owner: object, session: ResolutionSession): void {
  attachedResolutionSessions.set(owner, session);
}

export function getAttachedResolutionSession(owner: object): ResolutionSession | undefined {
  return attachedResolutionSessions.get(owner);
}
