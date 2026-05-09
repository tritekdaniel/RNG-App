export async function call(name, args = {}) {
  const resp = await fetch(`http://localhost:${location.port || 5173}/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  return resp.json();
}
