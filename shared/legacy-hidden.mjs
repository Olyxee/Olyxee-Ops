// TRANSITIONAL. Names hidden from the People list by the pre-org-model code.
// They were duplicate or completed intern records. With ORG_MODEL_ENABLED=true this list is no longer used:
// visibility comes from org_identity_links and org_chart_exclusions (data, with an owner and a reason).
// scripts/migrate-org-model.mjs reports what each name resolves to so nothing is hidden or revealed by accident.
export const LEGACY_HIDDEN_INTERN_NAMES = Object.freeze(["alisha fatima", "mosa maseko", "neo letswalo"]);
