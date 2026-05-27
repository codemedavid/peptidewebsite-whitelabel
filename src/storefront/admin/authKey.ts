// sessionStorage key for the storefront admin gate. Kept in its own tiny module
// so the public storefront can read/clear the auth flag without statically
// importing (and bundling) the admin UI — the admin tree is code-split and only
// loads on the #admin route.
export const ADMIN_AUTH_KEY = "__admin_auth_v1";
