import { ButtonLink, Icon } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-xl p-10 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon name="search" className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted">
        This employer or page is not in the data. Employer addresses change when the data is rebuilt, so
        search for the name instead.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <ButtonLink href="/" icon="search">Search employers</ButtonLink>
        <ButtonLink href="/explore" variant="secondary">Explore</ButtonLink>
      </div>
    </div>
  );
}
