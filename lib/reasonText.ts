/**
 * Human-readable copy for reason codes (docs/03 §Reason codes, docs/06 §WHY
 * bullets). Template-filled, no LLM — this is the ONLY place reason codes
 * get translated to prose.
 */
import type { ReasonCode } from "@/types";

export const REASON_TEXT: Record<ReasonCode, string> = {
  VALUE_GAP: "Clear score edge over the next-best option available",
  WONT_SURVIVE: "Unlikely to survive to your next pick",
  POSITION_CLIFF: "Next player at this position drops off sharply",
  LEAGUE_DISCOUNT: "This room is letting him fall further than his value suggests",
  SCORING_EDGE: "Elite value under this league's exact scoring",
  ROSTER_NEED: "Fills a starting roster need",
  UPSIDE: "Higher weekly ceiling than the alternatives",
  TIER_DEPTH: "This position's top tier is thinning fast",
  MODEL_DISAGREEMENT: "Model takes him well ahead of market consensus — sanity-check before confirming",
};
