import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ResultView from "@/components/ResultView";
import { getSearch, toPublic } from "@/lib/store";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = await getSearch(id);
  if (!record) return { title: "Search not found" };
  const title = record.result?.name ?? "Photo search";
  const description = record.result
    ? `${record.result.confidence[0].toUpperCase()}${record.result.confidence.slice(1)} confidence · ${record.result.lat.toFixed(4)}, ${record.result.lng.toFixed(4)}`
    : "Where was this photo taken?";
  return { title, description, openGraph: { title, description, images: [`/api/search/${id}/image`] }, robots: { index: false } };
}

export default async function SearchPage({ params }: Props) {
  const record = await getSearch((await params).id);
  if (!record) notFound();
  return <ResultView initial={toPublic(record)} />;
}
