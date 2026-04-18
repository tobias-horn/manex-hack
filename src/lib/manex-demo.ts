import { DEFAULT_PRODUCT_DOSSIER_ID } from "@/lib/manex-product-dossier";

export type DemoJump = {
  id: string;
  label: string;
  description: string;
  href: string;
};

export const DEMO_INBOX_JUMPS: DemoJump[] = [
  {
    id: "supplier-spike",
    label: "Supplier spike",
    description: "Open the full-window cold-solder trail.",
    href: "/?window=all&defectCode=SOLDER_COLD",
  },
  {
    id: "thermal-claims",
    label: "Thermal claims",
    description: "Jump straight to article-level field claims.",
    href: "/?window=all&article=ART-00001&signalType=field_claim",
  },
  {
    id: "test-outliers",
    label: "Bad tests",
    description: "Focus only on failing test signals.",
    href: "/?window=30d&signalType=bad_test",
  },
];

export const DEMO_TRACEABILITY_JUMPS: DemoJump[] = [
  {
    id: "product-prd-00023",
    label: "PRD-00023",
    description: "Open the dossier seed product trace.",
    href: "/traceability?product=PRD-00023&part=PM-00008&batch=SB-00007",
  },
  {
    id: "supplier-batch",
    label: "Supplier batch",
    description: "Jump to the shared-batch blast radius view.",
    href: "/traceability?batch=SB-00007&part=PM-00008",
  },
  {
    id: "article-three",
    label: "ART-00003 path",
    description: "Explore an alternate live product path.",
    href: "/traceability?product=PRD-00322&part=PM-00008",
  },
];

export const DEMO_DOSSIER_PRODUCTS: DemoJump[] = [
  {
    id: "default-product",
    label: DEFAULT_PRODUCT_DOSSIER_ID,
    description: "Best integrated evidence trail right now.",
    href: `/products/${DEFAULT_PRODUCT_DOSSIER_ID}`,
  },
  {
    id: "secondary-product",
    label: "PRD-00002",
    description: "Alternate product with claims and actions.",
    href: "/products/PRD-00002",
  },
  {
    id: "article-three-product",
    label: "PRD-00322",
    description: "Cross-check another article family.",
    href: "/products/PRD-00322",
  },
];
