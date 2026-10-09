/**
 * Where-clauses that define which slots count as parking inventory.
 *
 * A disabled slot is out of service and an archived slot is soft-deleted:
 * neither is allocated, held, counted as capacity nor shown to users. Every
 * query that allocates slots or reports capacity uses these, so the rule
 * lives in one place.
 */
export const IN_SERVICE = { isEnabled: true, archivedAt: null } as const;

/** Zones that take part in allocation: the zone and its block are both active. */
export const ACTIVE_ZONE = { isActive: true, block: { isActive: true } } as const;
