/** Inline stroke icons, 1.8px stroke (Pocket spec). */
import type { SVGProps } from "react";

const base = (size: number, strokeWidth = 1.8): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const SearchIcon = ({ size = 22 }: { size?: number }) => (
  <svg {...base(size, 1.9)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const BookmarkIcon = ({ size = 22 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
);
export const BooksIcon = ({ size = 22 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M4 5h6v15H4zM14 5h6v15h-6z" />
  </svg>
);
export const ChevronRight = ({ size = 16 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const ChevronDown = ({ size = 16 }: { size?: number }) => (
  <svg {...base(size)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const BackIcon = ({ size = 18 }: { size?: number }) => (
  <svg {...base(size, 2)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
