import type { Metadata } from "next";

import { PitchDeck } from "@/components/pitch-deck";

export const metadata: Metadata = {
  title: "Pitch Deck | Manex Forensic Lens",
  description:
    "Print-ready pitch deck for the Manex Forensic Lens hackathon story.",
};

export default function PitchPage() {
  return <PitchDeck />;
}
