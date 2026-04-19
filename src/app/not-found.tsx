import Link from "next/link";

import { ScreenState } from "@/components/screen-state";
import { Button } from "@/components/ui/button";
import { DEMO_DOSSIER_PRODUCTS } from "@/lib/manex-demo";

export default function NotFound() {
  return (
    <ScreenState
      eyebrow="Not found"
      title="That investigation target is not available"
      description="The requested product or route did not return a usable read model. Try one of the seeded live demo products or jump back to the home workspace."
      tone="error"
      actions={
        <>
          {DEMO_DOSSIER_PRODUCTS.slice(0, 2).map((product) => (
            <Button
              key={product.id}
              size="lg"
              variant="outline"
              render={<Link href={product.href}>{product.label}</Link>}
            />
          ))}
          <Button size="lg" render={<Link href="/">Back to home</Link>} />
        </>
      }
    />
  );
}
