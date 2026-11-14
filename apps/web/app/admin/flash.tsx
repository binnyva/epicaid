/** Shows the one-line result an admin action redirects back with. */
export function Flash({ msg }: { msg?: string }) {
  return msg ? <p className="flash">{msg}</p> : null;
}
