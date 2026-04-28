import { useContext } from 'react';
import { AlignStateContext } from './AlignStateContext';

export function useAlignState(): readonly string[] {
  return useContext(AlignStateContext);
}

export function stackToKey(stack: readonly string[]): string {
  return stack.join('/');
}

export function keyToStack(key: string): string[] {
  if (!key) return [];
  return key.split('/');
}

export function isStateMatch(threadStateKey: string, currentStack: readonly string[]): boolean {
  if (!threadStateKey) return true;
  const currentKey = stackToKey(currentStack);
  if (threadStateKey === currentKey) return true;
  return currentKey.startsWith(threadStateKey + '/');
}
