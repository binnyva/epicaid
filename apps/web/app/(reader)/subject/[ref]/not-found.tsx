import Link from "next/link";
import { BackIcon } from "../../_components/icons";

export default function NoMatch() {
  return (
    <div className="screen">
      <Link href="/" className="back" aria-label="Back to Look up">
        <BackIcon />
        <span className="desktop-only">Look up</span>
      </Link>
      <div className="card card-pad stack-8">
        <span className="card-title">No match</span>
        <p className="secondary">There is nothing by that name in the Chapters you have read.</p>
      </div>
    </div>
  );
}
