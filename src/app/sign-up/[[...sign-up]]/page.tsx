import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      {/*
        After successful sign-up, route through /onboard (the surface
        picker — PR-18) instead of straight to /dashboard. This is the
        "where do you want to use ContentRX?" decision the customer-
        journey diagrams call out as the first post-signup screen.
        Sign-in (returning users) still goes to /dashboard via the
        Clerk default — only fresh signups hit /onboard.
      */}
      <SignUp fallbackRedirectUrl="/onboard" />
    </main>
  );
}
