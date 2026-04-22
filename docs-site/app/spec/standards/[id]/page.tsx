import Link from "next/link";
import { notFound } from "next/navigation";
import {
  allStandardIds,
  categoryOfStandard,
  getStandard,
  loadLibrary,
} from "@/lib/standards";

type Params = { id: string };

export function generateStaticParams(): Params[] {
  return allStandardIds().map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const std = getStandard(id);
  if (!std) return { title: "Not found · ContentRX docs" };
  return {
    title: `${std.id} · ContentRX docs`,
    description: std.rule,
  };
}

export default async function StandardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const std = getStandard(id);
  if (!std) notFound();

  const cat = categoryOfStandard(id);
  const lib = loadLibrary();
  const types = lib.content_types;

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {cat?.name ?? "Standard"} · {std.rule_type ?? "rule"}
      </p>
      <h1>
        <code>{std.id}</code>
      </h1>
      <p className="text-lg">{std.rule}</p>

      {std.correct && (
        <div>
          <h2>Pass example</h2>
          <blockquote className="not-italic">{std.correct}</blockquote>
        </div>
      )}

      {std.incorrect && (
        <div>
          <h2>Fail example</h2>
          <blockquote className="not-italic">{std.incorrect}</blockquote>
        </div>
      )}

      {std.relevant_content_types && std.relevant_content_types.length > 0 && (
        <div>
          <h2>Relevant content types</h2>
          <ul>
            {std.relevant_content_types.map((ctId) => {
              const ct = types.find((t) => t.id === ctId);
              return (
                <li key={ctId}>
                  <Link href={`/spec/content-types#${ctId}`}>
                    {ct?.name ?? ctId}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {std.content_type_notes &&
        Object.keys(std.content_type_notes).length > 0 && (
          <div>
            <h2>Notes by content type</h2>
            <dl>
              {Object.entries(std.content_type_notes).map(([key, note]) => {
                const label =
                  key === "_global"
                    ? "All content types"
                    : (types.find((t) => t.id === key)?.name ?? key);
                return (
                  <div key={key}>
                    <dt className="font-semibold">{label}</dt>
                    <dd>{note}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

      <hr />
      <p className="text-sm">
        <Link href="/spec/standards">← All standards</Link>
      </p>
    </>
  );
}
