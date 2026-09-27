import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page page--center">
      <div className="stars" aria-hidden />
      <div className="lost">
        <span className="eyebrow mono">404</span>
        <h1 className="page__title">Off the map.</h1>
        <p className="muted">That search doesn&apos;t exist, or its link is incomplete.</p>
        <Link href="/" className="btn btn--primary">
          Start a new search
        </Link>
      </div>
    </main>
  );
}
