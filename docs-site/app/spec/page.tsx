import Link from "next/link";
import { loadLibrary } from "@/lib/standards";

export const metadata = {
  title: "Spec overview · ContentRX docs",
};

export default function SpecOverviewPage() {
  const lib = loadLibrary();
  return (
    <>
      <h1>Spec overview</h1>
      <p>
        The ContentRX content model is a small, opinionated, executable
        specification. It exists so a single piece of UI copy can be
        evaluated the same way in three different surfaces (Figma plugin,
        CLI, CI pipeline) without anyone arguing about whose linter is
        right.
      </p>
      <h2>The three primitives</h2>
      <p>The model has three layers and they compose:</p>
      <h3>1. Content type ({lib.content_types.length})</h3>
      <p>
        What surface does the string live on? A button label is judged
        differently than a help-article paragraph. Picking the right
        type narrows the relevant rules.
      </p>
      <p>
        See <Link href="/spec/content-types">all content types</Link>.
      </p>
      <h3>2. Moment (13)</h3>
      <p>
        What is the user trying to do at the moment of contact? Browsing?
        Recovering from an error? Onboarding? Moments shape which standards
        get applied with what weight.
      </p>
      <p>
        See <Link href="/spec/moments">all moments</Link>.
      </p>
      <h3>3. Standards ({lib.total_standards})</h3>
      <p>
        Atomic, citable rules — the things that can be true or false about
        a string. Each one names the rule, gives a pass and fail example,
        and lists the content types it applies to.
      </p>
      <p>
        See <Link href="/spec/standards">all standards</Link>.
      </p>
      <h2>How it composes</h2>
      <p>
        For each string, the evaluator picks a content type and moment,
        then runs only the standards relevant to that pairing. Mechanical
        rules (length caps, list parallelism, sentence-case checks) run
        deterministically; nuanced rules (voice, empathy, jargon) go
        through an LLM with the standards library injected as the system
        prompt. The merge step de-dupes and prioritizes by severity.
      </p>
      <h2>Categories</h2>
      <ul>
        {lib.categories.map((c) => (
          <li key={c.id}>
            <Link href={`/spec/standards#${c.id}`}>{c.name}</Link> —{" "}
            {c.standards.length} standard{c.standards.length === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
    </>
  );
}
