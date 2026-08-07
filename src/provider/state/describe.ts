import { describeAutoSegment } from './autoState';
import { describeFloatSegment } from './floatingState';

/**
 * A label a person would recognise for any state segment, whichever way it was
 * derived: `auto:dialog:settings` → "Settings", `float:steps` → "Steps", and an
 * explicit `<NoddState name>` segment as the host wrote it.
 *
 * Used for sidebar breadcrumbs and for naming the state in reveal hints, so
 * every one of those surfaces says the same thing about the same state.
 */
export function describeSegment(segment: string): string {
  return describeAutoSegment(segment) ?? describeFloatSegment(segment) ?? segment;
}
