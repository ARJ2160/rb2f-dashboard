export function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div role="note" className="alert alert-info alert-soft block px-4 py-3 text-xs">
      <ul className="list-disc space-y-1 pl-4">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="alert alert-error alert-soft text-sm">{message}</div>;
}
