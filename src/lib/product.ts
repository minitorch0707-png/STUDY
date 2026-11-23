/**
 * ─────────────────────────────────────────────────────────────────────────
 *  PRODUCT SETTINGS: the one file to edit when you set up selling LectureLab.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LectureLab Pro is unlocked with a licence key that students buy from a store
 * (Lemon Squeezy or Gumroad). The app checks the key directly with the store,
 * so you don't run any server. Step-by-step setup: docs/SELLING.md
 *
 * While `licenseProvider` is "none", everything is unlocked for everyone
 * (handy for testing and early users).
 */
export const PRODUCT = {
  name: "LectureLab",
  proName: "LectureLab Pro",
  proPrice: "$5",

  /** "none" | "lemonsqueezy" | "gumroad" */
  licenseProvider: "none" as "none" | "lemonsqueezy" | "gumroad",

  /** The page where students buy Pro (your Lemon Squeezy or Gumroad product link). */
  buyUrl: "",

  /** Lemon Squeezy: your store and product IDs (Products → ⋯ → Copy ID). */
  lemonSqueezy: { storeId: 0, productId: 0 },

  /** Gumroad: the product ID (Product → Content → License key section). */
  gumroad: { productId: "" },

  /** How many computers one key can be used on (Lemon Squeezy enforces this itself; set the same number there). */
  maxDevices: 3,

  /** After the last successful online check, Pro keeps working offline for this many days. */
  offlineGraceDays: 30,

  /** GitHub repository used for update checks and download links. */
  githubRepo: "minitorch0707-png/lecturelab",
} as const;

/** Free plan limits and which features need Pro. Change freely. */
export const PLAN = {
  freeCourseLimit: 2,
  proFeatures: {
    unlimitedCourses: "More than 2 courses",
    examSimulation: "Timed exam simulations",
    aiWrittenGrading: "AI marking of written answers (free plan: mark yourself with the rubric)",
    studyPlanner: "Study planner & Exam Cram",
  },
} as const;

export type ProFeature = keyof typeof PLAN.proFeatures;
