import Link from "next/link";
import type { SessionUser } from "@/lib/types";

interface Props {
  user: SessionUser | null;
  osmEnabled: boolean;
  returnTo?: string;
}

export default function TopBar({ user, osmEnabled, returnTo = "/" }: Props) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand__dot" aria-hidden />
        PhotoLocator
      </Link>
      <nav className="topbar__nav">
        {user ? (
          <>
            <Link href="/history" className="chip">
              History
            </Link>
            <span className="user">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="user__avatar" referrerPolicy="no-referrer" />
              ) : (
                <span className="user__avatar user__avatar--blank" aria-hidden>
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="user__name">{user.name}</span>
            </span>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="chip">
                Sign out
              </button>
            </form>
          </>
        ) : osmEnabled ? (
          <a href={`/api/auth/osm/login?returnTo=${encodeURIComponent(returnTo)}`} className="chip chip--osm">
            <OsmLogo />
            Sign in with OpenStreetMap
          </a>
        ) : null}
      </nav>
    </header>
  );
}

function OsmLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M4 14l5-4 4 3 7-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
