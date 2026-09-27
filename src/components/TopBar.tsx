import Link from "next/link";
import * as Icon from "@/components/icons";
import type { SessionUser } from "@/lib/types";

interface Props {
  user: SessionUser | null;
  osmEnabled: boolean;
  returnTo?: string;
  /** Show the landing-page section links. */
  sections?: boolean;
}

export default function TopBar({ user, osmEnabled, returnTo = "/", sections = false }: Props) {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <Icon.Logo size={20} />
        <span>PhotoLocator</span>
      </Link>
      {sections && (
        <nav className="nav__links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#models">Models</a>
          <a href="#trust">Responsible use</a>
        </nav>
      )}
      <div className="nav__right">
        {user ? (
          <>
            <Link href="/history" className="btn btn--ghost">
              Cases
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
              <button type="submit" className="btn btn--ghost">
                Sign out
              </button>
            </form>
          </>
        ) : osmEnabled ? (
          <a href={`/api/auth/osm/login?returnTo=${encodeURIComponent(returnTo)}`} className="btn btn--ghost btn--osm">
            <Icon.Osm /> Sign in with OpenStreetMap
          </a>
        ) : null}
      </div>
    </header>
  );
}
