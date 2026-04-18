import { ScreenState } from "@/components/screen-state";

export default function Loading() {
  return (
    <ScreenState
      eyebrow="Loading"
      title="Pulling the latest quality evidence"
      description="The app is assembling the current quality signals, traceability context, workflow state, and investigation surfaces for the demo."
    />
  );
}
