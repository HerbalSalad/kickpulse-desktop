export default function ComingSoonPage({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: 28, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>{title}</h1>
      <div
        style={{
          background: '#111827',
          borderRadius: 10,
          padding: 24,
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: 13,
          marginTop: 16,
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
    </div>
  );
}
