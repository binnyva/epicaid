"use client";
/** The three reader tabs: a bottom tab bar on phones, the rail's links on desktop. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookmarkIcon, BooksIcon, SearchIcon } from "./icons";

const TABS = [
  { href: "/", label: "Look up", Icon: SearchIcon, match: (p: string) => p === "/" || p.startsWith("/subject") },
  { href: "/position", label: "Position", Icon: BookmarkIcon, match: (p: string) => p.startsWith("/position") },
  {
    href: "/reading",
    label: "Reading",
    Icon: BooksIcon,
    match: (p: string) => p.startsWith("/reading") || p.startsWith("/series"),
  },
];

export function Tabs({ variant }: { variant: "bar" | "rail" }) {
  const pathname = usePathname();
  return (
    <>
      {TABS.map(({ href, label, Icon, match }) => {
        const active = match(pathname);
        return (
          <Link key={href} href={href} className={variant === "bar" ? "tab" : "nav"} aria-current={active ? "page" : undefined}>
            <Icon size={variant === "bar" ? 22 : 20} />
            {label}
          </Link>
        );
      })}
    </>
  );
}
