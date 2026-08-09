/**
 * Persistence of the desktop sidebar's collapsed state (#209).
 *
 * **A cookie, not `localStorage`, because the server has to know.** The
 * collapsed state does not just restyle the sidebar — it changes what gets
 * rendered: labels, the discipline header, the whole expanded footer are
 * behind `{!collapsed && …}`. Storage the server cannot read means the
 * first paint is always the expanded DOM, and a user who collapsed the
 * sidebar watches it jump back every single load, animated by the
 * `transition-[width,transform]` on the `<aside>`.
 *
 * This is where the `next-themes` trick — a blocking inline script setting
 * an attribute on `<html>` — stops being enough, even though it is the same
 * shape of problem. A theme is pure CSS, so an attribute covers it. Getting
 * that to work here would mean turning every conditional render into a CSS
 * rule. Reading a cookie in the server component that already reads cookies
 * for auth costs one line and renders the right DOM the first time.
 *
 * The cookie is deliberately not `HttpOnly`: the toggle writes it from the
 * client. There is nothing sensitive in it — it is one bit of layout
 * preference.
 *
 * **Existing users lose the preference once.** Whatever sat in
 * `localStorage` under the old key is not migrated: the sidebar comes back
 * expanded on the first load after this ships and sticks again from the
 * next toggle. Migrating would mean re-adding the mount effect this change
 * exists to delete, to carry one bit through one page load.
 */

export const SIDEBAR_COLLAPSED_COOKIE = "hitfactor-sidebar-collapsed";

/** A year. The preference is not worth re-asking about sooner. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Reads the preference out of a raw cookie value.
 *
 * Anything other than `"1"` means expanded, including `undefined`. Expanded
 * is the safe default: it is the state where nothing is hidden, so a user
 * who has never chosen — or whose cookie got mangled — sees the full menu
 * rather than a strip of icons they have to work out.
 */
export function parseSidebarCollapsed(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Serialises the `document.cookie` assignment for the given state.
 *
 * Split out from the click handler so it can be asserted directly — a
 * cookie that silently fails to round-trip (wrong `path`, missing
 * `max-age`) looks exactly like a working one until the next page load.
 *
 * `path=/` because the sidebar is on every authenticated route, and
 * `SameSite=Lax` because it never needs to travel cross-site.
 */
export function serialiseSidebarCookie(collapsed: boolean): string {
  return (
    `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}` +
    `; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  );
}
