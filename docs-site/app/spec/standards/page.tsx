import Link from "next/link";
import { loadLibrary } from "@/lib/standards";

export const metadata = {
  title: "Standards · ContentRX docs",
};

export default function StandardsIndexPage() {
  const lib = loadLibrary();
  return (
    <>
      <h1>Standards</h1>
      <p>
        {lib.total_standards} rules, organized into{" "}
        {lib.categories.length} categories. Each one carries a pass and
        fail example and a list of the content types it&apos;s relevant
        to.
      </p>
      {lib.categories.map((cat) => (
        <section key={cat.id} id={cat.id}>
          <h2>{cat.name}</h2>
          <ul>
            {cat.standards.map((std) => (
              <li key={std.id}>
                <Link href={`/spec/standards/${std.id}`}>
                  <code>{std.id}</code>
                </Link>{" "}
                — {std.rule}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
