import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  // Default-styled prose comes from Tailwind Typography on the wrapping
  // <article className="prose"> in app/layout.tsx. Per-element overrides
  // can be added here as the docs grow.
  return { ...components };
}
