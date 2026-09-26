import MapView from "@/components/MapView";
import TopBar from "@/components/TopBar";
import UploadCard from "@/components/UploadCard";
import { osmEnabled } from "@/lib/config";
import { getRequester, getRequesterQuota } from "@/lib/requester";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requester = await getRequester();
  const quota = await getRequesterQuota(requester);
  const { auth_error: authError } = await searchParams;

  return (
    <main className="home">
      <MapView styleId="dark" spinning />
      <div className="home__veil" aria-hidden />
      <TopBar user={requester.user} osmEnabled={osmEnabled()} />
      <section className="hero">
        <p className="eyebrow">AI photo geolocation</p>
        <h1 className="hero__title">
          Find where any photo <em>was taken.</em>
        </h1>
        <p className="hero__lede">
          Drop in a photo. The model reads terrain, vegetation, architecture, road markings and signage, then pins its best guess on a 3D
          globe with its evidence and reasoning.
        </p>
        <UploadCard
          signedIn={Boolean(requester.user)}
          osmEnabled={osmEnabled()}
          quota={quota}
          authError={typeof authError === "string" ? authError : undefined}
        />
        <p className="fineprint">
          Photos are resized and stripped of metadata; only a small thumbnail is kept so your result link works. Don&apos;t upload photos of
          people without their consent.
        </p>
      </section>
    </main>
  );
}
