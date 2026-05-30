import { ImportWizard } from "@/components/import/ImportWizard";
import { ADAPTERS } from "@/lib/adapters";

export default function ImportPage() {
  // Bundle is a UI-only mode (not a real BenchmarkAdapter), so we inject it
  // into the adapter list shown by the wizard.
  const adapters = [
    ...ADAPTERS.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      description: a.description,
      unavailable: a.getUnavailableFields(),
    })),
    {
      id: "bundle",
      displayName: "Trace Bundle",
      description:
        "Upload multiple files at once — result + launch/benchmark commands + hardware snapshot.",
      unavailable: [],
      isBundle: true,
    },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload or paste benchmark output. Pick a source format below and
          you&apos;ll see the exact CLI command to run, plus a one-click
          example you can use to verify everything works end-to-end.
        </p>
      </header>

      <ImportWizard adapters={adapters} />
    </div>
  );
}
