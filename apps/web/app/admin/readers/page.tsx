import { asc, schema } from "@epicaid/db";
import { isBootstrapAdmin } from "@/lib/access";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addAllowedEmail, removeAllowedEmail, setReaderAdmin } from "../actions";
import { Flash } from "../flash";

export default async function ReadersPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const me = await requireAdmin();
  const db = getDb();
  const allowed = await db.select().from(schema.allowedEmails).orderBy(asc(schema.allowedEmails.email));
  const readerRows = await db.select().from(schema.readers).orderBy(asc(schema.readers.createdAt));

  return (
    <main>
      <h1>Readers</h1>
      <Flash msg={msg} />

      <h2>Invite list</h2>
      <p className="muted small">
        Only these Google accounts can sign in, plus <code>ADMIN_EMAIL</code>. They also need to be test users on the
        Google consent screen while it is in Testing.
      </p>
      <form action={addAllowedEmail} className="row">
        <input name="email" type="email" placeholder="friend@gmail.com" required />
        <button type="submit">Invite</button>
      </form>
      <table>
        <tbody>
          {allowed.map((a) => (
            <tr key={a.email}>
              <td>{a.email}</td>
              <td>
                <form action={removeAllowedEmail}>
                  <input type="hidden" name="email" value={a.email} />
                  <button type="submit" className="danger">
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Signed up</h2>
      <table>
        <thead>
          <tr>
            <th>Reader</th>
            <th>Joined</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          {readerRows.map((r) => {
            const fixed = r.id === me.id || isBootstrapAdmin(r.email);
            const admin = r.isAdmin || isBootstrapAdmin(r.email);
            return (
              <tr key={r.id}>
                <td>
                  {r.name ?? r.email}
                  {r.name && <div className="small muted">{r.email}</div>}
                </td>
                <td className="small">{r.createdAt.toISOString().slice(0, 10)}</td>
                <td>
                  {fixed ? (
                    admin ? "yes" : "no"
                  ) : (
                    <form action={setReaderAdmin} className="row">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="admin" value={admin ? "0" : "1"} />
                      {admin ? "yes" : "no"}
                      <button type="submit">{admin ? "Remove admin" : "Make admin"}</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
