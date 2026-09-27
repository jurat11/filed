import { normalizeName } from "./names";

/** The name variant a search matched, when it is not just another spelling of the
 * display name ("Amazon Web Services, Inc." vs "AMAZON WEB SERVICES INC" is not shown). */
export function aliasNote(displayName: string, alias: string | null | undefined): string | null {
  if (!alias) return null;
  return normalizeName(alias) === normalizeName(displayName) ? null : alias;
}
