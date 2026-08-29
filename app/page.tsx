/**
 * Placeholder home page. frontend-engineer replaces this with the real PICK
 * card / alternatives / roster panel / manual-entry UI (docs/06_UI_AND_API.md).
 * Kept intentionally minimal here — this file exists only to prove the app
 * builds and to point at the stubbed API routes.
 */
export default function Home() {
  return (
    <main>
      <h1>Draft Edge</h1>
      <p>Scaffold online. UI not yet built — see docs/06_UI_AND_API.md.</p>
      <p>Stubbed API routes:</p>
      <ul>
        <li>
          <code>GET /api/health</code>
        </li>
        <li>
          <code>GET /api/players</code>
        </li>
        <li>
          <code>GET /api/draft/state</code>
        </li>
        <li>
          <code>POST /api/draft/pick</code>
        </li>
        <li>
          <code>POST /api/draft/undo</code>
        </li>
        <li>
          <code>GET /api/recommendation</code>
        </li>
      </ul>
    </main>
  );
}
