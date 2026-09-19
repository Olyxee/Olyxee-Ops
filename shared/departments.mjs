export const OFFICIAL_DEPARTMENTS = Object.freeze([
  "Research & Development (R&D)",
  "AI Engineering",
  "Data & Security",
  "Sales & Marketing",
  "Business Operations",
]);

export const UNASSIGNED_DEPARTMENT = "Unassigned";

const rules = [
  {
    department: "AI Engineering",
    keywords: [
      "artificial intelligence", "ai engineer", "machine learning", "ml engineer",
      "llm", "large language model", "agent engineer", "applied ai", "ai integration",
      "model development", "mlops",
    ],
  },
  {
    department: "Data & Security",
    keywords: [
      "data engineer", "data science", "data scientist", "etl", "data pipeline",
      "database", "data governance", "cybersecurity", "cyber security",
      "security engineer", "access control", "data protection", "infosec",
    ],
  },
  {
    department: "Research & Development (R&D)",
    keywords: [
      "software engineer", "full stack", "full-stack", "frontend", "front end",
      "backend", "back end", "product engineer", "research engineer",
      "technical research", "prototype", "prototyping", "web developer",
      "application developer", "developer",
    ],
  },
  {
    department: "Sales & Marketing",
    keywords: [
      "sales", "marketing", "business development", "partnership",
      "customer success", "communications", "content marketing", "growth",
    ],
  },
  {
    department: "Business Operations",
    keywords: [
      "operations", "finance", "human resources", "people operations", "hr ",
      "administrator", "administration", "legal", "compliance",
      "project coordinator", "project coordination", "office manager",
    ],
  },
];

export function normalizeDepartment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["unknown", "unknown department", "unassigned", "n/a", "none", "null"].includes(normalized)) {
    return null;
  }
  return OFFICIAL_DEPARTMENTS.find((department) => department.toLowerCase() === normalized) || null;
}

export function isOfficialDepartment(value) {
  return Boolean(normalizeDepartment(value));
}

export function classifyDepartment(details = {}) {
  const text = [
    details.position,
    details.role,
    details.title,
    details.skills,
    details.responsibilities,
    details.currentResponsibilities,
    details.notes,
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[_/,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return { department: UNASSIGNED_DEPARTMENT, matchedKeywords: [], confident: false };

  const matches = rules
    .map((rule) => ({
      department: rule.department,
      matchedKeywords: rule.keywords.filter((keyword) => text.includes(keyword)),
    }))
    .filter((result) => result.matchedKeywords.length > 0)
    .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

  if (!matches.length || (matches[1] && matches[1].matchedKeywords.length === matches[0].matchedKeywords.length)) {
    return { department: UNASSIGNED_DEPARTMENT, matchedKeywords: [], confident: false };
  }

  return { ...matches[0], confident: true };
}

export function resolveDepartment(details = {}) {
  const currentDepartment = normalizeDepartment(details.department);
  const classification = classifyDepartment(details);

  if (classification.confident) {
    return {
      ...classification,
      previousDepartment: details.department || null,
      changed: currentDepartment !== classification.department,
      reviewRequired: false,
    };
  }

  return {
    department: currentDepartment || UNASSIGNED_DEPARTMENT,
    previousDepartment: details.department || null,
    matchedKeywords: [],
    confident: Boolean(currentDepartment),
    changed: !currentDepartment && String(details.department || "").trim() !== UNASSIGNED_DEPARTMENT,
    reviewRequired: !currentDepartment,
  };
}

export const DEPARTMENT_DESCRIPTIONS = Object.freeze({
  "Research & Development (R&D)": "Software, product, research engineering, and prototyping.",
  "AI Engineering": "Machine learning, applied AI, agents, models, and AI integrations.",
  "Data & Security": "Data platforms, analytics, governance, cybersecurity, and protection.",
  "Sales & Marketing": "Growth, sales, partnerships, customer success, and communications.",
  "Business Operations": "Operations, finance, people, administration, legal, and coordination.",
});