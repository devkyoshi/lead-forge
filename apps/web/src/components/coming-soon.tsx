export function ComingSoon({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">Arrives in Phase {phase}.</p>
    </div>
  );
}
