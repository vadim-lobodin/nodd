import { describeAutoSegment } from './autoState';
import { describeFloatSegment } from './floatingState';
import { describeCtlSegment } from './controlledState';

/**
 * A label a person would recognise for any state segment, whichever way it was
 * derived: `auto:dialog:settings` → "Settings", `float:steps` → "Steps",
 * `ctl:advanced` → "Advanced", and an explicit `<NoddState name>` segment as
 * the host wrote it.
 *
 * Used for sidebar breadcrumbs and for naming the state in reveal hints, so
 * every one of those surfaces says the same thing about the same state.
 */
export function describeSegment(segment: string): string {
  return (
    describeAutoSegment(segment) ??
    describeFloatSegment(segment) ??
    describeCtlSegment(segment) ??
    segment
  );
}
