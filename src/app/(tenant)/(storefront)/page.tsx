// The tenant storefront root. All of the loading and rendering lives in
// <StorefrontHome>, which the /p/<slug> share-link route renders too — see
// storefront-home.tsx for why the two share one component.
//
// This file stays a thin wrapper because Next type-checks a route page's props
// against PageProps and rejects any extra field, so the component's
// `initialProduct` prop cannot live on a default page export.

import { StorefrontHome } from "./storefront-home";

export default async function HomePage() {
  return <StorefrontHome />;
}
