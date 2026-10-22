export function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-1 rounded-md border border-line bg-surface px-4 py-3 text-xs text-muted">
      {notes.map((n) => (
        <li key={n}>• {n}</li>
      ))}
    </ul>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-md border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{message}</div>;
}
