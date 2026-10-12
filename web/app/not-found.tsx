import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-xl p-8 sm:p-10">
      <p className="label text-warn">Not on file</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 text-lg text-ink-2">
        This employer or page is not in the data. Employer addresses change when the data is rebuilt, so
        search for the name instead.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink href="/">Search employers</ButtonLink>
        <ButtonLink href="/explore" variant="secondary">Explore</ButtonLink>
      </div>
    </div>
  );
}
