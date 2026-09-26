import Link from "next/link";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { osmEnabled } from "@/lib/config";
import { getSession } from "@/lib/session";
import { listOwnerSearches } from "@/lib/store";

export const metadata = { title: "Your searches" };

export default async function HistoryPage() {
  const user = await getSession();
  if (!user) redirect(osmEnabled() ? "/api/auth/osm/login?returnTo=/history" : "/");
  const searches = await listOwnerSearches(`osm:${user.uid}`);

  return (
    <main className="page">
      <div className="stars" aria-hidden />
      <TopBar user={user} osmEnabled={osmEnabled()} returnTo="/history" />
      <section className="page__content">
        <h1 className="page__title">Your searches</h1>
        {searches.length === 0 ? (
          <p className="muted">
            Nothing yet. <Link href="/">Locate your first photo →</Link>
          </p>
        ) : (
          <ul className="history">
            {searches.map((s) => (
              <li key={s.id}>
                <Link href={`/search/${s.id}`} className="history__item">
                  <img src={`/api/search/${s.id}/image`} alt="" loading="lazy" />
                  <span className="history__text">
                    <span className="history__name">
                      {s.result?.name ?? (s.status === "failed" ? "Analysis failed" : "Analyzing…")}
                    </span>
                    <span className="history__meta">
                      {s.mode === "deep" ? "Deep search" : "Quick find"} · {new Date(s.createdAt).toUTCString().slice(5, 22)} UTC
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
