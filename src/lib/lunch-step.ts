/** How the lunch step is brought into view when "Submit my day" opens it (spec 05 · F7). */
export function lunchStepScroll(prefersReducedMotion: boolean): ScrollIntoViewOptions {
  return { block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" };
}
