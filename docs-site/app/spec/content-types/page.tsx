import { loadLibrary } from "@/lib/standards";

export const metadata = {
  title: "Content types · ContentRX docs",
};

export default function ContentTypesPage() {
  const lib = loadLibrary();
  return (
    <>
      <h1>Content types</h1>
      <p>
        The {lib.content_types.length} content types describe the surface
        a string lives on. Picking the right type narrows the relevant
        rules — a button is judged differently than a help-article
        paragraph.
      </p>
      <dl>
        {lib.content_types.map((ct) => (
          <div key={ct.id} id={ct.id}>
            <dt className="font-semibold">
              <code>{ct.id}</code> — {ct.name}
            </dt>
            <dd>{ct.description}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
