import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page page--center">
      <div className="stars" aria-hidden />
      <div className="lost">
        <p className="eyebrow">404</p>
        <h1 className="page__title">Off the map.</h1>
        <p className="muted">That search doesn&apos;t exist, or its link is incomplete.</p>
        <Link href="/" className="cta cta--inline">
          Start a new search
        </Link>
      </div>
    </main>
  );
}
