import { ForbiddenException } from '@nestjs/common';

// A location over the plan's limit is read-only, along with its cards and pages.
// They stay live; only changes are refused.

export const READ_ONLY_LOCATION_MESSAGE =
  'This location is read-only on your plan. Make it an active location in Locations, or upgrade, to change it.';

export function assertLocationWritable(
  location: { readOnly: boolean } | null | undefined,
) {
  if (location?.readOnly) {
    throw new ForbiddenException(READ_ONLY_LOCATION_MESSAGE);
  }
}
