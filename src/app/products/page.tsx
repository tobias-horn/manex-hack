import { redirect } from "next/navigation";

import { DEFAULT_PRODUCT_DOSSIER_ID } from "@/lib/manex-product-dossier";

export default function ProductsPage() {
  redirect(`/products/${DEFAULT_PRODUCT_DOSSIER_ID}`);
}
