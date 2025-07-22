import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { getOrCreateSubscription } from "../models/subscription.server"; // ← Ajoutez cette ligne


import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  
  return { 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    subscription 
  };
};


export default function App() {
  const { apiKey, subscription } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
        <NavMenu>
        <Link to="/app" rel="home">🏠 Dashboard</Link>
        <Link to="/app/pricing">💰 Prix Dynamiques</Link>
        <Link to="/app/history">📋 Historique</Link>
        <Link to="/app/billing">
          {subscription.planName === 'free' ? '⭐ Upgrade' : '💳 Facturation'}
        </Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};