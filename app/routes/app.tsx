
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { getOrCreateSubscription } from "../models/subscription.server";
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

  const usagePercentage = subscription.usageLimit > 0 
    ? (subscription.usageCount / subscription.usageLimit) * 100 
    : 0;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          🏠 Dashboard
        </Link>
        <Link to="/app/pricing">
          💰 Dynamic Pricing
          {usagePercentage >= 100 && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#d73502" }}>
              (Limit Reached)
            </span>
          )}
        </Link>
        <Link to="/app/history">
          📋 History
          {subscription.usageCount > 0 && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#008060" }}>
              ({subscription.usageCount})
            </span>
          )}
        </Link>
        <Link to="/app/plans">
          {subscription.planName === 'free' ? "⭐ View Pricing Plans" : "💳 Manage Subscription"}
        </Link>
        <Link to="/app/sync-subscription">
          🔄 Sync
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
