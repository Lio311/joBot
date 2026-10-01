import type { Company } from "../src/db/schema";
import type { SourceKey } from "../src/lib/config";
import type { ProfileAnswers } from "../src/lib/profile";

/** What every source adapter returns, before scoring and dedupe. */
export interface RawJob {
  source: SourceKey;
  externalId: string;
  url: string;
  title: string;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  workModel?: "onsite" | "hybrid" | "remote" | null;
  employmentType?: string | null;
  postedAt?: Date | null;
  /** The search term or board that surfaced it. */
  query?: string | null;
}

export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedError";
  }
}

export interface SourceResult {
  jobs: RawJob[];
  /** Non-fatal problems, e.g. one query failed. Shown on the dashboard status popover. */
  warnings: string[];
}

export interface SourceContext {
  profile: ProfileAnswers;
  /** Search terms from the profile (roles + keywords). */
  queries: string[];
  companies: Company[];
  /** Boards discovered while running (Google X-ray finds new Comeet/Greenhouse companies). */
  discover: (c: { ats: Company["ats"]; slug: string; name: string }) => void;
}

export type Source = {
  key: SourceKey;
  /** Returns a reason when the source can't run now (missing token, not its day). */
  skip?: () => string | null;
  run: (ctx: SourceContext) => Promise<SourceResult>;
  /**
   * Fetches the full posting for list-only sources (title + company, no description). Called only
   * for jobs whose title already looks promising, and capped per run (DETAILS_PER_SOURCE).
   */
  describe?: (job: RawJob) => Promise<Partial<RawJob>>;
};
