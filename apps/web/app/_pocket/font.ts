import { Figtree } from "next/font/google";

/** Figtree for the reader side (Pocket design). Admin pages keep their own type. */
export const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-figtree",
});
