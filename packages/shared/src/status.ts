export const LEAD_STATUSES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "CONFIRMED",
  "LOST",
  "NOT_INTERESTED",
  "UNSUBSCRIBED",
  "BOUNCED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses that halt all automated follow-ups for a lead. */
export const FOLLOWUP_HALTING: ReadonlySet<LeadStatus> = new Set([
  "REPLIED",
  "INTERESTED",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "CONFIRMED",
  "LOST",
  "NOT_INTERESTED",
  "UNSUBSCRIBED",
  "BOUNCED",
]);

/** Terminal statuses: no outgoing transitions except manual reopen to NEW/QUALIFIED. */
export const TERMINAL_STATUSES: ReadonlySet<LeadStatus> = new Set([
  "CONFIRMED",
  "LOST",
  "NOT_INTERESTED",
  "UNSUBSCRIBED",
  "BOUNCED",
]);

const FORWARD: LeadStatus[] = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "CONFIRMED",
];
const EXIT: LeadStatus[] = ["LOST", "NOT_INTERESTED", "UNSUBSCRIBED", "BOUNCED"];

/**
 * Allowed transitions. Users may drag leads anywhere along the pipeline (forward or
 * back) and into any exit status. Terminal statuses can only be reopened to NEW or
 * QUALIFIED, except UNSUBSCRIBED/BOUNCED which are permanent (compliance).
 */
export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  if (from === "UNSUBSCRIBED" || from === "BOUNCED") return false;
  if (TERMINAL_STATUSES.has(from)) return to === "NEW" || to === "QUALIFIED";
  return FORWARD.includes(to) || EXIT.includes(to);
}

export const REASON_REQUIRED: ReadonlySet<LeadStatus> = new Set(["LOST", "NOT_INTERESTED"]);
export const PROJECT_REQUIRED: ReadonlySet<LeadStatus> = new Set(["CONFIRMED"]);

export interface TransitionInput {
  reason?: string | null;
  project?: { name?: string; value?: number; notes?: string; expectedStart?: string } | null;
}

/** Returns an error message if the transition is invalid, otherwise null. */
export function validateTransition(
  from: LeadStatus,
  to: LeadStatus,
  input: TransitionInput = {},
): string | null {
  if (!canTransition(from, to)) return `Cannot move lead from ${from} to ${to}`;
  if (REASON_REQUIRED.has(to) && !input.reason?.trim()) return `A reason is required for ${to}`;
  if (PROJECT_REQUIRED.has(to) && !input.project?.name?.trim())
    return "Project details (name) are required for CONFIRMED";
  return null;
}

export const DEFAULT_CHECKLIST = [
  { key: "website_audited", label: "Website audited" },
  { key: "contact_verified", label: "Contact info verified" },
  { key: "first_email_sent", label: "First email sent" },
  { key: "reply_received", label: "Reply received" },
  { key: "interest_confirmed", label: "Interest confirmed" },
  { key: "proposal_sent", label: "Proposal / quote sent" },
  { key: "meeting_done", label: "Meeting / call done" },
  { key: "deal_confirmed", label: "Deal confirmed" },
  { key: "deposit_received", label: "Deposit received" },
] as const;

/** Checklist keys ticked automatically when a lead enters a status. */
export const STATUS_CHECKLIST_TICKS: Partial<Record<LeadStatus, string[]>> = {
  CONTACTED: ["first_email_sent"],
  REPLIED: ["first_email_sent", "reply_received"],
  INTERESTED: ["reply_received", "interest_confirmed"],
  PROPOSAL_SENT: ["interest_confirmed", "proposal_sent"],
  CONFIRMED: ["deal_confirmed"],
};
