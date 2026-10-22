import { useEffect, useState, type CSSProperties } from 'react';

export default function LocalMediaPage() {
  const [items, setItems] = useState<LocalMediaItem[]>([]);
  const [serverInfo, setServerInfo] = useState<MediaServerInfo | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = () => window.kickpulseDesktop.listMediaFiles().then(setItems);

  useEffect(() => {
    refresh();
    window.kickpulseDesktop.getMediaServerInfo().then(setServerInfo);
  }, []);

  const addFile = async () => {
    const item = await window.kickpulseDesktop.addMediaFile();
    if (item) refresh();
  };

  const removeFile = async (id: string) => {
    await window.kickpulseDesktop.removeMediaFile(id);
    refresh();
  };

  const urlFor = (id: string) => (serverInfo ? `${serverInfo.baseUrl}/media/${id}` : '');

  const copy = (id: string) => {
    navigator.clipboard.writeText(urlFor(id));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Local Media</h1>
      <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        Add a file from this PC to get a stable URL you can paste into any widget's "paste a URL" field —
        on the website, or in the tabs on the left — exactly like any other image/video/audio link.
        {!serverInfo?.port && ' Local media server isn’t running — restart the app.'}
      </p>

      <button onClick={addFile} style={{ ...btn('#16a34a'), marginBottom: 16 }}>
        + Add File
      </button>

      {items.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No local files added yet.
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          style={{
            ...card,
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.fileName}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, wordBreak: 'break-all' }}>{urlFor(item.id)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => copy(item.id)} style={btn('#374151')}>
              {copiedId === item.id ? 'Copied!' : 'Copy URL'}
            </button>
            <button onClick={() => removeFile(item.id)} style={btn('#7f1d1d')}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const card: CSSProperties = {
  background: '#111827',
  borderRadius: 10,
  padding: 16,
};

function btn(bg: string): CSSProperties {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    cursor: 'pointer',
  };
}
